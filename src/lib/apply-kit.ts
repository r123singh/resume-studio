import { resumeFileName, slugify } from './slug'

export type ApplyKitParts = {
  company: string
  role: string
  jobUrl: string
  location: string
  datePrepared: string
  resumeBody: string
  coverLetter: string
  formSnippets: string
  kitSlug: string
}

export function parseFrontmatter(markdown: string): {
  meta: Record<string, string>
  body: string
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: markdown }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) meta[key] = value
  }
  return { meta, body: match[2] }
}

function extractSection(body: string, headingPattern: RegExp): { section: string; rest: string } {
  const match = body.match(headingPattern)
  if (!match || match.index === undefined) {
    return { section: '', rest: body }
  }
  const start = match.index
  const afterHeading = start + match[0].length
  const nextHeading = body.slice(afterHeading).search(/\n##\s+/)
  const end = nextHeading === -1 ? body.length : afterHeading + nextHeading
  const section = body.slice(afterHeading, end).trim()
  const rest = `${body.slice(0, start).trimEnd()}\n${body.slice(end).trimStart()}`.trim()
  return { section, rest }
}

/** Split a tailored resume markdown into Apply Kit parts. */
export function buildApplyKitParts(markdown: string, fallbacks?: {
  company?: string
  role?: string
}): ApplyKitParts {
  const { meta, body } = parseFrontmatter(markdown)

  let working = body
  const cover = extractSection(
    working,
    /\n##\s+Cover letter(?:\s*\([^)]*\))?\s*\n/i,
  )
  working = cover.rest || working
  // Also try without leading newline (section at start — unlikely)
  if (!cover.section) {
    const alt = extractSection(working, /^##\s+Cover letter(?:\s*\([^)]*\))?\s*\n/im)
    if (alt.section) {
      working = alt.rest
      cover.section = alt.section
    }
  }

  const snippets = extractSection(
    working,
    /\n##\s+Form snippets(?:\s*\([^)]*\))?\s*\n/i,
  )
  working = snippets.rest || working
  if (!snippets.section) {
    const alt = extractSection(working, /^##\s+Form snippets(?:\s*\([^)]*\))?\s*\n/im)
    if (alt.section) {
      working = alt.rest
      snippets.section = alt.section
    }
  }

  // Drop trailing horizontal rules from resume body
  const resumeBody = working.replace(/\n---\s*$/g, '').trim()

  const company = meta.company || fallbacks?.company || 'Company'
  const role = meta.role || fallbacks?.role || 'Role'
  const kitSlug = resumeFileName(company, role).replace(/\.md$/i, '')

  return {
    company,
    role,
    jobUrl: meta.job_url || meta.jobUrl || '',
    location: meta.location || '',
    datePrepared: meta.date_prepared || meta.datePrepared || new Date().toISOString().slice(0, 10),
    resumeBody,
    coverLetter: cover.section || '(No cover letter section found in this file.)',
    formSnippets: snippets.section || '(No form snippets section found in this file.)',
    kitSlug,
  }
}

export function buildChecklistMarkdown(parts: ApplyKitParts): string {
  return `# Apply checklist — ${parts.company} / ${parts.role}

Status: **ready-to-apply** (manual ATS submit)

## Links
- Job URL: ${parts.jobUrl || '_add job_url to resume frontmatter_'}
- Prepared: ${parts.datePrepared}
- Location: ${parts.location || 'n/a'}

## Steps
1. Open the job URL in your browser.
2. Attach \`resume.pdf\` (or paste from \`resume.md\`).
3. Paste cover letter from \`cover-letter.md\` if the ATS has a field.
4. Use \`form-snippets.md\` for "Why this role", AI tools, work auth, etc.
5. Fill salary / work authorization yourself — do not invent answers.
6. Submit, then mark this application as **applied** in \`applications.csv\`.

## Kit files
- \`resume.md\` — clean resume (no cover letter / snippets)
- \`resume.pdf\` — PDF for upload
- \`cover-letter.md\`
- \`form-snippets.md\`
- \`CHECKLIST.md\` — this file
`
}

export function buildCoverLetterFile(parts: ApplyKitParts): string {
  return `# Cover letter — ${parts.company} / ${parts.role}

${parts.coverLetter.trim()}
`
}

export function buildFormSnippetsFile(parts: ApplyKitParts): string {
  return `# Form snippets — ${parts.company} / ${parts.role}

${parts.formSnippets.trim()}
`
}

export function buildResumeMarkdownFile(parts: ApplyKitParts): string {
  return `---
company: ${parts.company}
role: ${parts.role}
job_url: ${parts.jobUrl}
location: ${parts.location}
date_prepared: ${parts.datePrepared}
kit: true
---

${parts.resumeBody.trim()}
`
}

export function kitFolderName(parts: ApplyKitParts): string {
  return parts.kitSlug || `${slugify(parts.company)}--${slugify(parts.role)}`
}
