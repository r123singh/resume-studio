/**
 * Client for the AI Backend Control Layer.
 *
 * The desktop is a consumer of the platform, not an owner of it: this module
 * carries a bearer token and nothing else. No AWS credentials, model IDs,
 * pricing, or quota logic exist on this side of the boundary.
 */
import { clearSession, deviceInfo, readRefreshToken, readSession, writeSession } from './session.js'

const DEFAULT_API_URL = process.env.RESUME_STUDIO_API_URL || ''

export class PlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

export function apiBaseUrl(): string {
  const url = DEFAULT_API_URL.trim().replace(/\/+$/, '')
  if (!url) {
    throw new PlatformError(
      'INVALID_REQUEST',
      'Managed AI is not configured for this build. Set RESUME_STUDIO_API_URL.',
    )
  }
  return url
}

export const isConfigured = (): boolean => Boolean(DEFAULT_API_URL.trim())

/** Access tokens live in memory only, so a disk read cannot yield one. */
let accessToken = ''
let accessTokenExpiresAt = 0

async function parseError(response: Response): Promise<PlatformError> {
  let code = 'INTERNAL_ERROR'
  let message = 'The AI service is unavailable.'
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string }
      Message?: string
      message?: string
    }
    if (body?.error?.code) code = body.error.code
    if (body?.error?.message) message = body.error.message
    else if (body?.Message || body?.message) message = String(body.Message || body.message)
  } catch {
    // A non-JSON body means an infrastructure-level failure; the generic
    // message is correct and the status is enough to act on.
    if (response.status === 401) code = 'AUTHENTICATION_REQUIRED'
  }
  // Function URL 403s are AWS IAM, not our error envelope. Without this map
  // they collapse into "Something went wrong."
  if (
    response.status === 403 &&
    (code === 'INTERNAL_ERROR' || /Forbidden|AccessDenied/i.test(message))
  ) {
    code = 'ACCESS_DENIED'
  }
  if (response.status === 401 && code === 'INTERNAL_ERROR') {
    code = 'AUTHENTICATION_REQUIRED'
  }
  const retryAfter = Number(response.headers.get('retry-after') || '')
  return new PlatformError(code, message, Number.isFinite(retryAfter) ? retryAfter : undefined)
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

type TokenResponse = {
  access_token: string
  expires_at: number
  refresh_token: string
  session_id: string
  account?: { user_id: string; email: string }
}

function storeAccessToken(tokens: TokenResponse) {
  accessToken = tokens.access_token
  // Refresh a minute early so a request never races its own expiry.
  accessTokenExpiresAt = tokens.expires_at * 1000 - 60_000
}

/**
 * Returns a usable access token, refreshing when needed.
 *
 * A failed refresh clears the local session rather than retrying, because the
 * only recoverable states are "expired" and "revoked", and both require the
 * user to sign in again.
 */
async function accessTokenOrThrow(): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken

  const session = await readSession()
  const refreshToken = await readRefreshToken()
  if (!session || !refreshToken) {
    throw new PlatformError('AUTHENTICATION_REQUIRED', 'Sign in to use managed AI.')
  }

  try {
    const tokens = await post<TokenResponse>('/auth/refresh', {
      user_id: session.userId,
      session_id: session.sessionId,
      refresh_token: refreshToken,
    })
    storeAccessToken(tokens)
    await writeSession({
      userId: session.userId,
      sessionId: tokens.session_id,
      email: session.email,
      refreshToken: tokens.refresh_token,
      deviceId: session.deviceId,
    })
    return accessToken
  } catch (err) {
    if (err instanceof PlatformError && err.code === 'AUTHENTICATION_REQUIRED') {
      await signOutLocal()
    }
    throw err
  }
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessTokenOrThrow()
  const headers = {
    ...(init.headers as Record<string, string> | undefined),
    authorization: `Bearer ${token}`,
  }
  const response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers })

  // A 401 on a token we believed was valid means the session was revoked
  // elsewhere; drop the cached token and let one retry re-establish it.
  if (response.status === 401 && accessToken) {
    accessToken = ''
    accessTokenExpiresAt = 0
    const retryToken = await accessTokenOrThrow()
    return fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { ...headers, authorization: `Bearer ${retryToken}` },
    })
  }
  return response
}

