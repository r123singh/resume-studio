import { parseFrontmatter } from './apply-kit'

export type LensMode = 'edit' | 'ats' | 'scan'

export type LensIssue = {
  id: string
  severity: 'error' | 'warn' | 'info'
  message: string
  lineHint?: string
}

export type HeatZone = {
  id: string
  label: string
  weight: number // 0-1 attention weight
  pattern: RegExp
}

export type RecruiterLensReport = {
  ats: {
    name: boolean
    email: boolean
    phone: boolean
    linkedin: boolean
    experienceRoles: number
    skillsCount: number
    sectionOrderOk: boolean
    sectionsFound: string[]
  }
  keywords: {
    score: number
    matched: string[]
    missing: string[]
    totalFromJd: number
  }
  hierarchy: LensIssue[]
  skimSummary: string
  heatLines: Array<{ line: number; weight: number; reasons: string[] }>
}

const SECTION_RE = /^##\s+(.+)$/gm
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/
const LINKEDIN_RE = /linkedin\.com\/in\//i
const METRIC_RE = /\b\d+(?:\.\d+)?%|\b\d+\+?\s*(?:x|times|users|customers|companies|months|years|\$|usd|inr)\b/i
const DATE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\b\d{4}\s*[–—-]\s*(?:\d{4}|Present|Current)\b/i
const TITLE_LINE_RE = /^#{1,4}\s+.+/
const ROLE_LINE_RE = /^#{2,4}\s*.+\|.+/i
const BULLET_RE = /^\s*[-*]\s+/

function extractJdKeywords(jd: string): string[] {
  if (!jd.trim()) return []
  const stop = new Set([
    'and',
    'the',
    'with',
    'for',
    'you',
    'your',
    'our',
    'will',
    'are',
    'this',
    'that',
    'from',
    'have',
    'has',
    'been',
    'into',
    'able',
    'work',
    'team',
    'role',
    'job',
    'experience',
    'years',
    'using',
    'across',
    'such',
    'other',
    'about',
    'their',
    'they',
    'must',
    'should',
    'including',
    'required',
    'requirements',
    'responsibilities',
    'preferred',
    'strong',
    'good',
    'etc',
  ])
  const words = jd
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s/-]/g, ' ')
    .split(/[\s,/|]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w))

  const phrases: string[] = []
  const text = jd.toLowerCase()
  const phraseCandidates = [
    'product manager',
    'product management',
    'machine learning',
    'artificial intelligence',
    'go to market',
    'go-to-market',
    'user experience',
    'road map',
    'roadmap',
    'a/b testing',
    'cross-functional',
    'stakeholder management',
    'agentic ai',
    'generative ai',
    'b2b saas',
  ]
  for (const p of phraseCandidates) {
    if (text.includes(p)) phrases.push(p)
  }

  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1)
  const top = [...freq.entries()]
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([w]) => w)

  return [...new Set([...phrases, ...top])].slice(0, 30)
}

