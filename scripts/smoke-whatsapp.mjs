/**
 * Contract checks for WhatsApp Recruiter Desk helpers.
 * Mirrors the critical bits of src/lib/whatsapp.ts so a plain Node run
 * can catch phone / wa.me regressions without a TS loader.
 *
 *   node scripts/smoke-whatsapp.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) {
    const rest = digits.slice(1)
    if (/^[6-9]\d{9}$/.test(rest)) return `91${rest}`
  }
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length >= 8 && digits.length <= 15) return digits
  return ''
}

function buildWaMeUrl(phone, text) {
  const digits = normalizePhone(phone)
  const encoded = encodeURIComponent(text)
  if (digits) return `https://wa.me/${digits}?text=${encoded}`
  return `https://wa.me/?text=${encoded}`
}

assert.equal(normalizePhone('+91 98100 11223'), '919810011223')
assert.equal(normalizePhone('9810011223'), '919810011223')
assert.equal(normalizePhone('09810011223'), '919810011223')
assert.match(
  buildWaMeUrl('+91 98100 11223', 'Hi Ananya — sharing my CV'),
  /^https:\/\/wa\.me\/919810011223\?text=Hi%20Ananya/,
)
assert.equal(buildWaMeUrl('', 'kit').startsWith('https://wa.me/?text='), true)

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'whatsapp.ts'),
  'utf8',
)
assert.match(src, /SAMPLE_RECRUITER_THREAD/)
assert.match(src, /\+91 98100 11223/)
assert.match(src, /scorePhoneSkim/)
assert.match(src, /please find attached/i)

console.log('smoke-whatsapp: ok')
