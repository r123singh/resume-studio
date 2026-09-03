import { ok, type HttpRequest, type HttpResponse } from '../lib/http.js'
import { authenticateRequest } from '../domain/authorize.js'
import { getSubscription, usagePeriod } from '../data/subscriptions.js'
import { effectivePlan, publicPlanCatalog, resolveEntitlements } from '../domain/entitlements.js'
import { getUsageCounter, listRecentRequests } from '../data/usage.js'
import { getFlags } from '../data/catalog.js'

/** Everything the desktop needs to render account state in one call. */
export async function account(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const subscription = await getSubscription(principal.userId)
  const period = usagePeriod(subscription)
  const counter = await getUsageCounter(principal.userId, period)
  const entitlements = await resolveEntitlements(principal.userId, subscription, counter)
  const flags = await getFlags()

  return ok({
    account: {
      user_id: principal.user.userId,
      email: principal.user.email,
      status: principal.user.status,
      created_at: principal.user.createdAt,
    },
    subscription: serializeSubscription(subscription),
    entitlements,
    usage: serializeUsage(counter),
    feature_flags: flags,
  })
}

export async function entitlements(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const subscription = await getSubscription(principal.userId)
  return ok({ entitlements: await resolveEntitlements(principal.userId, subscription) })
}

export async function subscription(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const record = await getSubscription(principal.userId)
  return ok({ subscription: serializeSubscription(record), plans: publicPlanCatalog() })
}

export async function usage(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const record = await getSubscription(principal.userId)
  const period = usagePeriod(record)
  const counter = await getUsageCounter(principal.userId, period)
  const recent = await listRecentRequests(principal.userId, 25)

  return ok({
    usage: serializeUsage(counter),
    period: { start: record.currentPeriodStart, end: record.currentPeriodEnd },
    recent_requests: recent.map((entry) => ({
      request_id: entry.requestId,
      capability: entry.capability,
      model: entry.modelKey,
      status: entry.status,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      latency_ms: entry.latencyMs,
      created_at: entry.createdAt,
      ...(entry.failureReason ? { failure_reason: entry.failureReason } : {}),
    })),
  })
}

/**
 * Logical capabilities available to the caller.
 *
 * Concrete Bedrock model IDs are deliberately omitted: the client picks a
 * capability, the backend picks the model.
 */
export async function models(req: HttpRequest): Promise<HttpResponse> {
  const principal = await authenticateRequest(req)
  const record = await getSubscription(principal.userId)
  const { plan } = await effectivePlan(record)

  return ok({
    capabilities: plan.capabilities.map((capability) => ({
      capability,
      available: true,
    })),
    plan: { plan_id: plan.planId, name: plan.name, max_tier: plan.maxTier },
  })
}

function serializeSubscription(record: Awaited<ReturnType<typeof getSubscription>>) {
  return {
    plan_id: record.planId,
    status: record.status,
    current_period_start: record.currentPeriodStart,
    current_period_end: record.currentPeriodEnd,
    cancel_at_period_end: record.cancelAtPeriodEnd,
    ...(record.gracePeriodEndsAt ? { grace_period_ends_at: record.gracePeriodEndsAt } : {}),
  }
}

function serializeUsage(counter: Awaited<ReturnType<typeof getUsageCounter>>) {
  return {
    period: counter.period,
    requests: counter.requests,
    input_tokens: counter.inputTokens,
    output_tokens: counter.outputTokens,
    // Cost is reported for transparency but is never used for client-side
    // decisions; the backend owns all pricing logic.
    estimated_cost_usd: Number((counter.estimatedCostMicroUsd / 1_000_000).toFixed(4)),
  }
}
