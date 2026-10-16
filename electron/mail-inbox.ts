/**
 * IMAP fetch + .eml import for the Mail Inbox desk.
 *
 * Credentials stay in the main process (safeStorage). PEEK is used so fetching
 * does not mark messages read. The renderer only receives parsed job listings.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import tls from 'node:tls'
import { listApplications } from './applications'
import { readJobPreferences, scoreListing } from './job-hunt'
import {
  parseJobEmails,
  parsedToListing,
  type MailListing,
} from '../src/lib/mail'

export type ImapSettings = {
  host: string
  port: number
  user: string
  password: string
  mailbox: string
  lookbackDays: number
  maxMessages: number
}

const MAX_MESSAGE_BYTES = 400_000
const CONNECT_TIMEOUT_MS = 20_000

function quoteImap(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function imapSinceDate(days: number): string {
  const d = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

class ImapClient {
  private socket: tls.TLSSocket | null = null
  private buf = Buffer.alloc(0)
  private waiters: Array<() => void> = []
  private tagN = 0

  async connect(host: string, port: number) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket?.destroy()
        reject(new Error(`IMAP connect timed out (${host}:${port})`))
      }, CONNECT_TIMEOUT_MS)
      const socket = tls.connect({ host, port, servername: host }, () => {
        clearTimeout(timer)
        resolve()
      })
      socket.on('data', (chunk: Buffer) => {
        this.buf = Buffer.concat([this.buf, chunk])
        const waiters = this.waiters.splice(0)
        for (const w of waiters) w()
      })
      socket.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      socket.on('close', () => {
        const waiters = this.waiters.splice(0)
        for (const w of waiters) w()
      })
      this.socket = socket
    })
    await this.readGreeting()
  }

  private nextTag() {
    this.tagN += 1
    return `A${this.tagN}`
  }

  private async readBytes(n: number): Promise<Buffer> {
    while (this.buf.length < n) {
      if (!this.socket || this.socket.destroyed) throw new Error('IMAP connection closed')
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    const out = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(n)
    return Buffer.from(out)
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buf.indexOf('\n')
      if (idx !== -1) {
        const line = this.buf.subarray(0, idx).toString('utf8').replace(/\r$/, '')
        this.buf = this.buf.subarray(idx + 1)
        return line
      }
      if (!this.socket || this.socket.destroyed) throw new Error('IMAP connection closed')
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  private async readGreeting() {
    const line = await this.readLine()
    if (!/^\*\s+(OK|PREAUTH)/i.test(line)) {
      throw new Error(`IMAP greeting failed: ${line}`)
    }
  }

  async command(text: string): Promise<string[]> {
    const socket = this.socket
    if (!socket) throw new Error('IMAP not connected')
    const tag = this.nextTag()
    socket.write(`${tag} ${text}\r\n`)
    const lines: string[] = []
    while (true) {
      const line = await this.readLine()
      const lit = line.match(/\{(\d+)\}\s*$/)
      if (lit) {
        const size = Number(lit[1])
        if (size > MAX_MESSAGE_BYTES) {
          await this.readBytes(size)
          lines.push(`${line.slice(0, lit.index)}\n`)
          continue
        }
        const data = await this.readBytes(size)
        lines.push(`${line.slice(0, lit.index)}\n${data.toString('utf8')}`)
        continue
      }
      lines.push(line)
      if (line.startsWith(`${tag} `)) {
        if (!new RegExp(`^${tag}\\s+OK`, 'i').test(line)) {
          throw new Error(line.replace(new RegExp(`^${tag}\\s+`), ''))
        }
        break
      }
    }
    return lines
  }

  async login(user: string, password: string) {
    try {
      await this.command(`LOGIN ${quoteImap(user)} ${quoteImap(password)}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `IMAP login failed. Use an app password (Gmail: Google Account → Security → App passwords). ${msg}`,
      )
    }
  }

  async select(mailbox: string) {
    const lines = await this.command(`SELECT ${quoteImap(mailbox)}`)
    const exists = lines.join('\n').match(/\*\s+(\d+)\s+EXISTS/i)
    return exists ? Number(exists[1]) : 0
  }

  async searchSince(days: number): Promise<number[]> {
    const since = imapSinceDate(days)
    const lines = await this.command(`UID SEARCH SINCE ${since}`)
    const hit = lines.find((l) => /^\*\s+SEARCH\b/i.test(l))
    if (!hit) return []
    return hit
      .replace(/^\*\s+SEARCH\s*/i, '')
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
  }

  async fetchRaw(uids: number[]): Promise<Array<{ uid: number; raw: string }>> {
    if (!uids.length) return []
    const set = uids.join(',')
    const lines = await this.command(`UID FETCH ${set} (UID BODY.PEEK[])`)
    const blob = lines.join('\n')
    return parseFetchBodies(blob)
  }

  async logout() {
    try {
      await this.command('LOGOUT')
    } catch {
      // ignore
    }
    this.socket?.end()
    this.socket = null
  }
}

