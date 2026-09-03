import { store } from './store.js'
import type { PlanId } from './catalog.js'

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'paused'

export type Subscription = {
  pk: string
  sk: string
  /** Set only when a billing customer is linked; drives the GSI lookup. */
  gsi1pk?: string
  gsi1sk?: string
  entity: 'subscription'
  userId: string
  planId: PlanId
  status: SubscriptionStatus
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  /** Set on payment failure; access survives until this passes. */
  gracePeriodEndsAt?: string
  billingProvider?: string
  providerCustomerId?: string
  providerSubscriptionId?: string
  updatedAt: string
}

const key = (userId: string) => ({ pk: `USER#${userId}`, sk: 'SUBSCRIPTION' })

/** Start of the current calendar month, which is the default billing period. */
function monthWindow(from = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

export function freeSubscription(userId: string): Subscription {
  const window = monthWindow()
  return {
    ...key(userId),
    entity: 'subscription',
    userId,
    planId: 'free',
    status: 'active',
    currentPeriodStart: window.start,
    currentPeriodEnd: window.end,
    cancelAtPeriodEnd: false,
    updatedAt: new Date().toISOString(),
  }
}

export async function createFreeSubscription(userId: string): Promise<Subscription> {
  const subscription = freeSubscription(userId)
  await store().put(subscription)
  return subscription
}

/**
 * Every account has a subscription. A missing record resolves to a synthetic
 * free plan rather than an error, so a partially-provisioned account degrades
 * to the free tier instead of losing AI access entirely.
 */
export async function getSubscription(userId: string): Promise<Subscription> {
  const k = key(userId)
  const found = await store().get<Subscription>(k.pk, k.sk)
  if (!found) return freeSubscription(userId)

  // A lapsed period on a live subscription rolls forward so quotas reset even
  // if no webhook arrived. Terminal states are left alone.
  if (
    new Date(found.currentPeriodEnd) <= new Date() &&
    (found.status === 'active' || found.status === 'trialing')
  ) {
    const window = monthWindow()
    return { ...found, currentPeriodStart: window.start, currentPeriodEnd: window.end }
  }
  return found
}

export async function upsertSubscription(
  userId: string,
  changes: Partial<Omit<Subscription, 'pk' | 'sk' | 'userId' | 'entity'>>,
): Promise<Subscription> {
  const k = key(userId)
  const current = await store().get<Subscription>(k.pk, k.sk)
  const base = current ?? freeSubscription(userId)
  const next: Subscription = {
    ...base,
    ...changes,
    ...k,
    entity: 'subscription',
    userId,
    updatedAt: new Date().toISOString(),
  }
  if (next.providerCustomerId) {
    next.gsi1pk = `BILLING#${next.providerCustomerId}`
    next.gsi1sk = 'SUBSCRIPTION'
  }
  await store().put(next)
  return next
}

export async function findByBillingCustomer(
  providerCustomerId: string,
): Promise<Subscription | null> {
  const rows = await store().queryIndex<Subscription>(
    `BILLING#${providerCustomerId}`,
    'SUBSCRIPTION',
  )
  return rows[0] ?? null
}

/** Usage period key, e.g. `2026-08`. Aligns with the billing period start. */
export function usagePeriod(subscription: Subscription): string {
  return subscription.currentPeriodStart.slice(0, 7)
}
