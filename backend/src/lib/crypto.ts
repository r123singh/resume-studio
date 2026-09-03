/**
 * Password hashing and opaque token generation.
 *
 * scrypt is used rather than bcrypt/argon2 because it is in the Node standard
 * library, so the Lambda bundle stays free of native modules.
 */
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64
const SALT_LENGTH = 16

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scryptAsync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1] as string, 'base64url')
  const expected = Buffer.from(parts[2] as string, 'base64url')
  const derived = await scryptAsync(password, salt, expected.length)
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

/** Opaque refresh token. Only its hash is persisted. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '')}`

export { randomUUID }
