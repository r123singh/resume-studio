export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function resumeFileName(company: string, role: string): string {
  return `${slugify(company)}--${slugify(role)}.md`
}
