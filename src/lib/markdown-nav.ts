import type { TreeNode } from '../../electron/preload'

export type MdSection = {
  title: string
  line: number
  level: number
}

export function listMarkdownSections(markdown: string): MdSection[] {
  const lines = markdown.split(/\r?\n/)
  const out: MdSection[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,4})\s+(.+)$/.exec(lines[i])
    if (m) {
      out.push({ title: m[2].trim(), line: i + 1, level: m[1].length })
    }
  }
  return out
}

export function flattenTreeFiles(nodes: TreeNode[]): TreeNode[] {
  const files: TreeNode[] = []
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.type === 'file') files.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return files
}

export function findTreeFile(
  nodes: TreeNode[],
  predicate: (n: TreeNode) => boolean,
): TreeNode | null {
  for (const n of nodes) {
    if (n.type === 'file' && predicate(n)) return n
    if (n.children?.length) {
      const hit = findTreeFile(n.children, predicate)
      if (hit) return hit
    }
  }
  return null
}
