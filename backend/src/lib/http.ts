/**
 * Transport-neutral request/response types.
 *
 * Handlers work against these rather than Lambda event shapes so the whole API
 * can be exercised in-process by the test suite, and so swapping the Function
 * URL for API Gateway later touches one adapter instead of every handler.
 */
import { badRequest } from './errors.js'
import type { Logger } from './log.js'

export type HttpRequest = {
  method: string
  path: string
  headers: Record<string, string>
  query: Record<string, string>
  /** Raw body text; webhook signature checks need the bytes as received. */
  rawBody: string
  requestId: string
  sourceIp: string
  log: Logger
}

export type HttpResponse = {
  status: number
  headers?: Record<string, string>
  body: unknown
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): HttpResponse => ({
  status,
  body,
  ...(headers ? { headers } : {}),
})

export const ok = (body: unknown): HttpResponse => json(200, body)

export function parseJsonBody<T>(req: HttpRequest): T {
  if (!req.rawBody) throw badRequest('Request body is required.')
  try {
    return JSON.parse(req.rawBody) as T
  } catch {
    throw badRequest('Request body must be valid JSON.')
  }
}

export function bearerToken(req: HttpRequest): string | null {
  const header = req.headers['authorization'] || req.headers['Authorization'] || ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? (match[1] as string).trim() : null
}

export function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`\`${field}\` is required.`)
  }
  if (value.length > max) throw badRequest(`\`${field}\` is too long.`)
  return value.trim()
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function requireEmail(value: unknown): string {
  const email = requireString(value, 'email', 320).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) throw badRequest('Enter a valid email address.')
  return email
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10) {
    throw badRequest('Password must be at least 10 characters.')
  }
  if (value.length > 200) throw badRequest('Password is too long.')
  return value
}