export async function signUp(email: string, password: string) {
  const tokens = await post<TokenResponse>('/auth/signup', {
    email,
    password,
    device: await deviceInfo(),
  })
  storeAccessToken(tokens)
  await writeSession({
    userId: tokens.account?.user_id ?? '',
    sessionId: tokens.session_id,
    email: tokens.account?.email ?? email,
    refreshToken: tokens.refresh_token,
  })
  return { userId: tokens.account?.user_id ?? '', email: tokens.account?.email ?? email }
}

export async function signIn(email: string, password: string) {
  const tokens = await post<TokenResponse>('/auth/login', {
    email,
    password,
    device: await deviceInfo(),
  })
  storeAccessToken(tokens)
  await writeSession({
    userId: tokens.account?.user_id ?? '',
    sessionId: tokens.session_id,
    email: tokens.account?.email ?? email,
    refreshToken: tokens.refresh_token,
  })
  return { userId: tokens.account?.user_id ?? '', email: tokens.account?.email ?? email }
}

async function signOutLocal() {
  accessToken = ''
  accessTokenExpiresAt = 0
  await clearSession()
}

export async function signOut(): Promise<void> {
  try {
    await authedFetch('/auth/logout', { method: 'POST' })
  } catch {
    // Local sign-out must succeed even when offline or already revoked.
  }
  await signOutLocal()
}

export type AccountState = {
  account: { user_id: string; email: string; status: string; created_at: string }
  subscription: Record<string, unknown>
  entitlements: Record<string, unknown>
  usage: Record<string, unknown>
  feature_flags: Record<string, boolean>
}

export async function getAccount(): Promise<AccountState> {
  const response = await authedFetch('/account')
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as AccountState
}

export async function getUsage(): Promise<Record<string, unknown>> {
  const response = await authedFetch('/usage')
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as Record<string, unknown>
}

export async function isSignedIn(): Promise<boolean> {
  return Boolean(await readSession())
}

export async function currentEmail(): Promise<string> {
  return (await readSession())?.email ?? ''
}

export type AiRequestBody = {
  request_id: string
  conversation_id?: string
  capability: string
  system?: string
  messages: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[]
  tools?: { name: string; description?: string; inputSchema: Record<string, unknown> }[]
  params?: { temperature?: number; maxTokens?: number }
  metadata?: Record<string, unknown>
}

export type PlatformStreamEvent = { type: string; [key: string]: unknown }

/**
 * Streams an AI response as server-sent events.
 *
 * `platformError` events are converted into thrown `PlatformError`s so callers
 * handle mid-stream failures the same way as an upfront rejection — the HTTP
 * status is already committed by the time the model fails.
 */
export async function* streamAi(
  body: AiRequestBody,
  signal?: AbortSignal,
): AsyncGenerator<PlatformStreamEvent, void, undefined> {
  const response = await authedFetch('/ai/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw await parseError(response)
  if (!response.body) throw new PlatformError('AI_PROVIDER_ERROR', 'The AI service returned no data.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')

      if (!frame.startsWith('data:')) continue
      const payload = frame.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let event: PlatformStreamEvent
      try {
        event = JSON.parse(payload) as PlatformStreamEvent
      } catch {
        continue
      }
      if (event.type === 'platformError') {
        throw new PlatformError(
          String(event.code || 'AI_PROVIDER_ERROR'),
          String(event.message || 'The AI request failed.'),
        )
      }
      yield event
    }
  }
}

export async function requestAi(body: AiRequestBody, signal?: AbortSignal) {
  const response = await authedFetch('/ai/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as {
    request_id: string
    model: string
    stop_reason: string
    content: Record<string, unknown>[]
    usage: { input_tokens: number; output_tokens: number }
  }
}
