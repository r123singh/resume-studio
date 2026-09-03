/**
 * Authentication and the AI authorization pipeline.
 *
 * Every decision here is re-derived from server state. Nothing the client sends
 * about its plan, quota, model, or role is trusted, because the desktop app is
 * an untrusted client that can be modified.
 */
import { ApiError, ErrorCode, unauthorized } from '../lib/errors.js'
import { bearerToken, type HttpRequest } from '../lib/http.js'
import { verifyAccessToken } from '../lib/jwt.js'
import { loadSecrets, config } from '../lib/config.js'
import { findUserById, type User } from '../data/users.js'
import { isSessionActive } from '../data/sessions.js'
import { getSubscription, usagePeriod, type Subscription } from '../data/subscriptions.js'
import { getUsageCounter, checkRateLimit } from '../data/usage.js'
import { effectivePlan, resolveEntitlements, type Entitlements } from './entitlements.js'
import { routeCapability, type RoutedModel } from './router.js'
import type { Capability, Plan } from '../data/catalog.js'

export type Principal = {
  user: User
  userId: string
  sessionId: string
}

/**
 * Resolves the caller from a bearer token.
 *
 * The session lookup is what makes sign-out immediate: an access token remains
 * cryptographically valid until it expires, so revocation has to be checked
 * against stored session state on every call.
 */
export async function authenticateRequest(req: HttpRequest): Promise<Principal> {
  const token = bearerToken(req)
  if (!token) throw unauthorized('Sign in to continue.')

  const { jwtSecret } = await loadSecrets()
  const claims = verifyAccessToken(token, jwtSecret)

  const active = await isSessionActive(claims.sub, claims.sid)
  if (!active) throw unauthorized('This session has ended. Sign in again.')

  const user = await findUserById(claims.sub)
  if (!user) throw unauthorized('Account not found.')
  if (user.status === 'suspended') {
    throw new ApiError(ErrorCode.ACCOUNT_SUSPENDED, 'This account is suspended.')
  }
  if (user.status === 'deleted') throw unauthorized('Account not found.')

  return { user, userId: user.userId, sessionId: claims.sid }
}

export type AuthorizedAiContext = {
  principal: Principal
  subscription: Subscription
  plan: Plan
  entitlements: Entitlements
  route: RoutedModel
  period: string
}

/**
 * Runs the full gate sequence for an AI request.
 *
 * Order matters: cheap checks that reject outright run before the rate-limit
 * counter is incremented, so a user who is out of quota or lacks a capability
 * is not also penalised against their request rate.
 */
export async function authorizeAiRequest(
  principal: Principal,
  capability: Capability,
): Promise<AuthorizedAiContext> {
  const subscription = await getSubscription(principal.userId)
  const { plan } = await effectivePlan(subscription)
  const period = usagePeriod(subscription)
  const counter = await getUsageCounter(principal.userId, period)
  const entitlements = await resolveEntitlements(principal.userId, subscription, counter)

  if (!plan.aiAccess) {
    throw new ApiError(
      ErrorCode.SUBSCRIPTION_REQUIRED,
      'An active subscription is required to use managed AI.',
    )
  }

  // Capability and tier gating. Throws AI_ACCESS_DENIED or MODEL_UNAVAILABLE.
  const route = await routeCapability(capability, plan)

  if (counter.requests >= plan.requestsPerPeriod) {
    throw new ApiError(
      ErrorCode.USAGE_LIMIT_REACHED,
      `You have used all ${plan.requestsPerPeriod} AI requests in this billing period.`,
      {
        details: {
          requests_used: counter.requests,
          requests_limit: plan.requestsPerPeriod,
          period_end: subscription.currentPeriodEnd,
        },
      },
    )
  }

  const tokensUsed = counter.inputTokens + counter.outputTokens
  if (tokensUsed >= plan.tokenCeilingPerPeriod) {
    throw new ApiError(
      ErrorCode.USAGE_LIMIT_REACHED,
      'You have reached the token limit for this billing period.',
      { details: { tokens_used: tokensUsed, tokens_limit: plan.tokenCeilingPerPeriod } },
    )
  }

  const limitPerMinute = Math.min(plan.rateLimitPerMinute, config.rateLimitPerMinute * 10)
  const rate = await checkRateLimit(principal.userId, limitPerMinute)
  if (!rate.allowed) {
    throw new ApiError(ErrorCode.RATE_LIMITED, 'Too many requests. Try again in a moment.', {
      retryAfterSeconds: rate.retryAfterSeconds,
    })
  }

  return { principal, subscription, plan, entitlements, route, period }
}
