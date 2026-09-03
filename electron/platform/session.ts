/**
 * Local session storage for the managed AI account.
 *
 * Kept in its own file rather than `settings.json` so credentials are never
 * caught up in settings export, backup, or logging. The refresh token is
 * encrypted with Electron `safeStorage`; the access token is deliberately
 * memory-only, so it cannot be lifted off disk.
 *
 * Nothing here is a source of truth. Plan, quota, and entitlements always come
 * from the backend; this file only remembers who to ask as.
 */
import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

export type StoredSession = {
  userId: string
  sessionId: string
  email: string
  /** Encrypted refresh token. */
  refreshEnc: string
  deviceId: string
}

type SessionFile = Partial<StoredSession>

const sessionPath = () => path.join(app.getPath('userData'), 'platform-session.json')

function encrypt(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  return Buffer.from(plain, 'utf8').toString('base64')
}

function decrypt(enc?: string): string {
  if (!enc) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    }
    return Buffer.from(enc, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

let cached: StoredSession | null | undefined

export async function readSession(): Promise<StoredSession | null> {
  if (cached !== undefined) return cached
  try {
    const raw = await fs.readFile(sessionPath(), 'utf8')
    const parsed = JSON.parse(raw) as SessionFile
    if (!parsed.userId || !parsed.sessionId || !parsed.refreshEnc) {
      cached = null
      return null
    }
    cached = {
      userId: parsed.userId,
      sessionId: parsed.sessionId,
      email: parsed.email || '',
      refreshEnc: parsed.refreshEnc,
      deviceId: parsed.deviceId || randomUUID(),
    }
    return cached
  } catch {
    cached = null
    return null
  }
}

export async function writeSession(session: {
  userId: string
  sessionId: string
  email: string
  refreshToken: string
  deviceId?: string
}): Promise<void> {
  const existing = await readSession()
  const record: StoredSession = {
    userId: session.userId,
    sessionId: session.sessionId,
    email: session.email,
    refreshEnc: encrypt(session.refreshToken),
    deviceId: session.deviceId || existing?.deviceId || randomUUID(),
  }
  await fs.mkdir(path.dirname(sessionPath()), { recursive: true })
  await fs.writeFile(sessionPath(), JSON.stringify(record, null, 2), 'utf8')
  cached = record
}

export async function clearSession(): Promise<void> {
  cached = null
  await fs.rm(sessionPath(), { force: true })
}

export async function readRefreshToken(): Promise<string> {
  const session = await readSession()
  return session ? decrypt(session.refreshEnc) : ''
}

/** Stable per-installation identity so the device list is meaningful. */
export async function deviceInfo(): Promise<{
  device_id: string
  device_name: string
  platform: string
}> {
  const session = await readSession()
  return {
    device_id: session?.deviceId || randomUUID(),
    device_name: os.hostname() || 'Desktop',
    platform: `${process.platform}-${process.arch}`,
  }
}
