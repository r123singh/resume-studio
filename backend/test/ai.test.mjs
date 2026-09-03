import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { aiBody, call, errorCode, failBedrock, resetPlatform, signUp, stubBedrock } from './helpers.mjs'
import { upsertSubscription } from '../dist/data/subscriptions.js'
import { getUsageCounter, listRecentRequests } from '../dist/data/usage.js'
import { aiStream } from '../dist/handlers/ai.js'
import { Logger } from '../dist/lib/log.js'

const silent = new Logger()
for (const level of ['debug', 'info', 'warn', 'error']) silent[level] = () => {}
silent.metric = () => {}
silent.child = () => silent

const streamRequest = (token, body) => ({
  method: 'POST',
  path: '/ai/stream',
  headers: { authorization: `Bearer ${token}` },
  query: {},
  rawBody: JSON.stringify(body),
  requestId: randomUUID(),
  sourceIp: '127.0.0.1',
  log: silent,
})

describe('AI request validation', () => {
  beforeEach(resetPlatform)

  it('rejects an unknown capability', async () => {
    stubBedrock()
    const session = await signUp()
    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({ capability: 'delete_everything' }),
    })
    assert.equal(errorCode(response), 'INVALID_REQUEST')
  })

  it('rejects an empty message list', async () => {
    stubBedrock()
    const session = await signUp()
    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({ messages: [] }),
    })
    assert.equal(errorCode(response), 'INVALID_REQUEST')
  })

  it('rejects an oversized payload before doing any work', async () => {
    const calls = stubBedrock()
    const session = await signUp()
    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({
        messages: [{ role: 'user', content: [{ text: 'x'.repeat(600_000) }] }],
      }),
    })
    assert.equal(errorCode(response), 'INVALID_REQUEST')
    assert.equal(calls.length, 0, 'an oversized request must never reach the model')
  })

  it('requires authentication', async () => {
    stubBedrock()
    const response = await call('POST', '/ai/request', { body: aiBody() })
    assert.equal(errorCode(response), 'AUTHENTICATION_REQUIRED')
  })
})

describe('usage metering', () => {
  beforeEach(resetPlatform)

  it('records Bedrock-reported tokens rather than anything the client claims', async () => {
    stubBedrock({ inputTokens: 812, outputTokens: 240 })
    const session = await signUp()

    await call('POST', '/ai/request', {
      token: session.access_token,
      // A client-supplied usage figure must be ignored entirely.
      body: aiBody({ metadata: { usage: { input_tokens: 1, output_tokens: 1 } } }),
    })

    const usage = await call('GET', '/usage', { token: session.access_token })
    assert.equal(usage.body.usage.requests, 1)
    assert.equal(usage.body.usage.input_tokens, 812)
    assert.equal(usage.body.usage.output_tokens, 240)
  })

  it('writes an auditable record per request', async () => {
    stubBedrock({ inputTokens: 10, outputTokens: 5 })
    const session = await signUp()
    await call('POST', '/ai/request', { token: session.access_token, body: aiBody() })

    const records = await listRecentRequests(session.account.user_id)
    assert.equal(records.length, 1)
    assert.equal(records[0].status, 'succeeded')
    assert.equal(records[0].capability, 'resume_edit')
    assert.ok(records[0].estimatedCostMicroUsd > 0)
    assert.ok(records[0].modelId, 'the record keeps the concrete model for auditing')
  })

  it('does not double-count a retried request id', async () => {
    stubBedrock({ inputTokens: 100, outputTokens: 50 })
    const session = await signUp()
    const body = aiBody()

    const first = await call('POST', '/ai/request', { token: session.access_token, body })
    const retry = await call('POST', '/ai/request', { token: session.access_token, body })

    assert.equal(first.status, 200)
    assert.equal(errorCode(retry), 'CONFLICT')

    const counter = await getUsageCounter(session.account.user_id, first.body.entitlement.period_end.slice(0, 7))
    const usage = await call('GET', '/usage', { token: session.access_token })
    assert.equal(usage.body.usage.requests, 1, 'a retry must not bill twice')
    assert.ok(counter.requests <= 1)
  })

  it('reports remaining quota that decreases as requests are made', async () => {
    stubBedrock()
    const session = await signUp()

    const first = await call('POST', '/ai/request', { token: session.access_token, body: aiBody() })
    const second = await call('POST', '/ai/request', { token: session.access_token, body: aiBody() })

    assert.ok(second.body.entitlement.requests_remaining < first.body.entitlement.requests_remaining)
  })

  it('audits a blocked request without consuming quota', async () => {
    stubBedrock()
    const session = await signUp()

    await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody({ capability: 'resume_generation' }),
    })

    const usage = await call('GET', '/usage', { token: session.access_token })
    assert.equal(usage.body.usage.requests, 0, 'a refused request costs nothing')
    assert.equal(usage.body.recent_requests[0].status, 'blocked')
    assert.equal(usage.body.recent_requests[0].failure_reason, 'AI_ACCESS_DENIED')
  })
})

