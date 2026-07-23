export function buildTailorSystemPrompt() {
  return `You are an expert resume editor for product managers and AI product leaders.
You tailor resumes for specific job descriptions.

Rules:
- Use ONLY facts from the provided base resume. Never invent employers, dates, degrees, or metrics.
- You MAY rephrase, reorder, emphasize, and drop less relevant bullets.
- Output a COMPLETE markdown resume file.
- Start with YAML frontmatter:
---
company: ...
role: ...
job_url: ...
location: ...
date_prepared: YYYY-MM-DD
---
- Then include: contact header, tailored headline, Summary, Experience (reordered/emphasized for the JD), Skills, Education.
- After the resume body, add:
## Cover letter
A short 1-paragraph cover letter tailored to the role.

## Form snippets
- Why this role: ...
- AI tools / relevant strengths: ...

Return ONLY the markdown file content. No preamble.`
}

export function buildTailorUserPrompt(args: {
  baseResume: string
  company: string
  role: string
  location: string
  jobUrl: string
  jobDescription: string
  today: string
}) {
  return `Company: ${args.company}
Role: ${args.role}
Location: ${args.location || 'n/a'}
Job URL: ${args.jobUrl || 'n/a'}
Date: ${args.today}

JOB DESCRIPTION:
${args.jobDescription}

BASE RESUME (source of truth):
${args.baseResume}`
}

export function buildEditSystemPrompt() {
  return `You are an expert resume editor inside Resume Studio.
The user will ask you to revise the currently open resume markdown.

Rules:
- Preserve factual accuracy from the base resume when available.
- Do not invent employers, dates, or metrics.
- Prefer minimal, high-impact edits.
- When rewriting the file, return STRICT JSON with this shape:
{
  "note": "short summary of what changed",
  "mode": "full",
  "content": "full markdown file content"
}
If only a selection should change, return:
{
  "note": "short summary",
  "mode": "selection",
  "content": "replacement text for the selection only"
}
Return ONLY JSON. No markdown fences.`
}

export function buildEditUserPrompt(args: {
  instruction: string
  openFile: string
  selection?: string
  baseResume?: string
}) {
  return `Instruction:
${args.instruction}

Open resume markdown:
"""
${args.openFile}
"""

${args.selection ? `Selected text to revise:\n"""\n${args.selection}\n"""\n` : ''}
${args.baseResume ? `Base resume facts (optional reference):\n"""\n${args.baseResume}\n"""` : ''}`
}

export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : trimmed
}

export function parseEditResponse(raw: string): {
  note: string
  mode: 'full' | 'selection'
  content: string
} {
  const cleaned = stripCodeFences(raw)
  try {
    const parsed = JSON.parse(cleaned) as {
      note?: string
      mode?: string
      content?: string
    }
    if (parsed.content) {
      return {
        note: parsed.note || 'Updated resume.',
        mode: parsed.mode === 'selection' ? 'selection' : 'full',
        content: parsed.content,
      }
    }
  } catch {
    // fall through — treat as full markdown rewrite
  }
  return {
    note: 'Updated resume.',
    mode: 'full',
    content: cleaned,
  }
}
