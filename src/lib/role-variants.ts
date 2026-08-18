import { analyzeRecruiterLens } from './recruiter-lens'

export const DEFAULT_ROLE_VARIANTS = [
  { id: 'frontend', label: 'Frontend', relativePath: 'variants/frontend.md' },
  { id: 'backend', label: 'Backend', relativePath: 'variants/backend.md' },
  { id: 'product', label: 'Product', relativePath: 'variants/product.md' },
] as const

export type RoleVariantId = (typeof DEFAULT_ROLE_VARIANTS)[number]['id']

export type VariantDiff = {
  sharedLines: number
  variantOnly: string[]
  baseOnly: string[]
  keywordScore: number
  matched: string[]
  missing: string[]
}

function significantLines(md: string): string[] {
  return md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && !l.startsWith('---') && !/^company:|^role:|^date:/.test(l))
}

export function compareVariantContent(
  baseMd: string,
  variantMd: string,
  jobDescription = '',
): VariantDiff {
  const baseSet = new Set(significantLines(baseMd))
  const varLines = significantLines(variantMd)
  const varSet = new Set(varLines)

  const sharedLines = [...varSet].filter((l) => baseSet.has(l)).length
  const variantOnly = [...varSet].filter((l) => !baseSet.has(l)).slice(0, 12)
  const baseOnly = [...baseSet].filter((l) => !varSet.has(l)).slice(0, 12)

  const report = analyzeRecruiterLens(variantMd, jobDescription)
  return {
    sharedLines,
    variantOnly,
    baseOnly,
    keywordScore: report.keywords.score,
    matched: report.keywords.matched,
    missing: report.keywords.missing,
  }
}

export function seedVariantFromBase(baseMd: string, label: string): string {
  const header = `---
variant: ${label.toLowerCase()}
role: ${label}
date: ${new Date().toISOString().slice(0, 10)}
---

`
  // Soft emphasis note at top; keep body shared until user customizes
  const note = `> Role variant: **${label}**. Emphasize ${label.toLowerCase()}-relevant bullets and skills. Shared content starts from base.\n\n`
  const body = baseMd.replace(/^---[\s\S]*?---\s*/, '')
  return header + note + body.trimStart()
}
