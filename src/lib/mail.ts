/**
 * Mail Inbox — local email ingest for recruiter mail and job alerts.
 *
 * LinkedIn / Naukri / Indeed dumps and recruiter forwards never hit Hunt boards.
 * Parse a paste, .eml, or IMAP message, extract the role, and draft a reply
 * the user sends from their own client. Nothing is auto-sent.
 */

export type MailSource =
  | 'LinkedIn'
  | 'Naukri'
  | 'Indeed'
  | 'Greenhouse'
  | 'Lever'
  | 'Ashby'
  | 'Workday'
  | 'Wellfound'
  | 'Instahyre'
  | 'Cutshort'
  | 'Recruiter'
  | 'Alert'
  | 'Other'

export type ParsedMail = {
  from: string
  fromEmail: string
  replyTo: string
  subject: string
  date: string
  company: string
  role: string
  location: string
  jobUrl: string
  recruiter: string
  source: MailSource
  jobText: string
  isJob: boolean
  jobLikelihood: number
  reasons: string[]
}

export type MailReply = {
  subject: string
  body: string
}

export type MailListing = {
  id: string
  uid?: number
  from: string
  fromEmail: string
  replyTo: string
  subject: string
  date: string
  company: string
  role: string
  location: string
  jobUrl: string
  recruiter: string
  source: MailSource | string
  description: string
  jobLikelihood: number
  score: number
  scoreReasons: string[]
  alreadyTracked: boolean
}

const ROLE_PATTERNS = [
  /(?:opening|role|hiring|looking)\s+(?:for|a|an)\s+([^.\n]{6,80})/i,
  /(?:job\s*title|position|designation|title)\s*[:\-–]\s*([^\n]{4,80})/i,
  /\bwe are hiring\s+(?:a|an)?\s*([^.\n]{6,80})/i,
  /\binvited you to apply(?: for)?\s+(?:the\s+)?([^.\n]{6,80})/i,
  /\bapply to\s+(?:the\s+)?([^.\n]{6,80}?)\s+(?:at|role)\b/i,
]

const COMPANY_PATTERNS = [
  /(?:company|org(?:anisation|anization)?|employer)\s*[:\-–]\s*([^\n]{2,60})/i,
  /\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,40})\s+(?:is hiring|we are hiring)/,
  /\bfor ([A-Z][A-Za-z0-9&.\- ]{1,40})\s+\(/,
  /\bthis is \w+ from ([A-Z][A-Za-z0-9&.\- ]{1,40})/i,
  /^(.+?)\s+is hiring\b/im,
  /\brole at\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/i,
]

const LOCATION_PATTERNS = [
  /(?:location|based in|office)\s*[:\-–]\s*([^\n]{2,60})/i,
  /\(([^)]*(?:remote|bangalore|bengaluru|hyderabad|mumbai|delhi|pune|gurgaon|gurugram|noida|chennai)[^)]*)\)/i,
  /\b(Remote(?:\s*\/\s*[A-Za-z ]+)?|Bangalore|Bengaluru|Hyderabad|Mumbai|Delhi(?: NCR)?|Pune|Gurugram|Gurgaon|Noida|Chennai|Worldwide)\b/i,
]

const JOB_URL_RE =
  /https?:\/\/(?:www\.)?(?:linkedin\.com\/jobs\/(?:view|collections)\/[^\s)]+|naukri\.com\/[^\s)]+|indeed\.com\/(?:viewjob|cmp)[^\s)]+|boards\.greenhouse\.io\/[^\s)]+|jobs\.lever\.co\/[^\s)]+|jobs\.ashbyhq\.com\/[^\s)]+|myworkdayjobs\.com\/[^\s)]+|wellfound\.com\/[^\s)]+|instahyre\.com\/[^\s)]+|cutshort\.io\/[^\s)]+)/i

const ANY_URL_RE = /https?:\/\/[^\s)<>"]+/gi

const SKIP_URL =
  /unsubscribe|mailto:|linkedin\.com\/comm\/|linkedin\.com\/preload|fonts\.google|google-analytics|doubleclick|facebook\.com\/tr|tracking|pixel|cid:|schema\.org/i

