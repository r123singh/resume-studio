/**
 * Entitlement resolution.
 *
 * Entitlements are derived from `plan × subscription status` on every request
 * rather than stored. A downgrade, cancellation, or failed payment therefore
 * takes effect immediately, with no reconciliation job and no stale row to go
 * wrong.
 */
import { getPlan, type Capability, type Plan } from '../data/catalog.js'
import type { Subscription } from '../data/subscriptions.js'
import { usagePeriod } from '../data/subscriptions.js'
import { getUsageCounter, type UsageCounter } from '../data/usage.js'
import { DEFAULT_PLANS } from '../data/catalog.js'

export type Entitlements = {
  planId: string
  planName: string
  aiAccess: boolean
  capabilities: Capability[]
  features: string[]
  requestsLimit: number
  requestsUsed: number
  requestsRemaining: number
  tokensLimit: number
  tokensUsed: number
  periodStart: string
  periodEnd: string
  rateLimitPerMinute: number
  /** Present when the plan was reduced because the subscription is not live. */
  degradedFrom?: string
}

/**
 * Statuses that keep paid access. `past_due` is included deliberately: a card
 * that fails on renewal should not lock a user out mid-session, so access
 * survives until the grace period lapses.
 */
const LIVE_STATUSES = new Set(['active', 'trialing'])

export function subscriptionGrantsPaidAccess(subscription: Subscription): boolean {
  if (LIVE_STATUSES.has(subscription.status)) return true
  if (subscription.status === 'past_due') {
    if (!subscription.gracePeriodEndsAt) return true
    return new Date(subscription.gracePeriodEndsAt) > new Date()
  }
  return false
}

/**
 * Resolves the plan actually in force. A lapsed paid subscription falls back to
 * free rather than to nothing, so the product keeps working while the user
 * sorts out billing.
 */
export async function effectivePlan(
  subscription: Subscription,
): Promise<{ plan: Plan; degradedFrom?: string }> {
  if (subscriptionGrantsPaidAccess(subscription)) {
    return { plan: await getPlan(subscription.planId) }
  }
  const free = await getPlan('free')
  if (subscription.planId === 'free') return { plan: free }
  return { plan: free, degradedFrom: subscription.planId }
}

export async function resolveEntitlements(
  userId: string,
  subscription: Subscription,
  counter?: UsageCounter,
): Promise<Entitlements> {
  const { plan, degradedFrom } = await effectivePlan(subscription)
  const period = usagePeriod(subscription)
  const usage = counter ?? (await getUsageCounter(userId, period))
  const tokensUsed = usage.inputTokens + usage.outputTokens

  return {
    planId: plan.planId,
    planName: plan.name,
    aiAccess: plan.aiAccess,
    capabilities: plan.capabilities,
    features: plan.features,
    requestsLimit: plan.requestsPerPeriod,
    requestsUsed: usage.requests,
    requestsRemaining: Math.max(0, plan.requestsPerPeriod - usage.requests),
    tokensLimit: plan.tokenCeilingPerPeriod,
    tokensUsed,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    rateLimitPerMinute: plan.rateLimitPerMinute,
    ...(degradedFrom ? { degradedFrom } : {}),
  }
}

/** Public plan catalog for the desktop upgrade screen. */
export function publicPlanCatalog() {
  return Object.values(DEFAULT_PLANS).map((plan) => ({
    plan_id: plan.planId,
    name: plan.name,
    capabilities: plan.capabilities,
    features: plan.features,
    requests_per_period: plan.requestsPerPeriod,
    rate_limit_per_minute: plan.rateLimitPerMinute,
  }))
}
