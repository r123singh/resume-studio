export type DiffLine = {
  type: 'same' | 'add' | 'remove'
  text: string
}

/** Simple LCS-based line diff for preview UI. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) {
    out.push({ type: 'remove', text: a[i++] })
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j++] })
  }
  return out
}

export function changedLineCount(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const d of diff) {
    if (d.type === 'add') added++
    if (d.type === 'remove') removed++
  }
  return { added, removed }
}

export function isLargeEdit(before: string, after: string): boolean {
  if (before === after) return false
  const { added, removed } = changedLineCount(lineDiff(before, after))
  const changed = added + removed
  if (changed >= 8) return true
  if (Math.abs(after.length - before.length) >= 400) return true
  // Full-file rewrite
  if (before.length > 200 && after.length > 200) {
    const overlap = Math.min(before.length, after.length)
    // crude: if less than 40% shared prefix of shorter, treat as large
    let shared = 0
    const lim = Math.min(overlap, 2000)
    while (shared < lim && before[shared] === after[shared]) shared++
    if (shared / Math.min(before.length, after.length) < 0.35) return true
  }
  return false
}