const TITLE_LINE =
  /^(?:senior |staff |principal |group |lead |head of )?(?:product manager|program manager|engineering manager|engineering lead|designer|software engineer|frontend engineer|backend engineer|full[- ]stack|data scientist|product designer)[^\n]{0,50}$/im

export const SAMPLE_JOB_EMAIL = `From: Ananya Sharma <ananya@talentgrid.in>
Reply-To: Ananya Sharma <ananya@talentgrid.in>
Date: Tue, 15 Sep 2026 09:12:03 +0530
Subject: Senior Product Manager – AI at Simpplr (Remote / Bangalore)

Hi,

This is Ananya from TalentGrid. We are hiring a Senior Product Manager – AI for Simpplr (Remote / Bangalore).

JD below — please share your updated CV if interested.

Senior Product Manager, AI Products
Simpplr — Bangalore / Remote
https://simpplr.com/careers/spm-ai

We are looking for a PM to own AI features on our employee intranet. You will ship LLM-assisted search, summarization, and agent workflows for enterprise customers.

Requirements:
- 6+ years product, ideally B2B SaaS
- Shipped at least one LLM or applied-AI feature
- Comfortable with enterprise discovery and rollout

Thanks,
Ananya
`

export const SAMPLE_LINKEDIN_ALERT = `From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>
Date: Tue, 15 Sep 2026 07:40:11 +0000
Subject: 8 new Senior Product Manager jobs in Bengaluru

Your job alert for Senior Product Manager

Senior Product Manager, AI Products
Simpplr · Bengaluru, India (Remote)
https://www.linkedin.com/jobs/view/4299810234

Staff Product Manager, Platform
Razorpay · Bengaluru, India
https://www.linkedin.com/jobs/view/4281109981

View more jobs on LinkedIn
`

export const IMAP_PRESETS = {
  gmail: { host: 'imap.gmail.com', port: 993, label: 'Gmail' },
  outlook: { host: 'outlook.office365.com', port: 993, label: 'Outlook / Microsoft 365' },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993, label: 'Yahoo' },
  zoho: { host: 'imap.zoho.com', port: 993, label: 'Zoho' },
  icloud: { host: 'imap.mail.me.com', port: 993, label: 'iCloud' },
  custom: { host: '', port: 993, label: 'Custom IMAP' },
} as const

export type ImapPresetId = keyof typeof IMAP_PRESETS

/** SMTP counterparts. Port 587 = STARTTLS; 465 = implicit TLS. */
export const SMTP_PRESETS: Record<
  Exclude<ImapPresetId, 'custom'>,
  { host: string; port: number }
> = {
  gmail: { host: 'smtp.gmail.com', port: 587 },
  outlook: { host: 'smtp.office365.com', port: 587 },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 587 },
  zoho: { host: 'smtp.zoho.com', port: 587 },
  icloud: { host: 'smtp.mail.me.com', port: 587 },
}

export function smtpFromImapHost(imapHost: string): { host: string; port: number } {
  const h = (imapHost || '').trim().toLowerCase()
  if (h.includes('gmail')) return SMTP_PRESETS.gmail
  if (h.includes('office365') || h.includes('outlook')) return SMTP_PRESETS.outlook
  if (h.includes('yahoo')) return SMTP_PRESETS.yahoo
  if (h.includes('zoho')) return SMTP_PRESETS.zoho
  if (h.includes('mail.me.com') || h.includes('icloud')) return SMTP_PRESETS.icloud
  return { host: imapHost.replace(/^imap\./i, 'smtp.').trim(), port: 587 }
}

/** One recipient only — rejects lists so Send cannot become a blast. */
export function normalizeRecipient(raw: string): string {
  const trimmed = (raw || '').trim().replace(/^mailto:/i, '')
  if (!trimmed || /[,;\n]/.test(trimmed)) return ''
  const { email } = parseAddress(trimmed)
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) return ''
  return email.toLowerCase()
}

function bytesToUtf8(bytes: number[] | Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(
    bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes),
  )
}

