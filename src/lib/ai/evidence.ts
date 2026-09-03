import type { EvidenceSnippet } from '../../../electron/preload'

export type EvidenceSuggestion = {
  id: string
  section: string
  target: string
  text: string
  evidence: string[]
  rationale: string
  accepted: boolean
}

export type EvidenceResult = {
  note: string
  atsFit: number
  suggestions: EvidenceSuggestion[]
}

export function buildEvidenceSystemPrompt() {
  return `You are a resume tailoring assistant that must cite evidence.

You receive: a job posting, numbered evidence snippets (S1, S2, …) scraped from the posting and company pages, and the candidate's resume markdown.

Hard rules:
- NEVER invent employers, dates, degrees, metrics, or achievements. Only use facts already present in the candidate's resume.
- Evidence snippets describe what the EMPLOYER wants. Use them to decide emphasis and wording, not to add new candidate facts.
- Every suggestion must cite at least one snippet id that justifies the change.
- If nothing justifies a change, return fewer suggestions. Quality over quantity.
- Keep bullets under 200 characters, lead with an action verb, keep any existing metric.

Return ONLY valid JSON, no prose and no code fences:
{
  "note": "one sentence summary of the tailoring strategy",
  "atsFit": 0-100,
  "suggestions": [
    {
      "id": "b1",
      "section": "Experience",
      "target": "exact existing line from the resume to replace, or empty string to add a new line",
      "text": "the rewritten or new markdown line",
      "evidence": ["S1", "S4"],
      "rationale": "why this matches the job, referencing the snippets"
    }
  ]
}

"target" MUST be copied character-for-character from the resume when replacing, otherwise use "".`
}

export function buildEvidenceUserPrompt(args: {
  company: string
  jobTitle: string
  jobUrl: string
  jobText: string
  snippets: EvidenceSnippet[]
  resume: string
  instruction?: string
}) {
  const evidenceBlock = args.snippets
    .map((s) => `${s.id} [${s.kind}] (${s.sourceUrl})\n${s.text}`)
    .join('\n\n')

  return `Company: ${args.company}
Role: ${args.jobTitle}
Job URL: ${args.jobUrl || 'n/a'}
${args.instruction ? `Extra instruction: ${args.instruction}\n` : ''}
JOB POSTING (top lines):
"""
${args.jobText.slice(0, 6000)}
"""

EVIDENCE SNIPPETS:
"""
${evidenceBlock}
"""

CANDIDATE RESUME (source of truth for facts):
"""
${args.resume}
"""

Rewrite the most relevant bullets so they match the job's requirements, and for each suggestion list which snippet ids justify it.`
}

function stripFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

export function parseEvidenceResponse(raw: string): EvidenceResult {
  const cleaned = stripFences(raw)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned

  try {
    const parsed = JSON.parse(candidate) as {
      note?: string
      atsFit?: number
      suggestions?: Array<{
        id?: string
        section?: string
        target?: string
        text?: string
        evidence?: string[]
        rationale?: string
      }>
    }
    const suggestions = (parsed.suggestions || [])
      .filter((s) => (s.text || '').trim())
      .map((s, i) => ({
        id: s.id || `b${i + 1}`,
        section: s.section || 'Experience',
        target: (s.target || '').trim(),
        text: (s.text || '').trim(),
        evidence: Array.isArray(s.evidence) ? s.evidence.filter(Boolean) : [],
        rationale: s.rationale || '',
        accepted: Array.isArray(s.evidence) && s.evidence.length > 0,
      }))
    return {
      note: parsed.note || 'Evidence-backed suggestions ready.',
      atsFit: Math.max(0, Math.min(100, Math.round(Number(parsed.atsFit) || 0))),
      suggestions,
    }
  } catch {
    return {
      note: 'Model did not return structured suggestions. Showing raw output in chat.',
      atsFit: 0,
      suggestions: [],
    }
  }
}

/** Deterministically apply accepted suggestions to the markdown. */
export function applyEvidenceSuggestions(
  markdown: string,
  suggestions: EvidenceSuggestion[],
): { content: string; applied: number; skipped: EvidenceSuggestion[] } {
  let content = markdown
  let applied = 0
  const skipped: EvidenceSuggestion[] = []

  for (const s of suggestions) {
    if (!s.accepted) continue

    if (s.target && content.includes(s.target)) {
      // Use a function replacer so `$$`, `$&`, `` $` ``, `$'` in the model's
      // bullet (e.g. a literal "$$500K") are inserted verbatim rather than
      // interpreted as replacement patterns, which would silently corrupt text.
      content = content.replace(s.target, () => s.text)
      applied++
      continue
    }

    if (!s.target) {
      const inserted = insertUnderSection(content, s.section, s.text)
      if (inserted) {
        content = inserted
        applied++
        continue
      }
    }

    skipped.push(s)
  }

  return { content, applied, skipped }
}

function insertUnderSection(markdown: string, section: string, line: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const headingIdx = lines.findIndex(
    (l) => /^#{2,4}\s+/.test(l) && l.toLowerCase().includes(section.toLowerCase()),
  )
  if (headingIdx === -1) return null

  let insertAt = headingIdx + 1
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,4}\s+/.test(lines[i])) break
    if (lines[i].trim()) insertAt = i + 1
  }
  lines.splice(insertAt, 0, line)
  return lines.join('\n')
}

/**
 * Pull bullet text out of a partially streamed JSON response so the editor can
 * show real sentences as ghost text instead of raw JSON.
 */
export function extractPartialBullets(raw: string): string[] {
  const out: string[] = []
  const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"?/g
  let match = re.exec(raw)
  while (match) {
    const value = match[1]
      .replace(/\\n/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim()
    if (value) out.push(value)
    match = re.exec(raw)
  }
  return out
}

/** Build the ghost-text preview shown inline while streaming. */
export function suggestionsToGhostText(suggestions: EvidenceSuggestion[]): string {
  return suggestions
    .filter((s) => s.accepted)
    .map((s) => s.text)
    .join('\n')
}

export function evidenceCitationsFor(
  suggestion: EvidenceSuggestion,
  snippets: EvidenceSnippet[],
): EvidenceSnippet[] {
  return suggestion.evidence
    .map((id) => snippets.find((s) => s.id === id))
    .filter((s): s is EvidenceSnippet => Boolean(s))
}
