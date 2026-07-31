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

export function buildInterviewPrepSystemPrompt() {
  return `You are an expert interview coach for product managers and AI product leaders.
Create a practical, rehearse-ready interview prep document for a specific role.

Rules:
- Use ONLY facts from the provided resume(s). Never invent employers, dates, metrics, or degrees.
- Be specific to the company and JD — not generic PM advice.
- Prefer short, spoken-ready answers over essays.
- Output COMPLETE markdown only (no preamble).

Required structure:

---
company: ...
role: ...
job_url: ...
location: ...
date_prepared: YYYY-MM-DD
---

# Interview prep — {Company} / {Role}

## Company angle
3–6 bullets on what likely matters for this interview (product, AI, enterprise, users, metrics).

## Fit signals
Bullet list mapping candidate strengths → this JD.

## 60-second intro
One paragraph the candidate can speak aloud.

## Why this company / role
A crisp 4–6 sentence answer.

## Core STAR stories (prepare 4)
For each story include:
### Story title
- Situation
- Task
- Action
- Result (with metrics if available)
- How to angle it for this JD

## Likely questions
### Product / strategy
5 questions
### AI / technical product (if relevant)
5 questions
### Execution / leadership
5 questions

## Strong answer points
5 reusable points to weave into answers.

## Product sense prompt
If they ask how to improve the product with AI/features, give a short structure + one sample wedge idea for this company.

## Questions to ask them
6 thoughtful questions.

## Watch-outs
3–5 traps (overclaiming, domain gaps, jargon, etc.) and how to handle them.

## Bridge statement
One short paragraph connecting the candidate's background to this role if domains differ.

## Night-before checklist
5–7 bullets.`
}

export function buildInterviewPrepUserPrompt(args: {
  company: string
  role: string
  location: string
  jobUrl: string
  jobDescription: string
  tailoredResume: string
  baseResume: string
  today: string
}) {
  return `Company: ${args.company}
Role: ${args.role}
Location: ${args.location || 'n/a'}
Job URL: ${args.jobUrl || 'n/a'}
Date: ${args.today}

JOB DESCRIPTION:
${args.jobDescription || '(not provided — infer carefully from role title and resume emphasis)'}

TAILORED / OPEN RESUME:
${args.tailoredResume}

BASE RESUME (facts source of truth):
${args.baseResume || '(same as tailored)'}

Write the interview prep markdown now.`
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