function findSections(body: string): { name: string; index: number }[] {
  const found: { name: string; index: number }[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(SECTION_RE)
  while ((m = re.exec(body)) !== null) {
    found.push({ name: m[1].trim().toLowerCase(), index: m.index })
  }
  return found
}

function lineWeight(line: string): { weight: number; reasons: string[] } {
  const reasons: string[] = []
  let weight = 0.08
  if (TITLE_LINE_RE.test(line) && line.startsWith('# ') && !line.startsWith('##')) {
    weight = Math.max(weight, 0.95)
    reasons.push('Name / headline')
  }
  if (/^#\s+/.test(line) && /product|manager|engineer|designer/i.test(line)) {
    weight = Math.max(weight, 0.9)
    reasons.push('Target title')
  }
  if (ROLE_LINE_RE.test(line) || /\|\s*\w+/.test(line) && /^#{2,4}/.test(line)) {
    weight = Math.max(weight, 0.85)
    reasons.push('Role / company')
  }
  if (DATE_RE.test(line)) {
    weight = Math.max(weight, 0.7)
    reasons.push('Dates')
  }
  if (METRIC_RE.test(line)) {
    weight = Math.max(weight, 0.8)
    reasons.push('Metric')
  }
  if (/^##\s+skills/i.test(line) || (/skills/i.test(line) && /^##/.test(line))) {
    weight = Math.max(weight, 0.75)
    reasons.push('Skills heading')
  }
  if (BULLET_RE.test(line) && METRIC_RE.test(line)) {
    weight = Math.max(weight, 0.78)
    reasons.push('Achievement')
  }
  if (BULLET_RE.test(line) && line.length > 180) {
    weight = Math.min(weight, 0.25)
    reasons.push('Dense bullet')
  }
  if (/^---$/.test(line.trim()) || line.startsWith('company:') || line.startsWith('role:')) {
    weight = 0.05
    reasons.push('Meta')
  }
  return { weight, reasons }
}

export function analyzeRecruiterLens(markdown: string, jobDescription = ''): RecruiterLensReport {
  const { meta, body } = parseFrontmatter(markdown)
  const full = markdown
  const lines = full.split(/\r?\n/)

  const email = EMAIL_RE.test(full)
  const phone = PHONE_RE.test(full)
  const linkedin = LINKEDIN_RE.test(full)

  // Name: first H1 after frontmatter
  const h1 = body.match(/^#\s+(.+)$/m)
  const nameDetected = Boolean(h1 && h1[1].trim().length > 1 && !/summary|experience|skills/i.test(h1[1]))

  const sections = findSections(body)
  const sectionNames = sections.map((s) => s.name)
  const hasExperience = sectionNames.some((s) => /experience|work history/i.test(s))
  const hasSkills = sectionNames.some((s) => /skill/i.test(s))
  const hasSummary = sectionNames.some((s) => /summary|profile|about/i.test(s))

  const roleMatches = body.match(/^#{2,4}\s*.+\|/gm) || body.match(/\|\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})/gim) || []
  const experienceRoles = Math.max(
    (body.match(/^#{3,4}\s+.+/gm) || []).filter((l) => /\|/.test(l) || /product|manager|engineer|lead|director/i.test(l))
      .length,
    (body.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}/gi) || []).length > 0
      ? Math.min(6, Math.ceil(((body.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}/gi) || []).length) / 2))
      : 0,
  )

  const skillsBlock = body.match(/##\s+Skills[\s\S]*?(?=\n##\s+|$)/i)?.[0] || ''
  const skillsCount = (skillsBlock.match(/[-*•]|,\s*|\||;/g) || []).length
    ? Math.max(
        (skillsBlock.match(/[-*]\s+/g) || []).length,
        skillsBlock.split(/[,|;]/).filter((x) => x.trim().length > 2).length - 1,
      )
    : 0

  type IdealSection = 'summary' | 'experience' | 'skills' | 'education'
  const idealOrder: IdealSection[] = ['summary', 'experience', 'skills', 'education']
  const presentIdeal = idealOrder.filter((s) =>
    sectionNames.some((n) => n.includes(s) || (s === 'summary' && /profile|about/.test(n))),
  )
  const actualOrder = sectionNames
    .map((n): IdealSection | null => {
      if (/summary|profile|about/.test(n)) return 'summary'
      if (/experience|work/.test(n)) return 'experience'
      if (/skill/.test(n)) return 'skills'
      if (/education|certification/.test(n)) return 'education'
      return null
    })
    .filter((s): s is IdealSection => s !== null)
  const sectionOrderOk =
    presentIdeal.length < 2 ||
    presentIdeal.every((s, i) => {
      const a = actualOrder.indexOf(s)
      const prev = i === 0 ? null : presentIdeal[i - 1]
      const b = prev ? actualOrder.indexOf(prev) : -1
      if (i === 0) return a !== -1
      return a === -1 || b === -1 || a > b
    })

  const lineOf = (pred: (l: string) => boolean): string | undefined => {
    const idx = lines.findIndex(pred)
    return idx >= 0 ? String(idx + 1) : undefined
  }

  const issues: LensIssue[] = []
  if (!nameDetected) {
    issues.push({
      id: 'name',
      severity: 'error',
      message: 'Name / headline H1 not clearly detected at the top.',
      lineHint: lineOf((l) => /^#\s+/.test(l)) || '1',
    })
  }
  if (!email) {
    issues.push({
      id: 'email',
      severity: 'error',
      message: 'Email not detected — ATS may miss contact.',
      lineHint: '1',
    })
  }
  if (!phone) {
    issues.push({
      id: 'phone',
      severity: 'warn',
      message: 'Phone number not detected.',
      lineHint: '1',
    })
  }
  if (!hasSummary) {
    issues.push({
      id: 'summary',
      severity: 'warn',
      message: 'No Summary section — skim value is lower.',
      lineHint: '1',
    })
  }
  if (!hasExperience) {
    issues.push({
      id: 'experience',
      severity: 'error',
      message: 'No Experience section detected.',
      lineHint: '1',
    })
  }
  if (!hasSkills) {
    issues.push({
      id: 'skills',
      severity: 'warn',
      message: 'Skills section missing or not headed clearly.',
      lineHint: '1',
    })
  }
  if (hasSkills) {
    const skillsIdx = sections.find((s) => /skill/.test(s.name))?.index ?? -1
    const expIdx = sections.find((s) => /experience|work/.test(s.name))?.index ?? -1
    if (skillsIdx > -1 && expIdx > -1 && skillsIdx > expIdx + 800) {
      issues.push({
        id: 'skills-low',
        severity: 'warn',
        message: 'Skills section sits far below Experience — recruiters may miss it in a skim.',
        lineHint: lineOf((l) => /^##\s+.*skill/i.test(l)),
      })
    }
  }
  if (!sectionOrderOk) {
    issues.push({
      id: 'order',
      severity: 'info',
      message: 'Section order is non-standard. Prefer Summary → Experience → Skills → Education.',
      lineHint: lineOf((l) => /^##\s+/.test(l)),
    })
  }

  const longBulletIdx = lines.findIndex((l) => BULLET_RE.test(l) && l.length > 160)
  const longBullets = lines.filter((l) => BULLET_RE.test(l) && l.length > 160).length
  if (longBullets >= 3) {
    issues.push({
      id: 'dense',
      severity: 'warn',
      message: `${longBullets} long bullets detected — dense text gets skipped in a 6-second skim.`,
      lineHint: longBulletIdx >= 0 ? String(longBulletIdx + 1) : undefined,
    })
  }

  const metricBullets = lines.filter((l) => BULLET_RE.test(l) && METRIC_RE.test(l)).length
  const totalBullets = lines.filter((l) => BULLET_RE.test(l)).length
  const firstBullet = lines.findIndex((l) => BULLET_RE.test(l))
  if (totalBullets >= 4 && metricBullets / totalBullets < 0.25) {
    issues.push({
      id: 'metrics',
      severity: 'warn',
      message: 'Few measurable outcomes — achievements may not stand out in recruiter scan.',
      lineHint: firstBullet >= 0 ? String(firstBullet + 1) : undefined,
    })
  }

  const tableLine = lines.findIndex((l) => /\|.+\|/.test(l))
  if (/\|.+\|/.test(body) && (body.match(/\|/g) || []).length > 8) {
    issues.push({
      id: 'tables',
      severity: 'error',
      message: 'Table-like layout detected — many ATS parsers fail on tables.',
      lineHint: tableLine >= 0 ? String(tableLine + 1) : undefined,
    })
  }

  const titleProminence = lines.slice(0, 25).some((l) => /^#\s+/.test(l) && /product|manager|engineer|design|director|lead/i.test(l))
  if (!titleProminence && !meta.role) {
    issues.push({
      id: 'title',
      severity: 'warn',
      message: 'Target job title is not prominent near the top.',
      lineHint: '1',
    })
  }

  const jdKeywords = extractJdKeywords(jobDescription)
  const hay = full.toLowerCase()
  const matched = jdKeywords.filter((k) => hay.includes(k.toLowerCase()))
  const missing = jdKeywords.filter((k) => !hay.includes(k.toLowerCase())).slice(0, 12)
  const keywordScore =
    jdKeywords.length === 0
      ? 0
      : Math.round((matched.length / Math.max(1, Math.min(jdKeywords.length, 20))) * 100)

  if (jdKeywords.length && keywordScore < 40) {
    issues.push({
      id: 'keywords',
      severity: 'warn',
      message: `Keyword alignment is low (${keywordScore}%). Missing terms like: ${missing.slice(0, 5).join(', ')}.`,
      lineHint: lineOf((l) => /^##\s+skills/i.test(l)) || lineOf((l) => /^##\s+/.test(l)) || '1',
    })
  }

  const heatLines = lines.map((line, idx) => {
    const { weight, reasons } = lineWeight(line)
    return { line: idx + 1, weight, reasons }
  })

  const topHeat = [...heatLines].sort((a, b) => b.weight - a.weight).slice(0, 5)
  const skimSummary =
    keywordScore > 0
      ? `In a 6-second skim, recruiters will likely notice ${topHeat
          .filter((h) => h.weight >= 0.7)
          .map((h) => h.reasons[0] || `L${h.line}`)
          .slice(0, 3)
          .join(', ') || 'headlines and dates'}. Keyword match ${keywordScore}%. ${
          longBullets >= 3 ? 'Dense bullets may hide achievements.' : 'Bullet density looks manageable.'
        }`
      : `In a 6-second skim, attention clusters on ${topHeat
          .map((h) => h.reasons[0] || `line ${h.line}`)
          .slice(0, 3)
          .join(', ')}. Paste a JD in Tailor/Hunt for keyword scoring.`

  return {
    ats: {
      name: nameDetected,
      email,
      phone,
      linkedin,
      experienceRoles: experienceRoles || roleMatches.length,
      skillsCount: Math.max(0, skillsCount),
      sectionOrderOk,
      sectionsFound: sectionNames,
    },
    keywords: {
      score: keywordScore,
      matched: matched.slice(0, 15),
      missing,
      totalFromJd: jdKeywords.length,
    },
    hierarchy: issues,
    skimSummary,
    heatLines,
  }
}

export const HEAT_LEGEND: HeatZone[] = [
  { id: 'title', label: 'Titles', weight: 0.9, pattern: /^#/ },
  { id: 'metrics', label: 'Metrics', weight: 0.8, pattern: METRIC_RE },
  { id: 'dates', label: 'Dates', weight: 0.7, pattern: DATE_RE },
  { id: 'skills', label: 'Skills', weight: 0.75, pattern: /skill/i },
]
