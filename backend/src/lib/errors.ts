/**
 * Standardized error taxonomy shared by the backend and the desktop client.
 *
 * The desktop maps these codes to user-facing copy, so codes are part of the
 * public API contract and must not be renamed without a client change. Raw AWS
 * or database errors never reach the client; they are collapsed into
 * `INTERNAL_ERROR` or `AI_PROVIDER_ERROR` and logged with a correlation ID.
 */
export const ErrorCode = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  AI_ACCESS_DENIED: 'AI_ACCESS_DENIED',
  USAGE_LIMIT_REACHED: 'USAGE_LIMIT_REACHED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  CONFLICT: 'CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

const STATUS_BY_CODE: Record<ErrorCodeValue, number> = {
  AUTHENTICATION_REQUIRED: 401,
  ACCOUNT_SUSPENDED: 403,
  SUBSCRIPTION_REQUIRED: 402,
  AI_ACCESS_DENIED: 403,
  USAGE_LIMIT_REACHED: 429,
  MODEL_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  AI_PROVIDER_ERROR: 502,
  INVALID_REQUEST: 400,
  CONFLICT: 409,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
}

export class ApiError extends Error {
  readonly code: ErrorCodeValue
  readonly status: number
  /** Safe to show the user; never contains provider internals. */
  readonly details?: Record<string, unknown>
  readonly retryAfterSeconds?: number

  constructor(
    code: ErrorCodeValue,
    message: string,
    options: { details?: Record<string, unknown>; retryAfterSeconds?: number } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    if (options.details) this.details = options.details
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds
  }

  toJSON(requestId?: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        ...(this.retryAfterSeconds !== undefined
          ? { retry_after_seconds: this.retryAfterSeconds }
          : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    }
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiError(ErrorCode.INVALID_REQUEST, message, details ? { details } : {})

export const unauthorized = (message = 'Sign in to continue.') =>
  new ApiError(ErrorCode.AUTHENTICATION_REQUIRED, message)

export const notFound = (message = 'Not found.') => new ApiError(ErrorCode.NOT_FOUND, message)

export const conflict = (message: string) => new ApiError(ErrorCode.CONFLICT, message)

export const internal = (message = 'Something went wrong. Please try again.') =>
  new ApiError(ErrorCode.INTERNAL_ERROR, message)

/** Wraps anything thrown into an ApiError so handlers never leak internals. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  return internal()
}
