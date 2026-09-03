import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { aiBody, call, errorCode, resetPlatform, signUp, stubBedrock } from './helpers.mjs'
import { signManualWebhook } from '../dist/domain/billing.js'
import { getSubscription, upsertSubscription } from '../dist/data/subscriptions.js'

const SECRET = process.env.BILLING_WEBHOOK_SECRET

const send = (payload) => {
  const raw = JSON.stringify(payload)
  return call('POST', '/billing/webhook', {
    body: raw,
    headers: { 'x-signature': signManualWebhook(raw, SECRET) },
  })
}

/** Binds a billing customer to an account, as a checkout flow would. */
async function linkCustomer(userId, customerId) {
  await upsertSubscription(userId, { providerCustomerId: customerId })
}

describe('billing webhooks', () => {
  beforeEach(resetPlatform)

  it('rejects an unsigned or wrongly-signed webhook', async () => {
    const unsigned = await call('POST', '/billing/webhook', {
      body: { event_id: 'evt_1', type: 'payment.succeeded', customer_id: 'cus_1' },
    })
    assert.equal(errorCode(unsigned), 'AUTHENTICATION_REQUIRED')

    const badSignature = await call('POST', '/billing/webhook', {
      body: { event_id: 'evt_1', type: 'payment.succeeded', customer_id: 'cus_1' },
      headers: { 'x-signature': 'deadbeef' },
    })
    assert.equal(errorCode(badSignature), 'AUTHENTICATION_REQUIRED')
  })

  it('upgrades the plan on subscription.created', async () => {
    const session = await signUp()
    await linkCustomer(session.account.user_id, 'cus_100')

    const response = await send({
      event_id: 'evt_created',
      type: 'subscription.created',
      customer_id: 'cus_100',
      subscription_id: 'sub_1',
      plan_id: 'pro',
      status: 'active',
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.applied, true)

    const account = await call('GET', '/account', { token: session.access_token })
    assert.equal(account.body.entitlements.planId, 'pro')
  })

  it('ignores a redelivered event', async () => {
    const session = await signUp()
    await linkCustomer(session.account.user_id, 'cus_200')

    const payload = {
      event_id: 'evt_dupe',
      type: 'subscription.created',
      customer_id: 'cus_200',
      plan_id: 'pro',
      status: 'active',
    }
    const first = await send(payload)
    const second = await send(payload)

    assert.equal(first.body.applied, true)
    assert.equal(second.body.applied, false, 'redelivery must be idempotent')
    assert.equal(second.status, 200, 'a duplicate is not an error worth retrying')
  })

  it('starts a grace period on payment failure rather than cutting access', async () => {
    const session = await signUp()
    await linkCustomer(session.account.user_id, 'cus_300')
    await send({
      event_id: 'evt_a',
      type: 'subscription.created',
      customer_id: 'cus_300',
      plan_id: 'pro',
      status: 'active',
    })

    await send({ event_id: 'evt_b', type: 'payment.failed', customer_id: 'cus_300' })

    const subscription = await getSubscription(session.account.user_id)
    assert.equal(subscription.status, 'past_due')
    assert.ok(new Date(subscription.gracePeriodEndsAt) > new Date())

    const account = await call('GET', '/account', { token: session.access_token })
    assert.equal(account.body.entitlements.planId, 'pro', 'access survives the first failed charge')
  })

  it('restores the plan when payment later succeeds', async () => {
    const session = await signUp()
    await linkCustomer(session.account.user_id, 'cus_400')
    await send({
      event_id: 'evt_a',
      type: 'subscription.created',
      customer_id: 'cus_400',
      plan_id: 'pro',
      status: 'active',
    })
    await send({ event_id: 'evt_b', type: 'payment.failed', customer_id: 'cus_400' })
    await send({ event_id: 'evt_c', type: 'payment.succeeded', customer_id: 'cus_400' })

    const subscription = await getSubscription(session.account.user_id)
    assert.equal(subscription.status, 'active')
    assert.equal(subscription.gracePeriodEndsAt, undefined)
  })

  it('drops a user to free capabilities after cancellation', async () => {
    stubBedrock()
    const session = await signUp()
    await linkCustomer(session.account.user_id, 'cus_500')
    await send({
      event_id: 'evt_a',
      type: 'subscription.created',
      customer_id: 'cus_500',
      plan_id: 'premium',
      status: 'active',
    })

    const beforeCancel = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({ capability: 'resume_generation' }),
    })
    assert.equal(beforeCancel.status, 200)

    await send({ event_id: 'evt_b', type: 'subscription.canceled', customer_id: 'cus_500' })

    const afterCancel = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({ capability: 'resume_generation' }),
    })
    assert.equal(errorCode(afterCancel), 'AI_ACCESS_DENIED')
  })

  it('accepts an event for an unknown customer without failing the provider', async () => {
    const response = await send({
      event_id: 'evt_orphan',
      type: 'payment.succeeded',
      customer_id: 'cus_unknown',
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.applied, false)
  })
})

describe('client cannot assert its own plan', () => {
  beforeEach(resetPlatform)

  it('ignores plan and usage claims in the request body', async () => {
    stubBedrock()
    const session = await signUp()

    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({
        capability: 'resume_generation',
        metadata: { plan_id: 'enterprise', requests_remaining: 999_999, entitlements: ['all'] },
      }),
    })

    // The account is on free, so the forged metadata changes nothing.
    assert.equal(errorCode(response), 'AI_ACCESS_DENIED')
  })
})
