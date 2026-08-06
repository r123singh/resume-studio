import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { listApplications } from './applications'

export type JobListing = {
  id: string
  title: string
  company: string
  location: string
  jobUrl: string
  source: 'RemoteOK' | 'Remotive'
  description: string
  tags: string[]
  score: number
  scoreReasons: string[]
  alreadyTracked: boolean
}

export type JobHuntPreferences = {
  keywords: string[]
  domains: string[]
  hardSkip: string[]
  excludeCompanies: string[]
  maxResults: number
  preferRemote: boolean
  baseLocation: string
}

const DEFAULT_PREFS: JobHuntPreferences = {
  keywords: [
    'Senior Product Manager',
    'Product Manager',
    'AI Product',
    'Platform',
  ],
  domains: ['AI', 'SaaS', 'B2B', 'platform', 'enterprise'],
  hardSkip: ['intern', 'internship', 'junior', 'associate product', 'unpaid'],
  excludeCompanies: [],
  maxResults: 15,
  preferRemote: true,
  baseLocation: '',
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function ensureJobPreferences(workspace: string) {
  const p = path.join(workspace, 'job-preferences.md')
  if (fsSync.existsSync(p)) return p
  await fs.writeFile(
    p,
    `# Job Search Preferences

## Target roles (search keywords)
- Senior Product Manager
- Product Manager
- AI Product Manager
- Platform Product Manager

## Domains / strengths (boost matches)
- SaaS, B2B, enterprise
- AI / ML products
- Platform / integrations

## Location & remote
- Base location: 
- Remote: Yes — prefer remote / worldwide

## Hard filters (skip if violated)
- No junior / associate / intern / unpaid

## Exclude companies
- (none)

## Search behavior
- Max roles per run: 15
`,
    'utf8',
  )
  return p
}

export async function readJobPreferences(workspace: string): Promise<JobHuntPreferences> {
  await ensureJobPreferences(workspace)
  const raw = await fs.readFile(path.join(workspace, 'job-preferences.md'), 'utf8')
  const prefs = { ...DEFAULT_PREFS, keywords: [...DEFAULT_PREFS.keywords], domains: [...DEFAULT_PREFS.domains] }

  const section = (name: string) => {
    const re = new RegExp(`##\\s+${name}[\\s\\S]*?(?=\\n##\\s+|$)`, 'i')
    const m = raw.match(re)
    return m ? m[0] : ''
  }

  const bullets = (text: string) =>
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('(none)'))

  const roles = bullets(section('Target roles'))
  if (roles.length) prefs.keywords = roles

  const domains = bullets(section('Domains'))
  if (domains.length) {
    prefs.domains = domains.flatMap((d) =>
      d.split(/[,/]/).map((x) => x.trim()).filter(Boolean),
    )
  }

  const hard = bullets(section('Hard filters'))
  if (hard.length) {
    prefs.hardSkip = hard
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9+]+/)
      .filter((w) => w.length > 2)
  }

  const exclude = bullets(section('Exclude companies')).filter(
    (c) => !/^\(none\)$/i.test(c),
  )
  prefs.excludeCompanies = exclude.map((c) => c.toLowerCase())

  const locSec = section('Location')
  if (/remote:\s*\*?\*?yes/i.test(locSec) || /prefer remote/i.test(locSec)) {
    prefs.preferRemote = true
  }
  const base = locSec.match(/Base location:\s*(.+)/i)
  if (base) prefs.baseLocation = base[1].replace(/\*+/g, '').trim()

  const max = raw.match(/Max roles[^:]*:\s*(\d+)/i)
  if (max) prefs.maxResults = Math.min(30, Math.max(5, Number(max[1])))

  return prefs
}

