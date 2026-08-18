import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

export type EvidenceSnippet = {
  id: string
  sourceUrl: string
  sourceTitle: string
  kind: 'job' | 'company' | 'repo' | 'resume'
  text: string
  score: number
}

export type JobContext = {
  url: string
  title: string
  company: string
  companyUrl: string
  jobText: string
  snippets: EvidenceSnippet[]
  fetchedPages: Array<{ url: string; title: string; chars: number; ok: boolean; error?: string }>
  cached: boolean
  fetchedAt: string
}

const MAX_PAGES = 6
const MAX_BYTES_PER_PAGE = 600_000
const FETCH_TIMEOUT_MS = 12_000
/** Smaller chunks make citations point at a specific requirement, not a whole page. */
const MAX_SNIPPET_CHARS = 500
const PASTED_SNIPPET_CHARS = 320
const MIN_SNIPPET_CHARS = 60
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const BLOCKED_HOSTS = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|\[?::1)/i

function cacheFile(workspace: string) {
  return path.join(workspace, '.resume-studio', 'evidence-cache.json')
}

type CacheShape = Record<string, JobContext>

async function readCache(workspace: string): Promise<CacheShape> {
  try {
    const raw = await fs.readFile(cacheFile(workspace), 'utf8')
    return JSON.parse(raw) as CacheShape
  } catch {
    return {}
  }
}

async function writeCache(workspace: string, cache: CacheShape) {
  const file = cacheFile(workspace)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(cache, null, 2), 'utf8')
}

export async function clearEvidenceCache(workspace: string): Promise<boolean> {
  const file = cacheFile(workspace)
  if (fsSync.existsSync(file)) await fs.rm(file)
  return true
}

function assertSafeUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) URLs can be researched.')
  }
  if (BLOCKED_HOSTS.test(url.hostname)) {
    throw new Error('Local and private network addresses are not allowed.')
  }
  return url
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
}

/** Very small Readability-style extraction: drop chrome, keep block structure. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|form|svg|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|ul|ol|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  return decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og) return decodeEntities(og[1]).trim()
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return t ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : ''
}

function extractCompany(html: string, url: URL, title: string): string {
  const site = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
  if (site) return decodeEntities(site[1]).trim()

  const jsonLd = html.match(/"hiringOrganization"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i)
  if (jsonLd) return decodeEntities(jsonLd[1]).trim()

  // Common "Role at Company" / "Role - Company" title patterns
  const at = title.match(/\s+(?:at|@)\s+([^|\-–—]+)/i)
  if (at) return at[1].trim()

  const host = url.hostname.replace(/^www\./, '')
  const known = host.match(
    /^(?:jobs|boards|careers|apply|job-boards)\.(?:lever|greenhouse|ashbyhq|workable|smartrecruiters)\.(?:co|io|com)$/i,
  )
  if (known) {
    const seg = url.pathname.split('/').filter(Boolean)[0]
    if (seg) return seg.replace(/[-_]/g, ' ')
  }
  return host.split('.')[0]
}

async function fetchPage(
  rawUrl: string,
): Promise<{ url: string; title: string; text: string; ok: boolean; error?: string }> {
  let url: URL
  try {
    url = assertSafeUrl(rawUrl)
  } catch (err) {
    return {
      url: rawUrl,
      title: '',
      text: '',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ResumeStudio/1.0 (+evidence-backed-tailor)',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
      },
    })
    if (!res.ok) {
      const hint =
        res.status === 403 || res.status === 401
          ? 'HTTP 403 — the site blocks automated fetches. Paste the job description text instead.'
          : res.status === 429
            ? 'HTTP 429 — rate limited by the site. Try again in a minute or paste the text.'
            : `HTTP ${res.status}`
      return { url: url.toString(), title: '', text: '', ok: false, error: hint }
    }
    const contentType = res.headers.get('content-type') || ''
    const raw = (await res.text()).slice(0, MAX_BYTES_PER_PAGE)
    if (contentType.includes('application/json')) {
      return { url: url.toString(), title: url.hostname, text: raw.slice(0, 40_000), ok: true }
    }
    return {
      url: url.toString(),
      title: extractTitle(raw) || url.hostname,
      text: htmlToText(raw),
      ok: true,
    }
  } catch (err) {
    return {
      url: url.toString(),
      title: '',
      text: '',
      ok: false,
      error: describeFetchFailure(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Node's fetch throws a bare "fetch failed" and hides the real reason in
 * `cause`, which leaves the user with nothing to act on.
 */
function describeFetchFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.toLowerCase().includes('abort')) {
    return `Timed out after ${FETCH_TIMEOUT_MS}ms — the site was too slow to respond.`
  }

  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string }) : undefined
  const code = cause?.code || ''

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Could not resolve the host. Check the URL and your internet connection.'
    case 'ECONNREFUSED':
      return 'Connection refused by the server.'
    case 'ECONNRESET':
      return 'Connection reset by the server — it may be blocking automated fetches.'
    case 'ETIMEDOUT':
      return 'Connection timed out. Check your network or proxy settings.'
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return `TLS certificate could not be verified (${code}).`
    default:
      break
  }

  const detail = cause?.message || code
  return detail ? `${message} (${detail})` : message
}

const NAV_RUN_THRESHOLD = 4
const SHORT_LINE_CHARS = 45

function looksLikeNavLine(line: string): boolean {
  if (line.length > SHORT_LINE_CHARS) return false
  if (/[.!?:]$/.test(line)) return false
  const words = line.split(/\s+/).filter(Boolean).length
  return words <= 6
}

/**
 * Drop menu/footer chrome: long runs of short, punctuation-free lines are
 * almost always navigation, and they otherwise dominate lexical ranking.
 */
export function stripBoilerplate(text: string): string {
  const lines = text.split('\n')
  const keep = new Array<boolean>(lines.length).fill(true)

  let runStart = 0
  for (let i = 0; i <= lines.length; i++) {
    const isNav = i < lines.length && looksLikeNavLine(lines[i].replace(/^- /, '').trim())
    if (!isNav) {
      if (i - runStart >= NAV_RUN_THRESHOLD) {
        for (let j = runStart; j < i; j++) keep[j] = false
      }
      runStart = i + 1
    }
  }

  const cleaned = lines
    .filter((_, i) => keep[i])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned.length >= 300 ? cleaned : text
}

/** Remove lines shared across pages of the same site (headers, footers, cookie bars). */
function dedupeAcrossPages(pages: Array<{ text: string }>): string[] {
  const seen = new Map<string, number>()
  for (const page of pages) {
    const unique = new Set(page.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3))
    for (const line of unique) seen.set(line, (seen.get(line) || 0) + 1)
  }
  return pages.map((page) => {
    const filtered = page.text
      .split('\n')
      .filter((l) => (seen.get(l.trim()) || 0) < 2)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return filtered.length >= 300 ? filtered : page.text
  })
}

function chunkText(text: string, maxChars = MAX_SNIPPET_CHARS): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  let current = ''

  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxChars) {
      if (current.length >= MIN_SNIPPET_CHARS) out.push(current)
      current = line.slice(0, maxChars)
    } else {
      current += (current ? '\n' : '') + line.slice(0, maxChars)
    }
  }
  if (current.length >= MIN_SNIPPET_CHARS) out.push(current)
  return out
}

