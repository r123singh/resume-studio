const WINDOW_MS = 60_000
const MAX_REQUESTS = 12

let timestamps: number[] = []

export function assertRateLimit(): void {
  const now = Date.now()
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS)
  if (timestamps.length >= MAX_REQUESTS) {
    throw new Error(
      `Rate limit: too many AI requests in the last minute (max ${MAX_REQUESTS}). Wait a moment and try again.`,
    )
  }
  timestamps.push(now)
}

export function redactPii(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, '[phone redacted]')
    .replace(/linkedin\.com\/in\/[^\s)]+/gi, 'linkedin.com/in/[redacted]')
}

export type PendingEdit = {
  id: string
  title: string
  before: string
  after: string
  mode: 'selection' | 'file' | 'create-file'
  note: string
  selectionRange?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  createPath?: string
  createRel?: string
  meta?: Record<string, string>
}