async function fetchRemoteOk(query: string): Promise<Omit<JobListing, 'score' | 'scoreReasons' | 'alreadyTracked'>[]> {
  const res = await fetch('https://remoteok.com/api', {
    headers: {
      'User-Agent': 'ResumeStudio/1.0 (job-hunt)',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`RemoteOK error ${res.status}`)
  const data = (await res.json()) as Array<Record<string, unknown>>
  const q = query.toLowerCase()
  const out: Omit<JobListing, 'score' | 'scoreReasons' | 'alreadyTracked'>[] = []
  for (const item of data) {
    if (!item || item.legal) continue
    const title = String(item.position || item.title || '')
    const company = String(item.company || '')
    if (!title || !company) continue
    const hay = `${title} ${company} ${String(item.tags || '')} ${String(item.description || '')}`.toLowerCase()
    if (q && !q.split(/\s+/).some((t) => t.length > 2 && hay.includes(t))) {
      // keep some broad remote PM hits even if partial
      if (!hay.includes('product') && !hay.includes(q)) continue
    }
    const url = String(item.url || item.apply_url || '')
    const absUrl = url.startsWith('http')
      ? url
      : url
        ? `https://remoteok.com${url.startsWith('/') ? '' : '/'}${url}`
        : `https://remoteok.com/remote-jobs/${item.id || ''}`
    out.push({
      id: `remoteok-${item.id || title}`,
      title,
      company,
      location: String(item.location || 'Remote'),
      jobUrl: absUrl,
      source: 'RemoteOK',
      description: stripHtml(String(item.description || '')).slice(0, 12000),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    })
  }
  return out
}

async function fetchRemotive(query: string): Promise<Omit<JobListing, 'score' | 'scoreReasons' | 'alreadyTracked'>[]> {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=50`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ResumeStudio/1.0 (job-hunt)',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Remotive error ${res.status}`)
  const data = (await res.json()) as { jobs?: Array<Record<string, unknown>> }
  const out: Omit<JobListing, 'score' | 'scoreReasons' | 'alreadyTracked'>[] = []
  for (const item of data.jobs || []) {
    const title = String(item.title || '')
    const company = String(item.company_name || '')
    if (!title || !company) continue
    out.push({
      id: `remotive-${item.id || title}`,
      title,
      company,
      location: String(item.candidate_required_location || 'Remote'),
      jobUrl: String(item.url || ''),
      source: 'Remotive',
      description: stripHtml(String(item.description || '')).slice(0, 12000),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    })
  }
  return out
}

function scoreListing(
  job: Omit<JobListing, 'score' | 'scoreReasons' | 'alreadyTracked'>,
  prefs: JobHuntPreferences,
  query: string,
): { score: number; reasons: string[] } {
  const hay = `${job.title} ${job.company} ${job.location} ${job.tags.join(' ')} ${job.description.slice(0, 2000)}`.toLowerCase()
  const reasons: string[] = []
  let score = 40

  for (const skip of prefs.hardSkip) {
    if (skip.length > 2 && hay.includes(skip.toLowerCase())) {
      return { score: 0, reasons: [`Hard filter: ${skip}`] }
    }
  }
  if (prefs.excludeCompanies.some((c) => c && job.company.toLowerCase().includes(c))) {
    return { score: 0, reasons: ['Excluded company'] }
  }

  const qTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  let qHits = 0
  for (const t of qTerms) {
    if (hay.includes(t)) qHits++
  }
  if (qHits) {
    score += Math.min(25, qHits * 8)
    reasons.push(`Query match ×${qHits}`)
  }

  for (const kw of prefs.keywords) {
    const parts = kw.toLowerCase().split(/\s+/).filter(Boolean)
    if (parts.every((p) => hay.includes(p)) || hay.includes(kw.toLowerCase())) {
      score += 8
      reasons.push(`Role: ${kw}`)
      break
    }
  }

  for (const d of prefs.domains) {
    if (d.length > 1 && hay.includes(d.toLowerCase())) {
      score += 4
      reasons.push(`Domain: ${d}`)
    }
  }

  if (/senior|staff|principal|lead|group/i.test(job.title)) {
    score += 10
    reasons.push('Seniority')
  }
  if (/product manager|product management|\bpm\b/i.test(job.title)) {
    score += 12
    reasons.push('PM title')
  }
  if (prefs.preferRemote && /remote|worldwide|anywhere/i.test(job.location + job.title)) {
    score += 5
    reasons.push('Remote')
  }
  if (/usa only|us only|united states only|must be (located )?in the (us|united states)/i.test(hay)) {
    score -= 15
    reasons.push('Possible US-only geo')
  }

  return { score: Math.max(0, Math.min(100, score)), reasons: reasons.slice(0, 4) }
}

export async function searchJobs(args: {
  workspace: string
  query: string
}): Promise<JobListing[]> {
  const query = args.query.trim() || 'product manager'
  const prefs = await readJobPreferences(args.workspace)
  const tracked = await listApplications(args.workspace)
  const trackedUrls = new Set(
    tracked.map((t) => t.jobUrl.trim().toLowerCase()).filter(Boolean),
  )

  const results = await Promise.allSettled([
    fetchRemoteOk(query),
    fetchRemotive(query),
  ])

  const merged: Omit<JobListing, 'score' | 'scoreReasons' | 'alreadyTracked'>[] = []
  const errors: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') merged.push(...r.value)
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  }
  if (!merged.length && errors.length) {
    throw new Error(`Job search failed: ${errors.join('; ')}`)
  }

  const seen = new Set<string>()
  const scored: JobListing[] = []
  for (const job of merged) {
    const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const { score, reasons } = scoreListing(job, prefs, query)
    if (score < 35) continue
    const alreadyTracked = trackedUrls.has(job.jobUrl.trim().toLowerCase())
    scored.push({
      ...job,
      score: alreadyTracked ? Math.max(0, score - 20) : score,
      scoreReasons: alreadyTracked ? [...reasons, 'Already in tracker'] : reasons,
      alreadyTracked,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, prefs.maxResults)
}