/** Discover a small set of company pages worth reading. */
function companyCandidateUrls(html: string, jobUrl: URL): string[] {
  const candidates = new Set<string>()

  const canonicalHost = jobUrl.hostname.replace(/^www\./, '')
  const isBoard = /(lever|greenhouse|ashbyhq|workable|smartrecruiters|myworkdayjobs|jobvite)\./i.test(
    canonicalHost,
  )

  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map((m) => m[1])
  for (const href of links) {
    let abs: URL
    try {
      abs = new URL(href, jobUrl)
    } catch {
      continue
    }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue
    const host = abs.hostname.replace(/^www\./, '')

    if (/github\.com\/[^/]+\/?$/.test(abs.toString())) {
      candidates.add(abs.toString())
      continue
    }
    if (isBoard && host !== canonicalHost && !/\.(png|jpg|svg|css|js|pdf)$/i.test(abs.pathname)) {
      // Company site linked from a job board page
      if (/^\/?$|about|company|careers/i.test(abs.pathname)) {
        candidates.add(`${abs.protocol}//${abs.host}/`)
      }
    }
    if (!isBoard && host === canonicalHost && /about|company|press|news|blog|product/i.test(abs.pathname)) {
      candidates.add(abs.toString())
    }
  }

  if (!isBoard) {
    candidates.add(`${jobUrl.protocol}//${jobUrl.host}/about`)
  }

  return [...candidates].slice(0, MAX_PAGES - 1)
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'this', 'that', 'from', 'have',
  'has', 'will', 'been', 'they', 'their', 'about', 'into', 'work', 'team', 'role', 'job',
  'who', 'what', 'when', 'where', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'as', 'at', 'be',
  'we', 'us', 'it', 'or', 'by', 'not', 'but', 'all', 'can', 'more', 'than', 'also', 'may',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .split(/[\s/,-]+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOP.has(t))
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
  return tf
}

/**
 * Lexical TF-IDF cosine ranking. Keeps retrieval fully local — no embedding
 * provider call, so research works in privacy mode and costs nothing.
 */
