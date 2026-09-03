/**
 * Usage metering, idempotency, and rate limiting.
 *
 * Token counts come from Bedrock's own metadata rather than anything the client
 * reports, so usage is authoritative. Records are immutable and retained for
 * 90 days to support auditing and billing disputes; the per-period counters are
 * atomic increments so concurrent requests cannot lose writes.
 */
import { store, ttlInDays, ttlInSeconds, type Item } from './store.js'
import { config } from '../lib/config.js'
import type { Capability } from './catalog.js'

export type RequestStatus = 'succeeded' | 'failed' | 'blocked'

export type UsageRecord = {
  pk: string
  sk: string
  entity: 'usageRecord'
  userId: string
  requestId: string
  conversationId?: string
  capability: Capability
  modelKey: string
  modelId: string
  planId: string
  period: string
  status: RequestStatus
  failureReason?: string
  inputTokens: number
  outputTokens: number
  /** Micro-USD; integers keep aggregate sums exact. */
  estimatedCostMicroUsd: number
  latencyMs: number
  createdAt: string
}

export type UsageCounter = {
  period: string
  requests: number
  inputTokens: number
  outputTokens: number
  estimatedCostMicroUsd: number
}

const counterKey = (userId: string, period: string) => ({
  pk: `USER#${userId}`,
  sk: `USAGE#${period}`,
})

const recordKey = (userId: string, requestId: string) => ({
  pk: `USER#${userId}`,
  sk: `REQ#${requestId}`,
})

const idempotencyKey = (userId: string, requestId: string) => ({
  pk: `USER#${userId}`,
  sk: `IDEM#${requestId}`,
})

export async function getUsageCounter(userId: string, period: string): Promise<UsageCounter> {
  const k = counterKey(userId, period)
  const row = await store().get<Partial<UsageCounter>>(k.pk, k.sk)
  return {
    period,
    requests: row?.requests ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    estimatedCostMicroUsd: row?.estimatedCostMicroUsd ?? 0,
  }
}

export async function recordUsage(record: Omit<UsageRecord, 'pk' | 'sk' | 'entity'>): Promise<void> {
  const k = recordKey(record.userId, record.requestId)
  await store().put({
    ...k,
    ...record,
    entity: 'usageRecord',
    ttl: ttlInDays(config.usageRecordTtlDays),
  })

  // Blocked requests are audited but do not consume quota: a user turned away
  // by an entitlement check has not cost anything to serve.
  if (record.status === 'blocked') return

  const counter = counterKey(record.userId, record.period)
  await store().update(counter.pk, counter.sk, {
    set: { entity: 'usageCounter', period: record.period, updatedAt: record.createdAt },
    add: {
      requests: 1,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      estimatedCostMicroUsd: record.estimatedCostMicroUsd,
    },
  })
}

export async function listRecentRequests(userId: string, limit = 25): Promise<UsageRecord[]> {
  return store().query<UsageRecord>(`USER#${userId}`, 'REQ#', { limit, descending: true })
}

export type IdempotencyClaim =
  | { claimed: true }
  | { claimed: false; record: UsageRecord | null; inFlight: boolean }

/**
 * Claims a client-supplied request ID.
 *
 * A retried request must not be billed twice, so the first caller wins the
 * claim and later callers are handed the original outcome. An unfinished claim
 * older than five minutes is assumed abandoned and can be retaken, which stops
 * a crashed invocation from permanently blocking a request ID.
 */
export async function claimRequest(userId: string, requestId: string): Promise<IdempotencyClaim> {
  const k = idempotencyKey(userId, requestId)
  const claimed = await store().put(
    {
      ...k,
      entity: 'idempotency',
      userId,
      requestId,
      status: 'in_flight',
      createdAt: new Date().toISOString(),
      ttl: ttlInDays(1),
    },
    { ifNotExists: true },
  )
  if (claimed) return { claimed: true }

  const existing = await store().get<{ status?: string; createdAt?: string }>(k.pk, k.sk)
  const startedAt = existing?.createdAt ? new Date(existing.createdAt).getTime() : 0
  const stale = Date.now() - startedAt > 5 * 60 * 1000

  if (existing?.status === 'in_flight' && !stale) {
    return { claimed: false, record: null, inFlight: true }
  }
  if (existing?.status === 'in_flight' && stale) {
    await store().update(k.pk, k.sk, {
      set: { status: 'in_flight', createdAt: new Date().toISOString() },
    })
    return { claimed: true }
  }

  const rk = recordKey(userId, requestId)
  const record = await store().get<UsageRecord>(rk.pk, rk.sk)
  return { claimed: false, record, inFlight: false }
}

export async function settleRequest(
  userId: string,
  requestId: string,
  status: RequestStatus,
): Promise<void> {
  const k = idempotencyKey(userId, requestId)
  await store().update(k.pk, k.sk, {
    set: { status, settledAt: new Date().toISOString() },
  })
}

/** Releases a claim so a genuinely transient failure can be retried. */
export async function releaseRequest(userId: string, requestId: string): Promise<void> {
  const k = idempotencyKey(userId, requestId)
  await store().delete(k.pk, k.sk)
}

export type RateLimitResult = { allowed: boolean; count: number; retryAfterSeconds: number }

/**
 * Fixed-window per-user rate limit.
 *
 * A sliding window would be more precise, but a fixed window is one atomic
 * counter with a TTL, which is both cheaper and adequate for abuse protection
 * at this scale.
 */
export async function checkRateLimit(
  userId: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  const windowSeconds = 60
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - (now % windowSeconds)
  const k = { pk: `USER#${userId}`, sk: `RATE#${windowStart}` }

  const updated = await store().update(k.pk, k.sk, {
    set: { entity: 'rateWindow', ttl: ttlInSeconds(windowSeconds * 2) },
    add: { count: 1 },
  })
  const count = typeof updated.count === 'number' ? updated.count : 1
  return {
    allowed: count <= limitPerMinute,
    count,
    retryAfterSeconds: windowStart + windowSeconds - now,
  }
}
