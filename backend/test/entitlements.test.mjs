import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetPlatform, signUp, call, errorCode } from './helpers.mjs'
import { upsertSubscription } from '../dist/data/subscriptions.js'
import { effectivePlan, resolveEntitlements } from '../dist/domain/entitlements.js'
import { routeCapability, estimateCostMicroUsd } from '../dist/domain/router.js'
import { getPlan, MODEL_CATALOG } from '../dist/data/catalog.js'

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const past = () => new Date(Date.now() - 86_400_000).toISOString()

describe('entitlements', () => {
  beforeEach(resetPlatform)

  it('grants the paid plan while the subscription is active', async () => {
    const session = await signUp()
    await upsertSubscription(session.account.user_id, { planId: 'pro', status: 'active' })

    const account = await call('GET', '/account', { token: session.access_token })
    assert.equal(account.body.entitlements.planId, 'pro')
    assert.equal(account.body.entitlements.requestsLimit, 2000)
    assert.ok(account.body.entitlements.capabilities.includes('resume_generation'))
  })

  it('keeps access during the grace period after a failed payment', async () => {
    const session = await signUp()
    await upsertSubscription(session.account.user_id, {
      planId: 'pro',
      status: 'past_due',
      gracePeriodEndsAt: future(),
    })

    const account = await call('GET', '/account', { token: session.access_token })
    assert.equal(account.body.entitlements.planId, 'pro')
    assert.equal(account.body.entitlements.degradedFrom, undefined)
  })

  it('falls back to free once the grace period lapses', async () => {
    const session = await signUp()
    await upsertSubscription(session.account.user_id, {
      planId: 'pro',
      status: 'past_due',
      gracePeriodEndsAt: past(),
    })

    const account = await call('GET', '/account', { token: session.access_token })
    assert.equal(account.body.entitlements.planId, 'free')
    assert.equal(account.body.entitlements.degradedFrom, 'pro')
  })

  it('falls back to free on cancellation rather than removing AI entirely', async () => {
    const session = await signUp()
    await upsertSubscription(session.account.user_id, { planId: 'premium', status: 'canceled' })

    const { plan, degradedFrom } = await effectivePlan(
      await (await import('../dist/data/subscriptions.js')).getSubscription(session.account.user_id),
    )
    assert.equal(plan.planId, 'free')
    assert.equal(degradedFrom, 'premium')
    assert.equal(plan.aiAccess, true)
  })

  it('computes remaining requests from server-side usage', async () => {
    const session = await signUp()
    const { getSubscription } = await import('../dist/data/subscriptions.js')
    const subscription = await getSubscription(session.account.user_id)

    const entitlements = await resolveEntitlements(session.account.user_id, subscription, {
      period: '2026-08',
      requests: 12,
      inputTokens: 500,
      outputTokens: 250,
      estimatedCostMicroUsd: 0,
    })
    assert.equal(entitlements.requestsUsed, 12)
    assert.equal(entitlements.requestsRemaining, entitlements.requestsLimit - 12)
    assert.equal(entitlements.tokensUsed, 750)
  })
})

describe('model routing', () => {
  beforeEach(resetPlatform)

  it('refuses a capability the plan does not include', async () => {
    const free = await getPlan('free')
    await assert.rejects(() => routeCapability('resume_generation', free), (err) => {
      assert.equal(err.code, 'AI_ACCESS_DENIED')
      return true
    })
  })

  it('keeps a free plan on the fast tier even when routing prefers a better model', async () => {
    const free = await getPlan('free')
    const route = await routeCapability('resume_edit', free)
    assert.equal(route.definition.tier, 'fast')
  })

  it('lets a premium plan reach the advanced tier', async () => {
    const premium = await getPlan('premium')
    const route = await routeCapability('resume_generation', premium)
    assert.equal(route.definition.tier, 'advanced')
    assert.ok(route.fallbacks.length >= 1, 'a fallback model should be available')
  })

  it('never returns an AWS model id to the caller', async () => {
    const session = await signUp()
    const models = await call('GET', '/models', { token: session.access_token })
    const serialized = JSON.stringify(models.body)

    assert.ok(!serialized.includes('anthropic.claude'), 'model IDs must stay server-side')
    assert.ok(!serialized.includes('amazon.nova'), 'model IDs must stay server-side')
    assert.ok(models.body.capabilities.some((entry) => entry.capability === 'resume_edit'))
  })

  it('prices from token counts using integer micro-USD', () => {
    const model = MODEL_CATALOG['claude-sonnet']
    // 1,000 in + 1,000 out at 3000/15000 micro-USD per 1K.
    assert.equal(estimateCostMicroUsd(model, 1000, 1000), 18_000)
    assert.equal(estimateCostMicroUsd(model, 0, 0), 0)
  })
})

describe('plan gating end to end', () => {
  beforeEach(resetPlatform)

  it('blocks a free account from a paid-only capability', async () => {
    const { stubBedrock, aiBody } = await import('./helpers.mjs')
    stubBedrock()
    const session = await signUp()

    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({ capability: 'resume_generation' }),
    })
    assert.equal(errorCode(response), 'AI_ACCESS_DENIED')
  })

  it('allows the same capability once the plan is upgraded', async () => {
    const { stubBedrock, aiBody } = await import('./helpers.mjs')
    stubBedrock()
    const session = await signUp()
    await upsertSubscription(session.account.user_id, { planId: 'premium', status: 'active' })

    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({ capability: 'resume_generation' }),
    })
    assert.equal(response.status, 200)
  })
})