function decodeBase64(payload: string): string {
  const compact = payload.replace(/\s+/g, '')
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(compact, 'base64').toString('utf8')
  }
  const bin = atob(compact)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytesToUtf8(bytes)
}

export function decodeRfc2047(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g,
    (_all, _charset: string, enc: string, payload: string) => {
      try {
        if (enc.toUpperCase() === 'B') return decodeBase64(payload)
        return decodeQuotedPrintable(payload.replace(/_/g, ' '))
      } catch {
        return payload
      }
    },
  )
}

export function decodeQuotedPrintable(input: string): string {
  const soft = input.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /[0-9A-Fa-f]{2}/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(soft.charCodeAt(i))
    }
  }
  return bytesToUtf8(bytes)
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function unfoldHeaders(raw: string): string {
  return raw.replace(/\r?\n[ \t]+/g, ' ')
}

export function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const block = unfoldHeaders(raw)
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = decodeRfc2047(line.slice(idx + 1).trim())
    if (!key) continue
    headers[key] = headers[key] ? `${headers[key]} ${value}` : value
  }
  return headers
}

export function parseAddress(raw: string): { name: string; email: string } {
  const trimmed = raw.trim()
  const angled = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>/)
  if (angled) {
    return { name: angled[1].trim().replace(/^"|"$/g, ''), email: angled[2].trim() }
  }
  const emailOnly = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return { name: emailOnly ? trimmed.replace(emailOnly[0], '').trim() : trimmed, email: emailOnly?.[0] || '' }
}

function header(headers: Record<string, string>, name: string): string {
  return headers[name.toLowerCase()] || ''
}

function decodeBody(body: string, encoding: string, charset: string): string {
  const enc = encoding.toLowerCase()
  let text = body
  if (enc === 'base64') {
    try {
      text = decodeBase64(body)
    } catch {
      text = body
    }
  } else if (enc === 'quoted-printable') {
    text = decodeQuotedPrintable(body)
  }
  if (/utf-8|utf8|us-ascii|iso-8859/i.test(charset) || !charset) return text
  return text
}

function contentTypeAttr(ct: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*"?([^";\\s]+)"?`, 'i')
  return ct.match(re)?.[1] || ''
}

function splitMimeParts(body: string, boundary: string): string[] {
  const token = `--${boundary}`
  const chunks = body.split(token).slice(1)
  const parts: string[] = []
  for (const chunk of chunks) {
    if (chunk.startsWith('--')) break
    parts.push(chunk.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
  }
  return parts
}

function extractTextFromMime(raw: string): string {
  const splitAt = raw.search(/\r?\n\r?\n/)
  if (splitAt === -1) return stripHtml(raw)
  const headerBlock = raw.slice(0, splitAt)
  const body = raw.slice(splitAt).replace(/^\r?\n\r?\n/, '')
  const headers = parseHeaders(headerBlock)
  const ct = header(headers, 'content-type') || 'text/plain'
  const encoding = header(headers, 'content-transfer-encoding')
  const charset = contentTypeAttr(ct, 'charset')
  const boundary = contentTypeAttr(ct, 'boundary')

  if (/multipart\//i.test(ct) && boundary) {
    const parts = splitMimeParts(body, boundary)
    let html = ''
    let plain = ''
    for (const part of parts) {
      const text = extractTextFromMime(part)
      const partHead = parseHeaders(part.slice(0, part.search(/\r?\n\r?\n/) || 0))
      const partCt = header(partHead, 'content-type')
      if (/text\/plain/i.test(partCt) && text) plain = text
      else if (/text\/html/i.test(partCt) && text) html = text
      else if (/multipart\//i.test(partCt) && text) {
        if (!plain) plain = text
      }
    }
    return (plain || html).trim()
  }

  const decoded = decodeBody(body, encoding, charset)
  if (/text\/html/i.test(ct)) return stripHtml(decoded)
  if (/text\/plain/i.test(ct) || !ct) return decoded.trim()
  return ''
}

function tidyTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+for\s+[A-Z][A-Za-z0-9&.\- ]{1,40}$/g, '')
    .replace(/\s*[-,|]\s*(?:pls|please|kindly|share|cv|resume).*$/i, '')
    .replace(/^\d+\s+new\s+/i, '')
    .replace(/\s+jobs?\s+(?:in|for)\s+.+$/i, '')
    .replace(/[.,;:]+$/, '')
    .trim()
    .slice(0, 80)
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return tidyTitle(m[1])
  }
  return ''
}

