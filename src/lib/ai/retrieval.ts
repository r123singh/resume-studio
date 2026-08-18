/** Lightweight context budget + section retrieval (no embedding infra). */

const SECTION_RE = /^##\s+(.+)$/gm

export function estimateTokens(text: string): number {
  // Rough heuristic: ~4 chars per token for English/markdown
  return Math.max(1, Math.ceil(text.length / 4))
}

export function estimateMessagesTokens(
  messages: Array<{ content: string }>,
): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content), 0)
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n…[truncated ${text.length - maxChars} chars to fit context budget]`
}

export function extractSections(markdown: string): Array<{ name: string; body: string }> {
  const matches = [...markdown.matchAll(new RegExp(SECTION_RE))]
  if (!matches.length) return [{ name: 'document', body: markdown }]
  const out: Array<{ name: string; body: string }> = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length
    out.push({
      name: matches[i][1].trim().toLowerCase(),
      body: markdown.slice(start, end).trim(),
    })
  }
  return out
}

/** Score sections by keyword overlap with instruction / JD. */
export function retrieveRelevantSections(
  markdown: string,
  query: string,
  maxChars = 12_000,
): string {
  const q = query.toLowerCase()
  const terms = q
    .replace(/[^a-z0-9+#.\s/-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  const sections = extractSections(markdown)
  if (!terms.length || sections.length <= 1) {
    return truncateText(markdown, maxChars)
  }

  const scored = sections
    .map((s) => {
      const hay = `${s.name}\n${s.body}`.toLowerCase()
      let score = 0
      for (const t of terms) {
        if (hay.includes(t)) score += 1
        if (s.name.includes(t)) score += 2
      }
      // Always keep summary / experience / skills a bit
      if (/summary|experience|skill|profile/.test(s.name)) score += 1
      return { ...s, score }
    })
    .sort((a, b) => b.score - a.score)

  let out = ''
  for (const s of scored) {
    if (out.length + s.body.length + 2 > maxChars) {
      const room = maxChars - out.length - 20
      if (room > 200) out += `\n\n${s.body.slice(0, room)}…`
      break
    }
    out += (out ? '\n\n' : '') + s.body
  }
  return out || truncateText(markdown, maxChars)
}

export const MAX_PROMPT_CHARS = 48_000
export const MAX_JD_CHARS = 10_000
export const MAX_RESUME_CHARS = 16_000
