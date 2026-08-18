import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

export type SearchHit = {
  path: string
  relativePath: string
  line: number
  preview: string
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  '.git',
  'artifacts',
])

async function walkFiles(root: string, dir: string, out: string[]) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.gitignore') continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue
      await walkFiles(root, full, out)
    } else if (/\.(md|csv|txt)$/i.test(ent.name)) {
      out.push(full)
    }
  }
}

export async function searchWorkspace(
  root: string,
  query: string,
  limit = 40,
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!root || !q || q.length < 2) return []

  const files: string[] = []
  await walkFiles(root, root, files)
  const hits: SearchHit[] = []

  for (const filePath of files) {
    if (hits.length >= limit) break
    let text: string
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= limit) break
      const line = lines[i]
      if (line.toLowerCase().includes(q)) {
        hits.push({
          path: filePath,
          relativePath: path.relative(root, filePath).replace(/\\/g, '/'),
          line: i + 1,
          preview: line.trim().slice(0, 160),
        })
      }
    }
  }
  return hits
}

export function workspaceHasGit(root: string): boolean {
  try {
    return fsSync.existsSync(path.join(root, '.git'))
  } catch {
    return false
  }
}
