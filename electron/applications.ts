import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

export type ApplicationStatus = 'ready-to-apply' | 'applied' | 'skipped' | 'closed'

export type ApplicationRow = {
  id: number
  date: string
  company: string
  role: string
  location: string
  source: string
  jobUrl: string
  status: ApplicationStatus
  notes: string
}

const HEADER = 'date,company,role,location,source,job_url,status,notes'

function csvPath(workspace: string) {
  return path.join(workspace, 'applications.csv')
}

async function ensureCsv(workspace: string) {
  const p = csvPath(workspace)
  if (!fsSync.existsSync(p)) {
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(p, `${HEADER}\n`, 'utf8')
  }
  return p
}

/** Minimal CSV parse supporting quoted fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      row.push(field)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      field = ''
      continue
    }
    if (ch === '\r') continue
    field += ch
  }
  if (field.length || row.length) {
    row.push(field)
    if (row.some((c) => c.trim())) rows.push(row)
  }
  return rows
}

function escapeCsv(v: string) {
  const s = v.replace(/"/g, '""')
  return /[",\n\r]/.test(s) ? `"${s}"` : s
}

function normalizeStatus(raw: string): ApplicationStatus {
  const s = raw.trim().toLowerCase()
  if (s === 'applied') return 'applied'
  if (s === 'skipped') return 'skipped'
  if (s === 'closed') return 'closed'
  return 'ready-to-apply'
}

export async function listApplications(workspace: string): Promise<ApplicationRow[]> {
  const p = await ensureCsv(workspace)
  const text = await fs.readFile(p, 'utf8')
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const start = rows[0][0]?.toLowerCase() === 'date' ? 1 : 0
  const out: ApplicationRow[] = []
  for (let i = start; i < rows.length; i++) {
    const cols = rows[i]
    while (cols.length < 8) cols.push('')
    out.push({
      id: i - start,
      date: (cols[0] || '').trim(),
      company: (cols[1] || '').trim(),
      role: (cols[2] || '').trim(),
      location: (cols[3] || '').trim(),
      source: (cols[4] || '').trim(),
      jobUrl: (cols[5] || '').trim(),
      status: normalizeStatus(cols[6] || ''),
      notes: (cols[7] || '').trim(),
    })
  }
  // Newest first; remap ids to newest-first index
  return out.reverse().map((row, idx) => ({ ...row, id: idx }))
}

export async function setApplicationStatus(
  workspace: string,
  idNewestFirst: number,
  status: ApplicationStatus,
  extraNote?: string,
): Promise<ApplicationRow[]> {
  const p = await ensureCsv(workspace)
  const text = await fs.readFile(p, 'utf8')
  const rows = parseCsv(text)
  const start = rows.length && rows[0][0]?.toLowerCase() === 'date' ? 1 : 0
  const data = rows.slice(start)
  const fileIndex = data.length - 1 - idNewestFirst
  if (fileIndex < 0 || fileIndex >= data.length) {
    throw new Error('Application row not found')
  }
  const cols = [...data[fileIndex]]
  while (cols.length < 8) cols.push('')
  cols[6] = status
  if (extraNote?.trim()) {
    const stamp = new Date().toISOString().slice(0, 10)
    const prev = (cols[7] || '').trim()
    cols[7] = prev ? `${prev}; ${stamp}: ${extraNote.trim()}` : `${stamp}: ${extraNote.trim()}`
  }
  data[fileIndex] = cols

  const lines = [HEADER]
  for (const c of data) {
    const padded = [...c]
    while (padded.length < 8) padded.push('')
    lines.push(padded.slice(0, 8).map(escapeCsv).join(','))
  }
  await fs.writeFile(p, `${lines.join('\n')}\n`, 'utf8')
  return listApplications(workspace)
}

export function kitDirFromNotes(workspace: string, notes: string): string | null {
  const match = notes.match(/kit:\s*(apply-kits\/[^;\s]+)/i)
  if (!match) return null
  const rel = match[1].replace(/\/$/, '')
  return path.join(workspace, ...rel.split(/[/\\]/))
}
