/**
 * Device sessions.
 *
 * One session per signed-in installation, which is what makes "sign out this
 * device" and the device list possible. Refresh tokens rotate on every use and
 * only their SHA-256 hash is stored, so a table leak cannot be replayed.
 */
import { store, ttlInSeconds } from './store.js'
import { generateRefreshToken, hashToken, newId } from '../lib/crypto.js'
import { config } from '../lib/config.js'

export type Session = {
  pk: string
  sk: string
  entity: 'session'
  userId: string
  sessionId: string
  refreshHash: string
  deviceId: string
  deviceName: string
  platform: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  revokedAt?: string
  /** Set when a rotated token is replayed, which indicates theft. */
  reuseDetectedAt?: string
}

const sessionKey = (userId: string, sessionId: string) => ({
  pk: `USER#${userId}`,
  sk: `SESSION#${sessionId}`,
})

export type DeviceInfo = { deviceId?: string; deviceName?: string; platform?: string }

export async function createSession(
  userId: string,
  device: DeviceInfo,
): Promise<{ session: Session; refreshToken: string }> {
  const sessionId = newId('ses')
  const refreshToken = generateRefreshToken()
  const now = new Date()
  const expires = new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000)

  const session: Session & { ttl: number } = {
    ...sessionKey(userId, sessionId),
    entity: 'session',
    userId,
    sessionId,
    refreshHash: hashToken(refreshToken),
    deviceId: device.deviceId?.slice(0, 128) || 'unknown',
    deviceName: device.deviceName?.slice(0, 128) || 'Unknown device',
    platform: device.platform?.slice(0, 64) || 'unknown',
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    ttl: ttlInSeconds(config.refreshTokenTtlSeconds + 60 * 60 * 24),
  }
  await store().put(session)
  return { session, refreshToken }
}

export async function getSession(userId: string, sessionId: string): Promise<Session | null> {
  const key = sessionKey(userId, sessionId)
  return store().get<Session>(key.pk, key.sk)
}

export async function listSessions(userId: string): Promise<Session[]> {
  const rows = await store().query<Session>(`USER#${userId}`, 'SESSION#')
  return rows.filter((s) => !s.revokedAt && new Date(s.expiresAt) > new Date())
}

export type RotateResult =
  | { ok: true; session: Session; refreshToken: string }
  | { ok: false; reason: 'not_found' | 'revoked' | 'expired' | 'reused' }

/**
 * Validates a refresh token and issues a replacement.
 *
 * A token that does not match the stored hash on an otherwise-live session is
 * treated as reuse of an already-rotated token: the session is revoked outright
 * rather than merely rejected, so a stolen token cannot outlive its discovery.
 */
export async function rotateSession(
  userId: string,
  sessionId: string,
  presentedToken: string,
): Promise<RotateResult> {
  const session = await getSession(userId, sessionId)
  if (!session) return { ok: false, reason: 'not_found' }
  if (session.revokedAt) return { ok: false, reason: 'revoked' }
  if (new Date(session.expiresAt) <= new Date()) return { ok: false, reason: 'expired' }

  if (session.refreshHash !== hashToken(presentedToken)) {
    await revokeSession(userId, sessionId, { reuseDetected: true })
    return { ok: false, reason: 'reused' }
  }

  const refreshToken = generateRefreshToken()
  const now = new Date()
  const expires = new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000)
  const key = sessionKey(userId, sessionId)
  const updated = await store().update(key.pk, key.sk, {
    set: {
      refreshHash: hashToken(refreshToken),
      lastSeenAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      ttl: ttlInSeconds(config.refreshTokenTtlSeconds + 60 * 60 * 24),
    },
  })
  return { ok: true, session: updated as Session, refreshToken }
}

export async function revokeSession(
  userId: string,
  sessionId: string,
  options: { reuseDetected?: boolean } = {},
): Promise<void> {
  const key = sessionKey(userId, sessionId)
  const now = new Date().toISOString()
  await store().update(key.pk, key.sk, {
    set: {
      revokedAt: now,
      ...(options.reuseDetected ? { reuseDetectedAt: now } : {}),
    },
  })
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const rows = await store().query<Session>(`USER#${userId}`, 'SESSION#')
  const live = rows.filter((s) => !s.revokedAt)
  await Promise.all(live.map((s) => revokeSession(userId, s.sessionId)))
  return live.length
}

/**
 * Confirms the session behind an access token is still live.
 *
 * Access tokens are short-lived but not self-revoking, so sign-out has to be
 * enforced here rather than by expiry alone.
 */
export async function isSessionActive(userId: string, sessionId: string): Promise<boolean> {
  const session = await getSession(userId, sessionId)
  if (!session || session.revokedAt) return false
  return new Date(session.expiresAt) > new Date()
}
