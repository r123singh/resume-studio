/**
 * WhatsApp Recruiter Desk — local chat ingest, phone-skim scoring, and wa.me links.
 *
 * Recruiters in India / SEA / MENA send JDs on WhatsApp. This module treats that
 * thread as a first-class apply channel: parse the paste, score a phone-length
 * ping (not a cover letter), and open WhatsApp with the draft ready to send.
 */

export type ChatMessage = {
  time?: string
  sender: string
  text: string
}

export type ParsedChat = {
  recruiterName: string
  phones: string[]
  company: string
  role: string
  location: string
  jobUrl: string
  jobText: string
  messages: ChatMessage[]
}

export type WhatsAppPacket = {
  ping: string
  why: string
  bump: string
}

export type SkimIssue = {
  id: string
  label: string
  severity: 'warn' | 'block'
}

export type PhoneSkim = {
  score: number
  chars: number
  lines: number
  issues: SkimIssue[]
}

const ANDROID_LINE =
  /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)\s+-\s+([^:]+):\s*(.*)$/i
const IOS_LINE =
  /^\[(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)\]\s+([^:]+):\s*(.*)$/i

const SYSTEM_SENDERS = /whatsapp|messages and calls are end-to-end|this chat is with a business/i

const EMAIL_OPENERS =
  /^(dear\b|respected\b|hello sir\b|hello madam\b|to whom it may concern|i am writing to apply|please find (my )?(cv|resume) attached)/i

export const SAMPLE_RECRUITER_THREAD = `[11/09/2026, 4:12:03 pm] +91 98100 11223: Hi, this is Ananya from TalentGrid. We are hiring a Senior Product Manager – AI for Simpplr (Remote / Bangalore).
[11/09/2026, 4:12:18 pm] +91 98100 11223: JD below — pls share your updated CV if interested.

Senior Product Manager, AI Products
Simpplr — Bangalore / Remote
https://simpplr.com/careers/spm-ai

We are looking for a PM to own AI features on our employee intranet. You will ship LLM-assisted search, summarization, and agent workflows for enterprise customers.

Requirements:
- 6+ years product, ideally B2B SaaS
- Shipped at least one LLM or applied-AI feature
- Comfortable with enterprise discovery and rollout
`

const ROLE_PATTERNS = [
  /(?:opening|role|hiring|looking)\s+(?:for|a|an)\s+([^.\n]{6,80})/i,
  /(?:job\s*title|position|designation)\s*[:\-–]\s*([^\n]{4,80})/i,
  /\bwe are hiring\s+(?:a|an)?\s*([^.\n]{6,80})/i,
]

const COMPANY_PATTERNS = [
  /(?:company|org(?:anisation|anization)?|employer)\s*[:\-–]\s*([^\n]{2,60})/i,
  /\b(?:at|for|with)\s+([A-Z][A-Za-z0-9&.\- ]{1,40})\s+(?:is hiring|we are hiring)/,
  /\bfor ([A-Z][A-Za-z0-9&.\- ]{1,40})\s+\(/,
  /\bthis is \w+ from ([A-Z][A-Za-z0-9&.\- ]{1,40})/i,
]

const LOCATION_PATTERNS = [
  /(?:location|based in|office)\s*[:\-–]\s*([^\n]{2,60})/i,
  /\(([^)]*(?:remote|bangalore|bengaluru|hyderabad|mumbai|delhi|pune|gurgaon|noida|chennai)[^)]*)\)/i,
]