export function parseFetchBodies(blob: string): Array<{ uid: number; raw: string }> {
  const out: Array<{ uid: number; raw: string }> = []
  const re = /\* \d+ FETCH \([\s\S]*?\bUID\s+(\d+)[\s\S]*?BODY(?:\.PEEK)?\[\][^\n]*\n([\s\S]*?)(?=\n\)|\n\* \d+ FETCH |\nA\d+\s+(?:OK|NO|BAD))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(blob))) {
    out.push({ uid: Number(m[1]), raw: m[2].replace(/\n\)\s*$/, '').trim() })
  }
  if (out.length) return out

  // Fallback: split on FETCH lines and take the following RFC822-ish body.
  const chunks = blob.split(/\n\* \d+ FETCH /i).slice(1)
  for (const chunk of chunks) {
    const uid = Number(chunk.match(/\bUID\s+(\d+)/i)?.[1] || 0)
    const idx = chunk.search(/\n/)
    const raw = idx === -1 ? chunk : chunk.slice(idx + 1).replace(/\n\)\s*$/, '').trim()
    if (uid && raw.includes(':')) out.push({ uid, raw })
  }
  return out
}

export async function fetchImapInbox(settings: ImapSettings): Promise<Array<{ uid: number; raw: string }>> {
  const host = settings.host.trim()
  const user = settings.user.trim()
  if (!host || !user || !settings.password) {
    throw new Error('IMAP host, email, and app password are required. Save them in Settings.')
  }
  const client = new ImapClient()
  await client.connect(host, settings.port || 993)
  try {
    await client.login(user, settings.password)
    const exists = await client.select(settings.mailbox.trim() || 'INBOX')
    let uids = await client.searchSince(settings.lookbackDays || 14)
    const max = Math.min(40, Math.max(5, settings.maxMessages || 25))
    if (!uids.length && exists > 0) {
      const from = Math.max(1, exists - max + 1)
      const lines = await client.command(`FETCH ${from}:${exists} (UID BODY.PEEK[])`)
      return parseFetchBodies(lines.join('\n')).slice(-max)
    }
    uids = uids.slice(-max)
    return client.fetchRaw(uids)
  } finally {
    await client.logout()
  }
}

export async function readEmlFiles(filePaths: string[]): Promise<Array<{ id: string; raw: string }>> {
  const out: Array<{ id: string; raw: string }> = []
  for (const filePath of filePaths) {
    const raw = await fs.readFile(filePath, 'utf8')
    out.push({ id: path.basename(filePath), raw })
  }
  return out
}

export async function rankMailMessages(
  workspace: string,
  messages: Array<{ id?: string; uid?: number; raw: string }>,
): Promise<MailListing[]> {
  const prefs = await readJobPreferences(workspace)
  const tracked = await listApplications(workspace)
  const trackedUrls = new Set(tracked.map((t) => t.jobUrl.trim().toLowerCase()).filter(Boolean))
  const trackedKeys = new Set(
    tracked.map((t) => `${t.company.toLowerCase()}::${t.role.toLowerCase()}`),
  )
  const query = prefs.keywords.slice(0, 4).join(' ')
  const seen = new Set<string>()
  const listings: MailListing[] = []

  for (const msg of messages) {
    const parsedList = parseJobEmails(msg.raw)
    for (const parsed of parsedList) {
      if (!parsed.isJob) continue
      const listing = parsedToListing(parsed, {
        id: msg.uid ? `imap-${msg.uid}-${parsed.role}` : msg.id ? `file-${msg.id}-${parsed.role}` : undefined,
        uid: msg.uid,
      })
      const key = `${listing.company.toLowerCase()}::${listing.role.toLowerCase()}::${listing.jobUrl.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const ranked = scoreListing(
        {
          title: listing.role || listing.subject,
          company: listing.company || listing.from,
          location: listing.location,
          description: listing.description,
          tags: [listing.source],
        },
        prefs,
        query,
      )
      const alreadyTracked =
        trackedUrls.has(listing.jobUrl.trim().toLowerCase()) ||
        Boolean(listing.company && listing.role && trackedKeys.has(`${listing.company.toLowerCase()}::${listing.role.toLowerCase()}`))
      const combined = Math.round(listing.jobLikelihood * 0.35 + ranked.score * 0.65)
      listings.push({
        ...listing,
        score: alreadyTracked ? Math.max(0, combined - 20) : combined,
        scoreReasons: alreadyTracked
          ? [...ranked.reasons.slice(0, 3), 'Already in tracker']
          : [...parsed.reasons.slice(0, 2), ...ranked.reasons].slice(0, 4),
        alreadyTracked,
      })
    }
  }

  listings.sort((a, b) => b.score - a.score)
  return listings.filter((l) => l.score >= 30 || l.jobLikelihood >= 50).slice(0, prefs.maxResults)
}