function detectSource(fromEmail: string, subject: string, body: string): MailSource {
  const hay = `${fromEmail} ${subject} ${body.slice(0, 1500)}`.toLowerCase()
  if (hay.includes('linkedin.com') || hay.includes('linkedin')) return 'LinkedIn'
  if (hay.includes('naukri')) return 'Naukri'
  if (hay.includes('indeed')) return 'Indeed'
  if (hay.includes('greenhouse')) return 'Greenhouse'
  if (hay.includes('jobs.lever.co') || hay.includes('lever.co')) return 'Lever'
  if (hay.includes('ashbyhq')) return 'Ashby'
  if (hay.includes('myworkdayjobs') || hay.includes('workday')) return 'Workday'
  if (hay.includes('wellfound') || hay.includes('angel.co')) return 'Wellfound'
  if (hay.includes('instahyre')) return 'Instahyre'
  if (hay.includes('cutshort')) return 'Cutshort'
  if (/job alert|jobs for you|recommended jobs|new jobs matching/i.test(hay)) return 'Alert'
  if (
    /we are (?:hiring|looking)|job description|opening for|pls share (?:your )?(?:cv|resume)/i.test(
      hay,
    )
  ) {
    return 'Recruiter'
  }
  return 'Other'
}

export function extractJobUrl(text: string): string {
  const preferred = text.match(JOB_URL_RE)
  if (preferred) return preferred[0].replace(/[.,;]+$/, '')
  for (const match of text.matchAll(ANY_URL_RE)) {
    const url = match[0].replace(/[.,;]+$/, '')
    if (!SKIP_URL.test(url)) return url
  }
  return ''
}

function looksLikeJob(subject: string, body: string): { score: number; reasons: string[] } {
  const hay = `${subject}\n${body}`
  const reasons: string[] = []
  let score = 10
  const hits = [
    [/responsibilit/i, 'Responsibilities'],
    [/requirement/i, 'Requirements'],
    [/qualifications?/i, 'Qualifications'],
    [/job\s*description|\bjd\b/i, 'JD'],
    [/what you.?ll do/i, 'What you will do'],
    [/about the role/i, 'About the role'],
    [/\bwe are (?:looking|hiring)\b/i, 'Hiring'],
    [/\binvited you to apply\b/i, 'Invited to apply'],
    [/\bjob alert\b/i, 'Job alert'],
    [/\bshare your (?:updated )?(?:cv|resume)\b/i, 'Asked for CV'],
    [/\bapply (?:now|here|to this job)\b/i, 'Apply CTA'],
  ] as const
  for (const [re, label] of hits) {
    if (re.test(hay)) {
      score += 12
      reasons.push(label)
    }
  }
  if (JOB_URL_RE.test(hay)) {
    score += 18
    reasons.push('Job URL')
  }
  if (TITLE_LINE.test(hay)) {
    score += 10
    reasons.push('Job title line')
  }
  if (/unsubscribe|newsletter|invoice|otp|verification code|password reset/i.test(subject)) {
    score -= 40
    reasons.push('Looks transactional')
  }
  return { score: Math.max(0, Math.min(100, score)), reasons: reasons.slice(0, 5) }
}

