/**
 * SMTP send for the Mail Inbox desk.
 *
 * One recipient per click, credentials stay in the main process, optional PDF
 * attach from the workspace apply kit. Nothing is sent until the user confirms.
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { kitDirFromNotes } from './applications'
import { normalizeRecipient, smtpFromImapHost } from '../src/lib/mail'

export type SmtpSettings = {
  host: string
  port: number
  user: string
  password: string
}

export type SendMailArgs = {
  from: string
  to: string
  subject: string
  body: string
  attachmentPath?: string | null
}

const CONNECT_TIMEOUT_MS = 25_000
const MAX_BODY_CHARS = 20_000
const MAX_SUBJECT_CHARS = 200
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const SEND_WINDOW_MS = 60_000
const MAX_SENDS_PER_WINDOW = 8

const sendTimes: number[] = []

function assertSendRate() {
  const now = Date.now()
  while (sendTimes.length && now - sendTimes[0] > SEND_WINDOW_MS) sendTimes.shift()
  if (sendTimes.length >= MAX_SENDS_PER_WINDOW) {
    throw new Error(`Send limit: ${MAX_SENDS_PER_WINDOW} emails per minute. Wait a moment.`)
  }
  sendTimes.push(now)
}

function quoteHeader(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ').trim()
  if (/^[\x20-\x7E]*$/.test(flat)) return flat
  return `=?UTF-8?B?${Buffer.from(flat, 'utf8').toString('base64')}?=`
}

function wrapBase64(raw: Buffer): string {
  const b64 = raw.toString('base64')
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76))
  return lines.join('\r\n')
}

function stampDotLines(payload: string): string {
  return payload.replace(/^\./gm, '..')
}

export function buildMimeMessage(args: {
  from: string
  to: string
  subject: string
  body: string
  attachment?: { filename: string; bytes: Buffer } | null
}): string {
  const date = new Date().toUTCString()
  const id = `<${Date.now()}.${Math.random().toString(36).slice(2, 12)}@resume-studio>`
  const text = args.body.replace(/\r?\n/g, '\r\n')
  if (!args.attachment) {
    return [
      `From: ${args.from}`,
      `To: ${args.to}`,
      `Subject: ${quoteHeader(args.subject)}`,
      `Date: ${date}`,
      `Message-ID: ${id}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      toQuotedPrintable(text),
    ].join('\r\n')
  }
  const boundary = `=_rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  const filename = args.attachment.filename.replace(/["\r\n]/g, '_')
  return [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${quoteHeader(args.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    toQuotedPrintable(text),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    wrapBase64(args.attachment.bytes),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

export function toQuotedPrintable(input: string): string {
  const bytes = Buffer.from(input, 'utf8')
  let out = ''
  let line = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    let chunk = ''
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      out += '\r\n'
      line = 0
      i++
      continue
    }
    if (b === 0x0a) {
      out += '\r\n'
      line = 0
      continue
    }
    if ((b >= 33 && b <= 126 && b !== 0x3d) || b === 0x09 || b === 0x20) {
      chunk = String.fromCharCode(b)
    } else {
      chunk = `=${b.toString(16).toUpperCase().padStart(2, '0')}`
    }
    if (line + chunk.length > 73) {
      out += '=\r\n'
      line = 0
    }
    out += chunk
    line += chunk.length
  }
  return out
}

class SmtpClient {
  private socket: net.Socket | null = null
  private buf = Buffer.alloc(0)
  private waiters: Array<() => void> = []

  async connect(host: string, port: number, implicitTls: boolean) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket?.destroy()
        reject(new Error(`SMTP connect timed out (${host}:${port})`))
      }, CONNECT_TIMEOUT_MS)
      const onReady = () => {
        clearTimeout(timer)
        resolve()
      }
      const socket = implicitTls
        ? tls.connect({ host, port, servername: host }, onReady)
        : net.connect({ host, port }, onReady)
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
    await this.readReply()
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buf.indexOf('\n')
      if (idx !== -1) {
        const line = this.buf.subarray(0, idx).toString('utf8').replace(/\r$/, '')
        this.buf = this.buf.subarray(idx + 1)
        return line
      }
      if (!this.socket || this.socket.destroyed) throw new Error('SMTP connection closed')
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  private async readReply(): Promise<{ code: number; text: string }> {
    const lines: string[] = []
    while (true) {
      const line = await this.readLine()
      lines.push(line)
      if (/^\d{3} /.test(line)) break
      if (!/^\d{3}-/.test(line)) break
    }
    const last = lines[lines.length - 1] || ''
    const code = Number(last.slice(0, 3)) || 0
    return { code, text: lines.join('\n') }
  }

  private write(text: string) {
    if (!this.socket) throw new Error('SMTP not connected')
    this.socket.write(text)
  }

  async command(text: string, expect?: number | number[]): Promise<{ code: number; text: string }> {
    this.write(`${text}\r\n`)
    const reply = await this.readReply()
    const ok = expect
      ? (Array.isArray(expect) ? expect : [expect]).includes(reply.code)
      : reply.code >= 200 && reply.code < 400
    if (!ok) throw new Error(`SMTP ${reply.code}: ${reply.text}`)
    return reply
  }

  async ehlo() {
    return this.command('EHLO resume-studio', 250)
  }

  async startTls(host: string) {
    await this.command('STARTTLS', 220)
    const plain = this.socket
    if (!plain) throw new Error('SMTP not connected')
    plain.removeAllListeners('data')
    this.buf = Buffer.alloc(0)
    const upgraded = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP STARTTLS timed out')), CONNECT_TIMEOUT_MS)
      const next = tls.connect({ socket: plain, servername: host }, () => {
        clearTimeout(timer)
        resolve(next)
      })
      next.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    upgraded.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk])
      const waiters = this.waiters.splice(0)
      for (const w of waiters) w()
    })
    upgraded.on('close', () => {
      const waiters = this.waiters.splice(0)
      for (const w of waiters) w()
    })
    this.socket = upgraded
    await this.ehlo()
  }

  async login(user: string, password: string) {
    const plain = Buffer.from(`\0${user}\0${password}`, 'utf8').toString('base64')
    try {
      await this.command(`AUTH PLAIN ${plain}`, 235)
      return
    } catch {
      await this.command('AUTH LOGIN', 334)
      await this.command(Buffer.from(user, 'utf8').toString('base64'), 334)
      await this.command(Buffer.from(password, 'utf8').toString('base64'), 235)
    }
  }

  async sendData(mime: string) {
    await this.command('DATA', 354)
    this.write(`${stampDotLines(mime.replace(/\r?\n/g, '\r\n'))}\r\n.\r\n`)
    const reply = await this.readReply()
    if (reply.code !== 250) throw new Error(`SMTP ${reply.code}: ${reply.text}`)
  }

  async quit() {
    try {
      await this.command('QUIT', [221, 250])
    } catch {
      // ignore
    }
    this.socket?.end()
    this.socket = null
  }
}

export function resolveSmtpSettings(args: {
  imapHost?: string
  smtpHost?: string
  smtpPort?: number
  user: string
  password: string
}): SmtpSettings {
  const derived = smtpFromImapHost(args.imapHost || args.smtpHost || '')
  return {
    host: (args.smtpHost || derived.host).trim(),
    port: args.smtpPort || derived.port,
    user: args.user.trim(),
    password: args.password,
  }
}

export async function sendMail(settings: SmtpSettings, args: SendMailArgs): Promise<{ to: string }> {
  const to = normalizeRecipient(args.to)
  const from = normalizeRecipient(args.from) || normalizeRecipient(settings.user)
  if (!settings.host || !settings.user || !settings.password) {
    throw new Error('Save IMAP/SMTP host, email, and app password in Settings first.')
  }
  if (!from) throw new Error('From address is missing. Save your email in Settings.')
  if (!to) throw new Error('To must be a single email address.')
  const subject = (args.subject || '').replace(/[\r\n]+/g, ' ').trim()
  const body = (args.body || '').trim()
  if (!subject) throw new Error('Subject is required.')
  if (subject.length > MAX_SUBJECT_CHARS) throw new Error('Subject is too long.')
  if (!body) throw new Error('Message body is empty.')
  if (body.length > MAX_BODY_CHARS) throw new Error('Message body is too long.')
  assertSendRate()

  let attachment: { filename: string; bytes: Buffer } | null = null
  if (args.attachmentPath) {
    const stat = await fs.stat(args.attachmentPath)
    if (stat.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Attachment is larger than 8 MB.')
    }
    attachment = {
      filename: path.basename(args.attachmentPath),
      bytes: await fs.readFile(args.attachmentPath),
    }
  }

  const mime = buildMimeMessage({ from, to, subject, body, attachment })
  const implicitTls = settings.port === 465
  const client = new SmtpClient()
  await client.connect(settings.host, settings.port || 587, implicitTls)
  try {
    await client.ehlo()
    if (!implicitTls) await client.startTls(settings.host)
    try {
      await client.login(settings.user, settings.password)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `SMTP login failed. Use an app password (same one as IMAP). ${msg}`,
      )
    }
    await client.command(`MAIL FROM:<${from}>`, 250)
    await client.command(`RCPT TO:<${to}>`, [250, 251])
    await client.sendData(mime)
  } finally {
    await client.quit()
  }
  return { to }
}

export function assertPdfInWorkspace(workspace: string, filePath: string): string {
  const resolved = path.resolve(filePath)
  const root = path.resolve(workspace)
  const rel = path.relative(root, resolved)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Attachment must be a file inside the workspace.')
  }
  if (!resolved.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF attachments are allowed.')
  }
  if (!fsSync.existsSync(resolved)) throw new Error('resume.pdf was not found. Build an Apply kit first.')
  return resolved
}

export function findKitPdf(args: {
  workspace: string
  knownPath?: string | null
  notes?: string
  company?: string
  role?: string
}): string | null {
  const candidates: string[] = []
  if (args.knownPath) candidates.push(args.knownPath)
  if (args.notes) {
    const kitDir = kitDirFromNotes(args.workspace, args.notes)
    if (kitDir) candidates.push(path.join(kitDir, 'resume.pdf'))
  }
  if (args.company && args.role) {
    const slug = `${slugify(args.company)}--${slugify(args.role)}`
    candidates.push(path.join(args.workspace, 'apply-kits', slug, 'resume.pdf'))
  }
  for (const file of candidates) {
    try {
      return assertPdfInWorkspace(args.workspace, file)
    } catch {
      // try next
    }
  }
  return null
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