/** Keep digits only; add 91 for 10-digit Indian mobiles. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) {
    const rest = digits.slice(1)
    if (/^[6-9]\d{9}$/.test(rest)) return `91${rest}`
  }
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length >= 8 && digits.length <= 15) return digits
  return ''
}

export function extractPhones(text: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /\+91[\s-]?\d[\d\s-]{8,14}\d/g,
    /\b0?[6-9]\d{9}\b/g,
    /wa\.me\/(\+?\d{8,15})/gi,
    /\b\+\d{1,3}[\s-]?\d[\d\s-]{6,14}\d/g,
  ]
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const normalized = normalizePhone(match[1] || match[0])
      if (normalized) found.add(normalized)
    }
  }
  return [...found]
}

function parseThreadLines(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = []
  let current: ChatMessage | null = null
  for (const line of raw.split(/\r?\n/)) {
    const android = line.match(ANDROID_LINE)
    const ios = android ? null : line.match(IOS_LINE)
    const hit = android || ios
    if (hit) {
      if (current) messages.push(current)
      const sender = hit[3].trim()
      if (SYSTEM_SENDERS.test(sender) || SYSTEM_SENDERS.test(hit[4])) {
        current = null
        continue
      }
      current = { time: `${hit[1]} ${hit[2]}`, sender, text: hit[4] }
      continue
    }
    if (current) current.text += (current.text ? '\n' : '') + line
  }
  if (current) messages.push(current)
  return messages
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return tidyTitle(m[1])
  }
  return ''
}

function tidyTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+for\s+[A-Z][A-Za-z0-9&.\- ]{1,40}$/g, '')
    .replace(/\s*[-,|]\s*(?:pls|please|kindly|share|cv|resume).*$/i, '')
    .replace(/[.,;:]+$/, '')
    .trim()
    .slice(0, 80)
}

function recruiterFromMessages(messages: ChatMessage[], phones: string[]): string {
  const senders = messages
    .map((m) => m.sender.trim())
    .filter((s) => s && !SYSTEM_SENDERS.test(s) && !/^you$/i.test(s))
  const named = senders.find((s) => /[A-Za-z]{2,}/.test(s) && !/^\+?\d/.test(s))
  if (named) return named.replace(/^~/, '').trim()
  const intro = messages.map((m) => m.text).join('\n')
  const fromIntro = intro.match(/\bthis is ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+from\b)/)
  if (fromIntro) return fromIntro[1]
  const hiName = intro.match(/\b(?:Hi|Hello),?\s+this is ([A-Z][a-z]+)/)
  if (hiName) return hiName[1]
  if (phones[0]) return `+${phones[0]}`
  return senders[0] || ''
}

function looksLikeJobPost(text: string): boolean {
  const hits = [
    /responsibilit/i,
    /requirement/i,
    /qualifications?/i,
    /job\s*description/i,
    /what you.?ll do/i,
    /about the role/i,
    /\bwe are (?:looking|hiring)\b/i,
  ].filter((re) => re.test(text)).length
  return hits >= 1 || text.length > 280
}

function extractJobUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s)]+/i)
  return m ? m[0].replace(/[.,;]+$/, '') : ''
}

/** Parse a pasted WhatsApp export, forwarded JD, or messy recruiter note. */
export function parseRecruiterChat(raw: string): ParsedChat {
  const text = raw.replace(/\u200e|\u200f/g, '').trim()
  const messages = parseThreadLines(text)
  const corpus = messages.length
    ? messages.map((m) => m.text).join('\n\n')
    : text
  const phones = extractPhones(text)
  const recruiterName = recruiterFromMessages(messages, phones)
  const company = firstMatch(corpus, COMPANY_PATTERNS)
  let role = firstMatch(corpus, ROLE_PATTERNS)
  if (!role) {
    const titled = corpus.match(
      /^(?:senior |staff |principal |group |lead )?(?:product manager|program manager|engineering manager|designer|software engineer)[^\n]{0,40}/im,
    )
    if (titled) role = tidyTitle(titled[0])
  }
  const location = firstMatch(corpus, LOCATION_PATTERNS)
  const jobUrl = extractJobUrl(corpus)
  const jobText = looksLikeJobPost(corpus) ? corpus.trim() : corpus.trim()

  return {
    recruiterName,
    phones,
    company,
    role,
    location,
    jobUrl,
    jobText,
    messages,
  }
}

export function firstNameOf(full: string): string {
  const cleaned = full.replace(/^\+/, '').trim()
  if (!cleaned || /^\d/.test(cleaned)) return ''
  return cleaned.split(/\s+/)[0]
}

function resumeHeadline(resume: string): string {
  const lines = resume
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l && !/^---/.test(l) && !/^(company|role|job_url|location|date_prepared|kit):/i.test(l))
  return (lines[1] || lines[0] || '').replace(/\*/g, '').slice(0, 140)
}

