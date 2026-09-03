import { ApiError, ErrorCode, unauthorized } from '../lib/errors.js'
import {
  json,
  ok,
  parseJsonBody,
  requireEmail,
  requirePassword,
  requireString,
  type HttpRequest,
  type HttpResponse,
} from '../lib/http.js'
import { config, loadSecrets } from '../lib/config.js'
import { signAccessToken } from '../lib/jwt.js'
import { authenticate, createUser } from '../data/users.js'
import {
  createSession,
  listSessions,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  type DeviceInfo,
} from '../data/sessions.js'
import { createFreeSubscription, getSubscription } from '../data/subscriptions.js'
import { resolveEntitlements } from '../domain/entitlements.js'
import { authenticateRequest } from '../domain/authorize.js'

type TokenPair = {
  access_token: string
  expires_at: number
  refresh_token: string
  session_id: string
}

async function issueTokens(userId: string, device: DeviceInfo): Promise<TokenPair> {
  const { jwtSecret } = await loadSecrets()
  const { session, refreshToken } = await createSession(userId, device)
  const { token, expiresAt } = signAccessToken(
    { sub: userId, sid: session.sessionId },
    jwtSecret,
    config.accessTokenTtlSeconds,
  )
  return {
    access_token: token,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    session_id: session.sessionId,
  }
}

function readDevice(body: Record<string, unknown>): DeviceInfo {
  const device = (body.device ?? {}) as Record<string, unknown>
  return {
    deviceId: typeof device.device_id === 'string' ? device.device_id : undefined,
    deviceName: typeof device.device_name === 'string' ? device.device_name : undefined,
    platform: typeof device.platform === 'string' ? device.platform : undefined,
  }
}

export async function signup(req: HttpRequest): Promise<HttpResponse> {
  const body = parseJsonBody<Record<string, unknown>>(req)
  const email = requireEmail(body.email)
  const password = requirePassword(body.password)

  const user = await createUser(email, password)
  await createFreeSubscription(user.userId)
  const tokens = await issueTokens(user.userId, readDevice(body))

  req.log.info('auth.signup', { userId: user.userId })
  return json(201, {
    ...tokens,
    account: { user_id: user.userId, email: user.email, status: user.status },
  })
}

export async function login(req: HttpRequest): Promise<HttpResponse> {
  const body = parseJsonBody<Record<string, unknown>>(req)
  const email = requireEmail(body.email)
  const password = requireString(body.password, 'password', 200)

  const user = await authenticate(email, password)
  if (!user) {
    req.log.warn('auth.login.failed', { email })
    throw unauthorized('Incorrect email or password.')
  }
  if (user.status !== 'active') {
    throw new ApiError(ErrorCode.ACCOUNT_SUSPENDED, 'This account is not active.')
  }

  const tokens = await issueTokens(user.userId, readDevice(body))
  req.log.info('auth.login', { userId: user.userId })
  return ok({
    ...tokens,
    account: { user_id: user.userId, email: user.email, status: user.status },
  })
}

/**
 * Rotates a refresh token.
 *
 * The session ID travels with the refresh token so the lookup does not require
 * a live access token — which is the whole point, since refresh happens exactly
 * when the access token has expired.
 */
export async function refresh(req: HttpRequest): Promise<HttpResponse> {
  const body = parseJsonBody<Record<string, unknown>>(req)
  const userId = requireString(body.user_id, 'user_id', 100)
  const sessionId = requireString(body.session_id, 'session_id', 100)
  const refreshToken = requireString(body.refresh_token, 'refresh_token', 500)

  const result = await rotateSession(userId, sessionId, refreshToken)
  if (!result.ok) {
    req.log.warn('auth.refresh.rejected', { userId, sessionId, reason: result.reason })
    throw unauthorized(
      result.reason === 'reused'
        ? 'This session was ended for security reasons. Sign in again.'
        : 'Session expired. Sign in again.',
    )
  }

  const { jwtSecret } = await loadSecrets()
  const { token, expiresAt } = signAccessToken(
    { sub: userId, sid: sessionId },
    jwtSecret,
    config.accessTokenTtlSeconds,
  )
  return ok({
    access_token: token,
    expires_at: expiresAt,
    refresh_token: result.refreshToken,
    session_id: sessionId,
  })
}

export async function logout(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  await revokeSession(principal.userId, principal.sessionId)
  req.log.info('auth.logout', { userId: principal.userId })
  return ok({ signed_out: true })
}

export async function logoutAll(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const count = await revokeAllSessions(principal.userId)
  req.log.info('auth.logout_all', { userId: principal.userId, sessions: count })
  return ok({ signed_out: true, sessions_revoked: count })
}

export async function sessions(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const rows = await listSessions(principal.userId)
  return ok({
    sessions: rows.map((session) => ({
      session_id: session.sessionId,
      device_name: session.deviceName,
      platform: session.platform,
      created_at: session.createdAt,
      last_seen_at: session.lastSeenAt,
      current: session.sessionId === principal.sessionId,
    })),
  })
}

/** Convenience for the desktop: identity plus entitlements in one round trip. */
export async function me(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const subscription = await getSubscription(principal.userId)
  const entitlements = await resolveEntitlements(principal.userId, subscription)
  return ok({
    account: {
      user_id: principal.user.userId,
      email: principal.user.email,
      status: principal.user.status,
      created_at: principal.user.createdAt,
    },
    entitlements,
  })
}
