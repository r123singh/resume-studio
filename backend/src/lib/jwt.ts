/**
 * Minimal HS256 JWT implementation on `node:crypto`.
 *
 * A dedicated JWT library would pull a dependency tree into every Lambda cold
 * start for roughly forty lines of logic, and the algorithm is fixed rather
 * than negotiated — which also sidesteps the `alg: none` and algorithm-
 * confusion classes of bug that come with general-purpose verifiers.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { unauthorized } from './errors.js'

export type AccessTokenClaims = {
  /** User ID. */
  sub: string
  /** Session ID, so a single device can be revoked. */
  sid: string
  /** Issued at, seconds. */
  iat: number
  /** Expiry, seconds. */
  exp: number
  /** Token type guard: access tokens must never be accepted as refresh tokens. */
  typ: 'access'
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url')

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'typ'>,
  secret: string,
  ttlSeconds: number,
): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttlSeconds
  const full: AccessTokenClaims = { ...claims, iat: now, exp, typ: 'access' }
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(full))
  const signingInput = `${header}.${body}`
  return { token: `${signingInput}.${sign(signingInput, secret)}`, expiresAt: exp }
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  const parts = token.split('.')
  if (parts.length !== 3) throw unauthorized('Malformed token.')
  const [header, body, signature] = parts as [string, string, string]

  const expected = sign(`${header}.${body}`, secret)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw unauthorized('Invalid token.')
  }

  let claims: AccessTokenClaims
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw unauthorized('Malformed token.')
  }

  if (claims.typ !== 'access') throw unauthorized('Invalid token type.')
  if (!claims.sub || !claims.sid) throw unauthorized('Invalid token claims.')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    throw unauthorized('Session expired. Sign in again.')
  }
  return claims
}