function recruiterFrom(fromName: string, fromEmail: string, body: string): string {
  if (fromName && !/linkedin|naukri|indeed|noreply|no-reply|jobalert/i.test(fromName)) {
    return fromName
  }
  const intro = body.match(/\bthis is ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+from\b)/)
  if (intro) return intro[1]
  const sign = body.match(/\n(?:thanks|regards|best),?\s*\n([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/i)
  if (sign && !/linkedin|team/i.test(sign[1])) return sign[1]
  if (fromName) return fromName
  return fromEmail.split('@')[0] || ''
}

function extractLinkedInJobs(body: string): Array<{ role: string; company: string; location: string; jobUrl: string }> {
  const jobs: Array<{ role: string; company: string; location: string; jobUrl: string }> = []
  const lines = body.split(/\r?\n/).map((l) => l.trim())
  for (let i = 0; i < lines.length - 1; i++) {
    const title = lines[i]
    const meta = lines[i + 1]
    const urlLine = lines[i + 2] || ''
    const metaHit = meta.match(/^(.{2,60})\s*[·|]\s*(.+)$/)
    const url = extractJobUrl(`${urlLine}\n${meta}\n${title}`)
    if (
      metaHit &&
      title.length >= 8 &&
      title.length <= 80 &&
      !/job alert|view more|unsubscribe|linkedin/i.test(title) &&
      (url.includes('linkedin.com/jobs') || TITLE_LINE.test(title) || /product|engineer|manager|designer/i.test(title))
    ) {
      jobs.push({
        role: tidyTitle(title),
        company: tidyTitle(metaHit[1]),
        location: tidyTitle(metaHit[2]),
        jobUrl: url,
      })
      i += 1
    }
  }
  return jobs.slice(0, 8)
}

function listingId(parts: Array<string | undefined>): string {
  const raw = parts.filter(Boolean).join('::').toLowerCase()
  let hash = 0
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0
  return `mail-${Math.abs(hash).toString(36)}`
}

export function parseRfc822(raw: string): { headers: Record<string, string>; text: string } {
  const cleaned = raw.replace(/^\uFEFF/, '').replace(/\u200e|\u200f/g, '')
  const splitAt = cleaned.search(/\r?\n\r?\n/)
  if (splitAt === -1) {
    return { headers: {}, text: stripHtml(cleaned).trim() }
  }
  const headerBlock = cleaned.slice(0, splitAt)
  const rest = cleaned.slice(splitAt).replace(/^\r?\n\r?\n/, '')
  const headers = parseHeaders(headerBlock)
  const ct = header(headers, 'content-type')
  const text = /multipart\/|text\/html/i.test(ct)
    ? extractTextFromMime(cleaned)
    : decodeBody(rest, header(headers, 'content-transfer-encoding'), contentTypeAttr(ct, 'charset'))
  return { headers, text: stripHtml(text).trim() }
}

/** Parse a pasted email, .eml, or Gmail "show original" dump into one or more jobs. */
export function parseJobEmails(raw: string): ParsedMail[] {
  const { headers, text } = parseRfc822(raw)
  const fromRaw = header(headers, 'from') || ''
  const from = parseAddress(fromRaw)
  const reply = parseAddress(header(headers, 'reply-to') || fromRaw)
  const subject = header(headers, 'subject') || firstSubjectFromBody(text)
  const date = header(headers, 'date')
  const body = text || raw.trim()
  const source = detectSource(from.email, subject, body)
  const likelihood = looksLikeJob(subject, body)

  const linkedinJobs = source === 'LinkedIn' ? extractLinkedInJobs(body) : []
  if (linkedinJobs.length > 1) {
    return linkedinJobs.map((job) => ({
      from: from.name || from.email,
      fromEmail: from.email,
      replyTo: reply.email || from.email,
      subject,
      date,
      company: job.company,
      role: job.role,
      location: job.location,
      jobUrl: job.jobUrl,
      recruiter: recruiterFrom(from.name, from.email, body),
      source,
      jobText: `${job.role} at ${job.company} (${job.location})\n${job.jobUrl}\n\n${body}`.trim(),
      isJob: true,
      jobLikelihood: Math.max(likelihood.score, 70),
      reasons: [...likelihood.reasons, 'Split from alert'],
    }))
  }

  const company = firstMatch(body, COMPANY_PATTERNS) || linkedinJobs[0]?.company || companyFromSubject(subject)
  let role = firstMatch(body, ROLE_PATTERNS) || linkedinJobs[0]?.role || roleFromSubject(subject)
  if (!role) {
    const titled = body.match(TITLE_LINE)
    if (titled) role = tidyTitle(titled[0])
  }
  const location = firstMatch(body, LOCATION_PATTERNS) || linkedinJobs[0]?.location || ''
  const jobUrl = linkedinJobs[0]?.jobUrl || extractJobUrl(body)
  const recruiter = recruiterFrom(from.name, from.email, body)
  const isJob = likelihood.score >= 40 || Boolean(role && (company || jobUrl))

  return [
    {
      from: from.name || from.email,
      fromEmail: from.email,
      replyTo: reply.email || from.email,
      subject,
      date,
      company,
      role,
      location,
      jobUrl,
      recruiter,
      source,
      jobText: body.trim(),
      isJob,
      jobLikelihood: isJob ? Math.max(likelihood.score, 45) : likelihood.score,
      reasons: likelihood.reasons,
    },
  ]
}

function firstSubjectFromBody(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim())?.slice(0, 120) || ''
}

