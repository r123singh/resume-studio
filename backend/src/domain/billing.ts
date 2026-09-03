/**
 * Billing provider abstraction.
 *
 * The AI layer must not know who processes payments, so providers implement a
 * narrow interface: verify a webhook signature, and normalise the payload into
 * a provider-neutral event. Swapping Stripe for anything else is one new file.
 *
 * A `manual` provider ships by default so the platform runs end-to-end — and is
 * testable — without a payment account.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { store, type Item } from '../data/store.js'
import { badRequest, unauthorized } from '../lib/errors.js'
import { config, loadSecrets } from '../lib/config.js'
import { isPlanId, type PlanId } from '../data/catalog.js'
import {
  findByBillingCustomer,
  upsertSubscription,
  type SubscriptionStatus,
} from '../data/subscriptions.js'
import type { Logger } from '../lib/log.js'

export type BillingEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'payment.succeeded'
  | 'payment.failed'

export type NormalizedBillingEvent = {
  /** Provider event ID; used to de-duplicate redelivered webhooks. */
  eventId: string
  type: BillingEventType
  customerId: string
  subscriptionId?: string
  planId?: PlanId
  status?: SubscriptionStatus
  currentPeriodStart?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd?: boolean
  /** Direct account binding, used by the first event for a new customer. */
  userId?: string
}

export interface BillingProvider {
  readonly name: string
  verifyWebhook(rawBody: string, headers: Record<string, string>, secret: string): void
  parseEvent(rawBody: string): NormalizedBillingEvent
}

/**
 * Signature-verified generic provider.
 *
 * The payload is already in normalized form, which is what makes it usable for
 * an internal admin tool, a self-serve trial, or integration tests before a
 * real processor is wired up.
 */
class ManualBillingProvider implements BillingProvider {
  readonly name = 'manual'

  verifyWebhook(rawBody: string, headers: Record<string, string>, secret: string): void {
    if (!secret) throw unauthorized('Billing webhook secret is not configured.')
    const presented = headers['x-signature'] || headers['X-Signature'] || ''
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(presented)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw unauthorized('Invalid webhook signature.')
    }
  }

  parseEvent(rawBody: string): NormalizedBillingEvent {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody)
    } catch {
      throw badRequest('Webhook body must be valid JSON.')
    }

    const eventId = String(payload.event_id || '')
    const type = String(payload.type || '') as BillingEventType
    const customerId = String(payload.customer_id || '')
    if (!eventId || !type || !customerId) {
      throw badRequest('Webhook is missing event_id, type, or customer_id.')
    }

    const planId = payload.plan_id
    return {
      eventId,
      type,
      customerId,
      ...(payload.subscription_id ? { subscriptionId: String(payload.subscription_id) } : {}),
      ...(isPlanId(planId) ? { planId } : {}),
      ...(payload.status ? { status: payload.status as SubscriptionStatus } : {}),
      ...(payload.current_period_start
        ? { currentPeriodStart: String(payload.current_period_start) }
        : {}),
      ...(payload.current_period_end
        ? { currentPeriodEnd: String(payload.current_period_end) }
        : {}),
      ...(payload.cancel_at_period_end !== undefined
        ? { cancelAtPeriodEnd: Boolean(payload.cancel_at_period_end) }
        : {}),
      ...(payload.user_id ? { userId: String(payload.user_id) } : {}),
    }
  }
}

export function billingProvider(): BillingProvider {
  switch (config.billingProvider) {
    case 'manual':
    default:
      return new ManualBillingProvider()
  }
}

/** Signs a manual-provider payload. Used by tests and the admin CLI. */
export function signManualWebhook(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

const GRACE_PERIOD_DAYS = 7

/**
 * Applies a billing event to the subscription of record.
 *
 * Redelivery is expected from every payment provider, so events are recorded
 * by ID first and duplicates are dropped before anything is mutated.
 */
export async function applyBillingEvent(
  event: NormalizedBillingEvent,
  log: Logger,
): Promise<{ applied: boolean; userId?: string }> {
  const eventKey = { pk: `BILLING#${event.eventId}`, sk: 'EVENT' }
  const isNew = await store().put(
    {
      ...eventKey,
      entity: 'billingEvent',
      eventId: event.eventId,
      type: event.type,
      customerId: event.customerId,
      receivedAt: new Date().toISOString(),
    } as Item,
    { ifNotExists: true },
  )
  if (!isNew) {
    log.info('billing.event.duplicate', { eventId: event.eventId, type: event.type })
    return { applied: false }
  }

  const existing = await findByBillingCustomer(event.customerId)
  const userId = existing?.userId ?? event.userId
  if (!userId) {
    log.warn('billing.event.unmatched', { eventId: event.eventId, type: event.type })
    return { applied: false }
  }

  const changes: Parameters<typeof upsertSubscription>[1] = {
    billingProvider: config.billingProvider,
    providerCustomerId: event.customerId,
    ...(event.subscriptionId ? { providerSubscriptionId: event.subscriptionId } : {}),
    ...(event.planId ? { planId: event.planId } : {}),
    ...(event.currentPeriodStart ? { currentPeriodStart: event.currentPeriodStart } : {}),
    ...(event.currentPeriodEnd ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
    ...(event.cancelAtPeriodEnd !== undefined
      ? { cancelAtPeriodEnd: event.cancelAtPeriodEnd }
      : {}),
  }

  switch (event.type) {
    case 'subscription.created':
    case 'subscription.updated':
      changes.status = event.status ?? 'active'
      if (changes.status !== 'past_due') changes.gracePeriodEndsAt = undefined
      break
    case 'payment.succeeded':
      changes.status = 'active'
      changes.gracePeriodEndsAt = undefined
      break
    case 'payment.failed':
      // Access is retained through the grace window rather than cut off at the
      // first failed charge, which is nearly always a card that needs renewing.
      changes.status = 'past_due'
      changes.gracePeriodEndsAt = new Date(
        Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString()
      break
    case 'subscription.canceled':
      changes.status = 'canceled'
      changes.cancelAtPeriodEnd = false
      break
    default:
      log.warn('billing.event.unhandled', { type: event.type })
      return { applied: false, userId }
  }

  await upsertSubscription(userId, changes)
  log.info('billing.event.applied', {
    eventId: event.eventId,
    type: event.type,
    userId,
    status: changes.status,
  })
  return { applied: true, userId }
}

export async function webhookSecret(): Promise<string> {
  const { billingWebhookSecret } = await loadSecrets()
  return billingWebhookSecret
}
