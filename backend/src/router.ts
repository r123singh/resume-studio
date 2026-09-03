/**
 * Request routing.
 *
 * A literal table rather than a framework: there are a dozen routes, and this
 * keeps the Lambda bundle and cold start small.
 */
import { json, ok, type HttpRequest, type HttpResponse } from './lib/http.js'
import { ApiError, ErrorCode, notFound, toApiError } from './lib/errors.js'
import * as auth from './handlers/auth.js'
import * as account from './handlers/account.js'
import * as ai from './handlers/ai.js'
import * as billing from './handlers/billing.js'

type Handler = (req: HttpRequest) => Promise<HttpResponse>

const routes: Record<string, Handler> = {
  'GET /health': async () => ok({ status: 'ok' }),

  'POST /auth/signup': auth.signup,
  'POST /auth/login': auth.login,
  'POST /auth/refresh': auth.refresh,
  'POST /auth/logout': auth.logout,
  'POST /auth/logout-all': auth.logoutAll,
  'GET /auth/sessions': auth.sessions,
  'GET /auth/me': auth.me,

  'GET /account': account.account,
  'GET /account/entitlements': account.entitlements,
  'GET /subscription': account.subscription,
  'GET /usage': account.usage,
  'GET /models': account.models,

  'POST /ai/request': ai.aiRequest,

  'POST /billing/webhook': billing.webhook,
}

export const STREAM_ROUTE = 'POST /ai/stream'

export const routeKey = (req: HttpRequest): string =>
  `${req.method.toUpperCase()} ${req.path.replace(/\/+$/, '') || '/'}`

export const isStreamRoute = (req: HttpRequest): boolean => routeKey(req) === STREAM_ROUTE

/**
 * Dispatches a buffered request and converts any failure into the standard
 * error envelope, so no handler can leak an internal message.
 */
export async function handleRequest(req: HttpRequest): Promise<HttpResponse> {
  const key = routeKey(req)
  const handler = routes[key]

  try {
    if (!handler) throw notFound(`No route for ${key}.`)
    const response = await handler(req)
    return {
      ...response,
      headers: { 'x-request-id': req.requestId, ...(response.headers ?? {}) },
    }
  } catch (err) {
    return errorResponse(err, req)
  }
}

export function errorResponse(err: unknown, req: HttpRequest): HttpResponse {
  const apiError = normalize(err, req)
  const headers: Record<string, string> = { 'x-request-id': req.requestId }
  if (apiError.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(apiError.retryAfterSeconds)
  }
  return json(apiError.status, apiError.toJSON(req.requestId), headers)
}

function normalize(err: unknown, req: HttpRequest): ApiError {
  if (err instanceof ApiError) {
    if (apiErrorIsExpected(err)) req.log.info('request.rejected', { code: err.code })
    else req.log.warn('request.error', { code: err.code })
    return err
  }
  // Unexpected failures are logged in full internally and flattened externally.
  req.log.error('request.unhandled', {
    name: (err as Error)?.name,
    message: (err as Error)?.message,
    stack: (err as Error)?.stack,
  })
  return toApiError(err)
}

/** Client-caused outcomes are normal traffic, not operational problems. */
function apiErrorIsExpected(err: ApiError): boolean {
  return (
    err.code === ErrorCode.AUTHENTICATION_REQUIRED ||
    err.code === ErrorCode.INVALID_REQUEST ||
    err.code === ErrorCode.USAGE_LIMIT_REACHED ||
    err.code === ErrorCode.RATE_LIMITED ||
    err.code === ErrorCode.SUBSCRIPTION_REQUIRED ||
    err.code === ErrorCode.AI_ACCESS_DENIED ||
    err.code === ErrorCode.NOT_FOUND ||
    err.code === ErrorCode.CONFLICT
  )
}

export { ai }