function roleFromSubject(subject: string): string {
  const cleaned = tidyTitle(subject.replace(/^(re|fwd|fw)\s*:\s*/i, ''))
  if (/job alert|new jobs|jobs in/i.test(cleaned)) {
    const m = cleaned.match(/(?:for|alert for)\s+(.+)/i)
    return m ? tidyTitle(m[1]) : tidyTitle(cleaned)
  }
  return cleaned.length >= 6 ? cleaned : ''
}

function companyFromSubject(subject: string): string {
  const m = subject.match(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/)
  return m ? tidyTitle(m[1]) : ''
}

function resumeHeadline(resume: string): string {
  const lines = resume
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l && !/^---/.test(l) && !/^(company|role|job_url|location|date_prepared|kit):/i.test(l))
  return (lines[1] || lines[0] || '').replace(/\*/g, '').slice(0, 140)
}

export function firstNameOf(full: string): string {
  const cleaned = full.replace(/^\+/, '').trim()
  if (!cleaned || /^\d/.test(cleaned) || /linkedin|noreply|no-reply|jobalert/i.test(cleaned)) return ''
  return cleaned.split(/\s+/)[0]
}

/** Instant local reply — no model required. AI polish is optional. */
export function buildHeuristicReply(parsed: ParsedMail, resume: string): MailReply {
  const recruiter = firstNameOf(parsed.recruiter)
  const role = parsed.role || 'the role'
  const company = parsed.company || 'your team'
  const headline = resumeHeadline(resume)
  const greeting = recruiter ? `Hi ${recruiter},` : 'Hi,'
  const body = [
    greeting,
    '',
    `Thank you for reaching out about the ${role} role at ${company}. I am interested and attaching my CV.`,
    headline ? `${headline.replace(/\.$/, '')}.` : '',
    'Happy to walk through a recent ship on a 15-minute call this week — what times work for you?',
    '',
    'Best,',
  ]
    .filter((line, i, arr) => line !== '' || (arr[i - 1] !== '' && i !== 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

  const subject = parsed.role
    ? `Re: ${parsed.role}${parsed.company ? ` at ${parsed.company}` : ''}`
    : parsed.subject
      ? parsed.subject.replace(/^(re:\s*)+/i, 'Re: ')
      : 'Re: your role'

  return { subject, body: body.trim() }
}

export function buildMailtoUrl(to: string, reply: MailReply): string {
  const addr = (to || '').trim()
  const q = new URLSearchParams()
  if (reply.subject) q.set('subject', reply.subject)
  if (reply.body) q.set('body', reply.body)
  const query = q.toString().replace(/\+/g, '%20')
  return addr ? `mailto:${addr}?${query}` : `mailto:?${query}`
}

export function parseMailReply(raw: string): MailReply {
  const cleaned = raw.replace(/^```(?:text|markdown|md)?\s*|\s*```$/gi, '').trim()
  const subject = sliceSection(cleaned, 'SUBJECT', ['BODY'])
  const body = sliceSection(cleaned, 'BODY', ['SUBJECT'])
  if (subject || body) return { subject: subject.trim(), body: body.trim() }
  return { subject: '', body: cleaned }
}

function sliceSection(text: string, name: string, until: string[]): string {
  const start = text.search(new RegExp(`^${name}\\s*$`, 'im'))
  if (start === -1) return ''
  const after = text.slice(start).replace(new RegExp(`^${name}\\s*`, 'i'), '')
  const endParts = until.map((u) => {
    const m = after.search(new RegExp(`^${u}\\s*$`, 'im'))
    return m === -1 ? after.length : m
  })
  return after.slice(0, Math.min(...endParts)).trim()
}

export function buildReplyEmailFile(args: {
  company: string
  role: string
  recruiter: string
  replyTo: string
  reply: MailReply
}): string {
  const mailto = buildMailtoUrl(args.replyTo, args.reply)
  return `# Email reply — ${args.company} / ${args.role}

Channel: Email (inbox sourced)
Recruiter: ${args.recruiter || '—'}
Reply-To: ${args.replyTo || '—'}
Link: ${mailto}

## Subject
${args.reply.subject.trim()}

## Body
${args.reply.body.trim()}

## How to send
1. In Resume Studio, open **Mail inbox** and click **Send reply** (SMTP). Confirm the recipient.
2. Or open the mailto link / paste the body into your mail client.
3. Attach \`resume.pdf\` from this kit folder if you send outside the app.
4. Mark the tracker row **applied** after you hit send.
`
}

export function extractReplyFromKitMarkdown(markdown: string): MailReply {
  const subject = sectionAfter(markdown, /^## Subject\s*$/m)
  const body = sectionAfter(markdown, /^## Body\s*$/m)
  if (subject || body) return { subject, body }
  return parseMailReply(markdown)
}

function sectionAfter(markdown: string, heading: RegExp): string {
  const match = markdown.split(heading)[1]
  if (!match) return ''
  return match.split(/^## /m)[0].trim()
}

export function trackerEmailNotes(args: {
  kitSlug: string
  sourceRel?: string
  replyTo?: string
  recruiter?: string
  mailSource?: string
}): string {
  const bits = [
    `kit: apply-kits/${args.kitSlug}/`,
    args.sourceRel ? `resume: ${args.sourceRel}` : '',
    'channel: email',
    args.mailSource ? `mail: ${args.mailSource}` : '',
    args.replyTo ? `reply-to: ${args.replyTo}` : '',
    args.recruiter ? `recruiter: ${args.recruiter}` : '',
  ]
  return bits.filter(Boolean).join('; ')
}

export function replyToFromNotes(notes: string): string {
  const m = notes.match(/reply-to:\s*([^\s;]+)/i)
  return m ? m[1].trim() : ''
}

export function parsedToListing(parsed: ParsedMail, extras?: Partial<MailListing>): MailListing {
  return {
    id: extras?.id || listingId([parsed.company, parsed.role, parsed.jobUrl, parsed.subject, parsed.date]),
    uid: extras?.uid,
    from: parsed.from,
    fromEmail: parsed.fromEmail,
    replyTo: parsed.replyTo,
    subject: parsed.subject,
    date: parsed.date,
    company: parsed.company,
    role: parsed.role,
    location: parsed.location,
    jobUrl: parsed.jobUrl,
    recruiter: parsed.recruiter,
    source: parsed.source,
    description: parsed.jobText,
    jobLikelihood: parsed.jobLikelihood,
    score: extras?.score ?? parsed.jobLikelihood,
    scoreReasons: extras?.scoreReasons ?? parsed.reasons,
    alreadyTracked: extras?.alreadyTracked ?? false,
  }
}

export function listingToParsed(item: MailListing): ParsedMail {
  return {
    from: item.from,
    fromEmail: item.fromEmail,
    replyTo: item.replyTo,
    subject: item.subject,
    date: item.date,
    company: item.company,
    role: item.role,
    location: item.location,
    jobUrl: item.jobUrl,
    recruiter: item.recruiter,
    source: (item.source as MailSource) || 'Other',
    jobText: item.description,
    isJob: item.jobLikelihood >= 40,
    jobLikelihood: item.jobLikelihood,
    reasons: item.scoreReasons,
  }
}