export function rankSnippets(
  query: string,
  snippets: Array<Omit<EvidenceSnippet, 'score'>>,
  topK = 8,
): EvidenceSnippet[] {
  if (!snippets.length) return []
  const docs = snippets.map((s) => termFreq(tokenize(s.text)))
  const df = new Map<string, number>()
  for (const doc of docs) {
    for (const term of doc.keys()) df.set(term, (df.get(term) || 0) + 1)
  }
  const n = docs.length
  const idf = (term: string) => Math.log(1 + n / (1 + (df.get(term) || 0)))

  const queryTf = termFreq(tokenize(query))
  let qNorm = 0
  for (const [term, freq] of queryTf) {
    const w = freq * idf(term)
    qNorm += w * w
  }
  qNorm = Math.sqrt(qNorm) || 1

  const scored = snippets.map((snippet, i) => {
    const doc = docs[i]
    let dot = 0
    let dNorm = 0
    for (const [term, freq] of doc) {
      const w = freq * idf(term)
      dNorm += w * w
      const qf = queryTf.get(term)
      if (qf) dot += w * (qf * idf(term))
    }
    dNorm = Math.sqrt(dNorm) || 1
    const cosine = dot / (qNorm * dNorm)
    const kindBoost = snippet.kind === 'job' ? 1.15 : snippet.kind === 'repo' ? 1.05 : 1
    return { ...snippet, score: Math.round(Math.min(1, cosine * kindBoost) * 100) }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}

/** Build evidence from text the user pasted — no network involved. */
export function contextFromPastedText(text: string, topK = 8): JobContext {
  const clean = stripBoilerplate(text.trim())
  const pool: Array<Omit<EvidenceSnippet, 'score'>> = chunkText(
    clean,
    PASTED_SNIPPET_CHARS,
  ).map((chunk, i) => ({
    id: `S${i + 1}`,
    sourceUrl: '',
    sourceTitle: 'Pasted job description',
    kind: 'job' as const,
    text: chunk,
  }))
  const firstLine = clean.split('\n')[0] || 'Pasted job description'
  return {
    url: '',
    title: firstLine.slice(0, 120),
    company: '',
    companyUrl: '',
    jobText: clean.slice(0, 20_000),
    snippets: rankSnippets(clean, pool, topK),
    fetchedPages: [],
    cached: false,
    fetchedAt: new Date().toISOString(),
  }
}

export async function fetchJobContext(args: {
  workspace: string | null
  url: string
  jobDescription?: string
  pastedText?: string
  topK?: number
  refresh?: boolean
}): Promise<JobContext> {
  const { workspace, url, jobDescription = '', pastedText = '', topK = 8, refresh = false } = args

  if (!url.trim()) {
    if (!pastedText.trim()) throw new Error('Provide a job URL or paste the job description.')
    return contextFromPastedText(pastedText, topK)
  }

  const jobUrl = assertSafeUrl(url)
  const cacheKey = jobUrl.toString()

  if (workspace && !refresh) {
    const cache = await readCache(workspace)
    const hit = cache[cacheKey]
    if (hit && Date.now() - new Date(hit.fetchedAt).getTime() < CACHE_TTL_MS) {
      const query = (jobDescription.trim() || hit.jobText).slice(0, 8000)
      return {
        ...hit,
        cached: true,
        snippets: rankSnippets(query, hit.snippets, topK),
      }
    }
  }

  const jobPage = await fetchPage(jobUrl.toString())
  if (!jobPage.ok) {
    if (pastedText.trim()) {
      const fallback = contextFromPastedText(pastedText, topK)
      return { ...fallback, url: jobUrl.toString() }
    }
    throw new Error(`Could not fetch job page: ${jobPage.error || 'unknown error'}`)
  }

  const rawHtmlRes = await fetch(jobUrl.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 ResumeStudio/1.0' },
  }).catch(() => null)
  const rawHtml = rawHtmlRes ? (await rawHtmlRes.text().catch(() => '')).slice(0, MAX_BYTES_PER_PAGE) : ''

  const title = jobPage.title
  const company = extractCompany(rawHtml, jobUrl, title)

  const companyUrls = companyCandidateUrls(rawHtml, jobUrl)
  const companyPages = await Promise.all(companyUrls.map((u) => fetchPage(u)))
  const allPages = [jobPage, ...companyPages]

  const fetchedPages: JobContext['fetchedPages'] = allPages.map((p) => ({
    url: p.url,
    title: p.title,
    chars: p.text.length,
    ok: p.ok,
    error: p.error,
  }))

  const okPages = allPages.filter((p) => p.ok && p.text)
  const deduped = dedupeAcrossPages(okPages).map(stripBoilerplate)

  const pool: Array<Omit<EvidenceSnippet, 'score'>> = []
  let sid = 1
  okPages.forEach((page, i) => {
    const isJob = page.url === jobPage.url
    const kind: EvidenceSnippet['kind'] = isJob
      ? 'job'
      : /github\.com/i.test(page.url)
        ? 'repo'
        : 'company'
    const chunks = chunkText(deduped[i]).slice(0, isJob ? 20 : 8)
    for (const chunk of chunks) {
      pool.push({
        id: `S${sid++}`,
        sourceUrl: page.url,
        sourceTitle: page.title || (isJob ? 'Job posting' : page.url),
        kind,
        text: chunk,
      })
    }
  })

  const cleanJobText = deduped[0] || jobPage.text

  const context: JobContext = {
    url: jobUrl.toString(),
    title,
    company,
    companyUrl: `${jobUrl.protocol}//${jobUrl.host}`,
    jobText: cleanJobText.slice(0, 20_000),
    snippets: pool.map((s) => ({ ...s, score: 0 })),
    fetchedPages,
    cached: false,
    fetchedAt: new Date().toISOString(),
  }

  if (workspace) {
    const cache = await readCache(workspace)
    cache[cacheKey] = context
    await writeCache(workspace, cache)
  }

  const query = (jobDescription.trim() || cleanJobText).slice(0, 8000)
  return { ...context, snippets: rankSnippets(query, pool, topK) }
}

/** Rank evidence for an arbitrary query against already-fetched snippets. */
export function getTopEvidence(
  jobText: string,
  snippets: Array<Omit<EvidenceSnippet, 'score'>>,
  topK = 8,
): EvidenceSnippet[] {
  return rankSnippets(jobText, snippets, topK)
}