/** Instant local ping — no model required. AI polish is optional. */
export function buildHeuristicPacket(
  parsed: ParsedChat,
  resume: string,
): WhatsAppPacket {
  const recruiter = firstNameOf(parsed.recruiterName)
  const role = parsed.role || 'the role'
  const company = parsed.company || 'your team'
  const headline = resumeHeadline(resume)
  const ping = [
    recruiter ? `Hi ${recruiter} — sharing my CV for the ${role} role at ${company}.` : `Hi — sharing my CV for the ${role} role at ${company}.`,
    headline ? `${headline.replace(/\.$/, '')}.` : '',
    `When is a good time for a 15-min chat?`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const whyLines = [
    headline ? `- ${headline}` : '- Relevant product experience for this JD',
    parsed.role ? `- Targeting ${parsed.role}${parsed.company ? ` at ${parsed.company}` : ''}` : '- Open to a quick screen this week',
    '- Happy to send a tailored PDF or walk through a recent ship',
  ]

  const bump = recruiter
    ? `Hi ${recruiter}, just bumping this in case it got buried — still interested in the ${role} role and can share a tailored CV today.`
    : `Just bumping this in case it got buried — still interested in the ${role} role and can share a tailored CV today.`

  return { ping, why: whyLines.join('\n'), bump }
}

const PING_BUDGET = 700

export function scorePhoneSkim(ping: string, parsed?: ParsedChat): PhoneSkim {
  const text = ping.trim()
  const chars = text.length
  const lines = text ? text.split(/\n/).length : 0
  const issues: SkimIssue[] = []

  if (!text) issues.push({ id: 'empty', label: 'Ping is empty', severity: 'block' })
  if (chars > PING_BUDGET) {
    issues.push({
      id: 'long',
      label: `${chars} characters — WhatsApp previews die after ~${PING_BUDGET}`,
      severity: 'block',
    })
  }
  if (lines > 10) {
    issues.push({ id: 'lines', label: `${lines} lines — keep it to 4–8 on a phone`, severity: 'warn' })
  }
  if (EMAIL_OPENERS.test(text)) {
    issues.push({
      id: 'email',
      label: 'Reads like an email. Drop Dear / I am writing to apply.',
      severity: 'block',
    })
  }
  if (/please find attached|please find my (cv|resume)/i.test(text)) {
    issues.push({
      id: 'attached',
      label: 'Skip “please find attached” — you will attach the PDF in WhatsApp.',
      severity: 'warn',
    })
  }
  if (/[*_#`]{2,}|^>/m.test(text) || /^##\s/m.test(text)) {
    issues.push({ id: 'md', label: 'No markdown — recruiters read this as plain text', severity: 'warn' })
  }
  const emoji = (text.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length
  if (emoji > 2) {
    issues.push({ id: 'emoji', label: 'Too many emoji for a first recruiter ping', severity: 'warn' })
  }
  if (parsed?.role && !text.toLowerCase().includes(parsed.role.slice(0, 18).toLowerCase())) {
    issues.push({ id: 'role', label: 'First ping should name the role', severity: 'warn' })
  }
  if (parsed?.company && !text.toLowerCase().includes(parsed.company.slice(0, 16).toLowerCase())) {
    issues.push({ id: 'company', label: 'Name the company so this does not look like a blast', severity: 'warn' })
  }
  if (!/[?？]/.test(text)) {
    issues.push({ id: 'ask', label: 'End with one easy question (time for a chat)', severity: 'warn' })
  }

  let score = 100
  for (const issue of issues) score -= issue.severity === 'block' ? 25 : 12
  if (chars > 0 && chars <= 420 && lines >= 3 && lines <= 8) score += 4
  score = Math.max(0, Math.min(100, score))
  return { score, chars, lines, issues }
}

export function buildWaMeUrl(phone: string, text: string): string {
  const digits = normalizePhone(phone)
  const encoded = encodeURIComponent(text)
  if (digits) return `https://wa.me/${digits}?text=${encoded}`
  return `https://wa.me/?text=${encoded}`
}

export function parseWhatsAppPacket(raw: string): WhatsAppPacket {
  const cleaned = raw.replace(/^```(?:text|markdown|md)?\s*|\s*```$/gi, '').trim()
  const ping = sliceSection(cleaned, 'PING', ['WHY', 'BUMP'])
  const why = sliceSection(cleaned, 'WHY', ['BUMP', 'PING'])
  const bump = sliceSection(cleaned, 'BUMP', ['PING', 'WHY'])
  if (ping) return { ping: ping.trim(), why: why.trim(), bump: bump.trim() }
  return { ping: cleaned, why: '', bump: '' }
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

export function buildWhatsAppPingFile(args: {
  company: string
  role: string
  recruiter: string
  phone: string
  packet: WhatsAppPacket
}): string {
  const wa = buildWaMeUrl(args.phone, args.packet.ping)
  return `# WhatsApp ping — ${args.company} / ${args.role}

Channel: WhatsApp (not ATS)
Recruiter: ${args.recruiter || '—'}
Phone: ${args.phone ? `+${normalizePhone(args.phone)}` : '—'}
Link: ${wa}

## Ping
${args.packet.ping.trim()}

## Why-fit (send only if they ask)
${args.packet.why.trim() || '_none_'}

## 48h bump
${args.packet.bump.trim() || '_none_'}

## How to send
1. Open the wa.me link (or paste the ping into WhatsApp).
2. Attach \`resume.pdf\` from this kit folder. Desktop WhatsApp cannot attach via the link — drop the PDF in the chat.
3. Mark the tracker row **applied** after they confirm receipt.
`
}

export function phoneFromNotes(notes: string): string {
  const m = notes.match(/phone:\s*\+?(\d{8,15})/i)
  return m ? normalizePhone(m[1]) : ''
}

export function extractPingFromKitMarkdown(markdown: string): string {
  return extractPacketFromKitMarkdown(markdown).ping
}

export function extractPacketFromKitMarkdown(markdown: string): WhatsAppPacket {
  const ping = sectionAfter(markdown, /^## Ping\s*$/m)
  const why = sectionAfter(markdown, /^## Why-fit.*$/m)
  const bump = sectionAfter(markdown, /^## 48h bump\s*$/m)
  if (ping || why || bump) return { ping, why, bump }
  return parseWhatsAppPacket(markdown)
}

function sectionAfter(markdown: string, heading: RegExp): string {
  const match = markdown.split(heading)[1]
  if (!match) return ''
  return match.split(/^## /m)[0].trim()
}

export function trackerWhatsAppNotes(args: {
  kitSlug: string
  sourceRel?: string
  phone?: string
  recruiter?: string
}): string {
  const bits = [
    `kit: apply-kits/${args.kitSlug}/`,
    args.sourceRel ? `resume: ${args.sourceRel}` : '',
    'channel: whatsapp',
    args.phone ? `phone: ${normalizePhone(args.phone)}` : '',
    args.recruiter ? `recruiter: ${args.recruiter}` : '',
  ]
  return bits.filter(Boolean).join('; ')
}