describe('usage limits and rate limiting', () => {
  beforeEach(resetPlatform)

  it('refuses once the plan request quota is exhausted', async () => {
    stubBedrock({ inputTokens: 1, outputTokens: 1 })
    const session = await signUp()
    // Enterprise rate limits are high enough that the request quota is what bites.
    await upsertSubscription(session.account.user_id, { planId: 'enterprise', status: 'active' })

    const { store } = await import('../dist/data/store.js')
    const { getSubscription, usagePeriod } = await import('../dist/data/subscriptions.js')
    const period = usagePeriod(await getSubscription(session.account.user_id))
    await store().update(`USER#${session.account.user_id}`, `USAGE#${period}`, {
      add: { requests: 100_000 },
    })

    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody(),
    })
    assert.equal(errorCode(response), 'USAGE_LIMIT_REACHED')
    assert.equal(response.status, 429)
  })

  it('rate limits a burst of requests and reports retry-after', async () => {
    stubBedrock({ inputTokens: 1, outputTokens: 1 })
    const session = await signUp() // free plan: 5 requests per minute

    const results = []
    for (let i = 0; i < 7; i++) {
      results.push(await call('POST', '/ai/request', { token: session.access_token, body: aiBody() }))
    }

    const limited = results.filter((r) => errorCode(r) === 'RATE_LIMITED')
    assert.ok(limited.length > 0, 'a burst past the per-minute limit must be throttled')
    assert.ok(Number(limited[0].headers['retry-after']) >= 0)
  })
})

describe('provider failures', () => {
  beforeEach(resetPlatform)

  it('never leaks a raw AWS error to the client', async () => {
    failBedrock(Object.assign(new Error('User arn:aws:iam::123456789012:role/secret denied'), {
      name: 'AccessDeniedException',
    }))
    const session = await signUp()

    const response = await call('POST', '/ai/request', {
      token: session.access_token,
      body: aiBody(),
    })

    assert.equal(errorCode(response), 'MODEL_UNAVAILABLE')
    assert.ok(!JSON.stringify(response.body).includes('123456789012'))
    assert.ok(!JSON.stringify(response.body).includes('arn:aws'))
  })

  it('maps throttling to a retryable error and frees the request id for retry', async () => {
    failBedrock(Object.assign(new Error('slow down'), { name: 'ThrottlingException' }))
    const session = await signUp()
    const body = aiBody()

    const first = await call('POST', '/ai/request', { token: session.access_token, body })
    assert.equal(errorCode(first), 'RATE_LIMITED')

    // A transient failure releases the claim so the same id can be retried.
    stubBedrock({ inputTokens: 5, outputTokens: 5 })
    const retry = await call('POST', '/ai/request', { token: session.access_token, body })
    assert.equal(retry.status, 200)
  })

  it('records a failure without charging tokens', async () => {
    failBedrock(Object.assign(new Error('bad'), { name: 'ValidationException' }))
    const session = await signUp()
    await call('POST', '/ai/request', { token: session.access_token, body: aiBody() })

    const usage = await call('GET', '/usage', { token: session.access_token })
    assert.equal(usage.body.recent_requests[0].status, 'failed')
    assert.equal(usage.body.usage.input_tokens, 0)
  })
})

describe('streaming', () => {
  beforeEach(resetPlatform)

  it('emits Converse events followed by control-plane framing', async () => {
    stubBedrock({ inputTokens: 30, outputTokens: 12, text: 'Streamed answer.' })
    const session = await signUp()

    const events = []
    await aiStream(streamRequest(session.access_token, aiBody()), (payload) => events.push(payload))

    const types = events.map((event) => event.type)
    assert.deepEqual(types.slice(0, 4), [
      'messageStart',
      'contentBlockDelta',
      'contentBlockStop',
      'messageStop',
    ])

    const done = events.at(-1)
    assert.equal(done.type, 'platformDone')
    assert.equal(done.usage.input_tokens, 30)
    assert.equal(done.usage.output_tokens, 12)
    assert.ok(done.entitlement.requests_remaining >= 0)
  })

  it('meters a streamed request like a buffered one', async () => {
    stubBedrock({ inputTokens: 30, outputTokens: 12 })
    const session = await signUp()

    await aiStream(streamRequest(session.access_token, aiBody()), () => {})

    const usage = await call('GET', '/usage', { token: session.access_token })
    assert.equal(usage.body.usage.requests, 1)
    assert.equal(usage.body.usage.output_tokens, 12)
  })

  it('reports a mid-stream failure in band', async () => {
    failBedrock(Object.assign(new Error('boom'), { name: 'InternalServerException' }))
    const session = await signUp()

    const events = []
    await aiStream(streamRequest(session.access_token, aiBody()), (payload) => events.push(payload))

    const error = events.find((event) => event.type === 'platformError')
    assert.ok(error, 'the client must learn about a failure after headers are committed')
    assert.equal(error.code, 'AI_PROVIDER_ERROR')
  })
})

describe('tool calling through the control plane', () => {
  beforeEach(resetPlatform)

  it('forwards tool specs to the model and returns tool-use events', async () => {
    const { setBedrockInvoker } = await import('../dist/domain/bedrock.js')
    let received = null
    setBedrockInvoker({
      async *converseStream(params) {
        received = params
        yield { type: 'messageStart', role: 'assistant' }
        yield {
          type: 'contentBlockStart',
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: 'tu-1', name: 'read_file' } },
        }
        yield {
          type: 'contentBlockDelta',
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"path":"resume.md"}' } },
        }
        yield { type: 'contentBlockStop', contentBlockIndex: 0 }
        yield { type: 'messageStop', stopReason: 'tool_use' }
        return { inputTokens: 40, outputTokens: 20 }
      },
    })

    const session = await signUp()
    await upsertSubscription(session.account.user_id, { planId: 'premium', status: 'active' })

    const events = []
    await aiStream(
      streamRequest(
        session.access_token,
        aiBody({
          capability: 'agent',
          tools: [
            {
              name: 'read_file',
              description: 'Read a workspace file',
              inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
            },
          ],
        }),
      ),
      (payload) => events.push(payload),
    )

    assert.equal(received.tools[0].name, 'read_file')
    assert.equal(events.find((e) => e.type === 'messageStop').stopReason, 'tool_use')
    assert.ok(events.find((e) => e.type === 'contentBlockStart').start.toolUse)
  })
})
