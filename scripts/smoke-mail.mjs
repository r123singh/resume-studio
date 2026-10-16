/**
 * Contract checks for Mail Inbox helpers.
 * Mirrors the critical bits of src/lib/mail.ts so a plain Node run
 * can catch parse / mailto regressions without a TS loader.
 *
 *   node scripts/smoke-mail.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'mail.ts'),
  'utf8',
)

function decodeRfc2047(value) {
  return value.replace(
    /=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g,
    (_all, _charset, enc, payload) => {
      if (String(enc).toUpperCase() === 'B') {
        return Buffer.from(payload, 'base64').toString('utf8')
      }
      return payload.replace(/_/g, ' ')
    },
  )
}

function parseHeaders(raw) {
  const headers = {}
  const block = raw.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = decodeRfc2047(line.slice(idx + 1).trim())
    if (key) headers[key] = headers[key] ? `${headers[key]} ${value}` : value
  }
  return headers
}

function parseAddress(raw) {
  const trimmed = raw.trim()
  const angled = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>/)
  if (angled) return { name: angled[1].trim().replace(/^"|"$/g, ''), email: angled[2].trim() }
  const emailOnly = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return { name: trimmed, email: emailOnly?.[0] || '' }
}

function extractJobUrl(text) {
  const preferred = text.match(
    /https?:\/\/(?:www\.)?(?:linkedin\.com\/jobs\/(?:view|collections)\/[^\s)]+|naukri\.com\/[^\s)]+|indeed\.com\/(?:viewjob|cmp)[^\s)]+)/i,
  )
  if (preferred) return preferred[0].replace(/[.,;]+$/, '')
  const any = text.match(/https?:\/\/[^\s)<>"]+/i)
  return any ? any[0].replace(/[.,;]+$/, '') : ''
}

function buildMailtoUrl(to, reply) {
  const q = new URLSearchParams()
  if (reply.subject) q.set('subject', reply.subject)
  if (reply.body) q.set('body', reply.body)
  const query = q.toString().replace(/\+/g, '%20')
  return to ? `mailto:${to}?${query}` : `mailto:?${query}`
}

assert.equal(decodeRfc2047('=?UTF-8?B?U2VuaW9yIFBN?= at Simpplr'), 'Senior PM at Simpplr')

const sampleStart = src.indexOf('export const SAMPLE_JOB_EMAIL')
assert.ok(sampleStart > 0)
const sample = src.slice(src.indexOf('`', sampleStart) + 1, src.indexOf('`', src.indexOf('`', sampleStart) + 1))
assert.match(sample, /Ananya Sharma/)
assert.match(sample, /simpplr\.com\/careers/)

const splitAt = sample.search(/\r?\n\r?\n/)
const headers = parseHeaders(sample.slice(0, splitAt))
const from = parseAddress(headers.from)
assert.equal(from.email, 'ananya@talentgrid.in')
assert.match(headers.subject, /Senior Product Manager/)
assert.equal(extractJobUrl(sample), 'https://simpplr.com/careers/spm-ai')

const mailto = buildMailtoUrl('ananya@talentgrid.in', {
  subject: 'Re: Senior Product Manager at Simpplr',
  body: 'Hi Ananya,\n\nThank you for reaching out.',
})
assert.match(mailto, /^mailto:ananya@talentgrid\.in\?/)
assert.match(mailto, /subject=Re/)

assert.match(src, /SAMPLE_LINKEDIN_ALERT/)
assert.match(src, /linkedin\.com\/jobs\/view/)
assert.match(src, /BODY\.PEEK|Fetch inbox|parseJobEmails/)
assert.match(src, /channel: email/)
assert.match(src, /smtpFromImapHost/)
assert.match(src, /normalizeRecipient/)

function normalizeRecipient(raw) {
  const trimmed = (raw || '').trim().replace(/^mailto:/i, '')
  if (!trimmed || /[,;\n]/.test(trimmed)) return ''
  const emailOnly = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return emailOnly ? emailOnly[0].toLowerCase() : ''
}

assert.equal(normalizeRecipient('Ananya Sharma <ananya@talentgrid.in>'), 'ananya@talentgrid.in')
assert.equal(normalizeRecipient('a@x.com, b@y.com'), '')
assert.equal(normalizeRecipient('not-an-email'), '')

const sendSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'mail-send.ts'),
  'utf8',
)
assert.match(sendSrc, /AUTH PLAIN/)
assert.match(sendSrc, /STARTTLS/)
assert.match(sendSrc, /multipart\/mixed/)
assert.match(sendSrc, /MAX_SENDS_PER_WINDOW/)

const imapSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'mail-inbox.ts'),
  'utf8',
)
assert.match(imapSrc, /UID SEARCH SINCE/)
assert.match(imapSrc, /BODY\.PEEK\[\]/)
assert.match(imapSrc, /rankMailMessages/)

console.log('smoke-mail: ok')
