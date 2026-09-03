/**
 * Shared test helpers.
 *
 * Requests are driven through the real router rather than by calling handlers
 * directly, so routing, the error envelope, and authentication are exercised
 * exactly as they are in production.
 */
import { randomUUID } from 'node:crypto'
import { MemoryStore, setStore } from '../dist/data/store.js'
import { resetCatalogCache } from '../dist/data/catalog.js'
import { setBedrockInvoker } from '../dist/domain/bedrock.js'
import { handleRequest } from '../dist/router.js'
import { Logger } from '../dist/lib/log.js'

/** Silences log output so test results stay readable. */
const quietLogger = new Logger()
for (const level of ['debug', 'info', 'warn', 'error']) quietLogger[level] = () => {}
quietLogger.metric = () => {}
quietLogger.child = () => quietLogger

export function resetPlatform() {
  setStore(new MemoryStore())
  resetCatalogCache()
  setBedrockInvoker(null)
}

export async function call(method, path, { body, token, headers = {} } = {}) {
  const response = await handleRequest({
    method,
    path,
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    query: {},
    rawBody: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
    requestId: randomUUID(),
    sourceIp: '127.0.0.1',
    log: quietLogger,
  })
  return response
}

export const errorCode = (response) => response.body?.error?.code

/** Creates an account and returns its tokens. */
export async function signUp(email = `user-${randomUUID()}@example.com`, password = 'correct horse battery') {
  const response = await call('POST', '/auth/signup', {
    body: { email, password, device: { device_id: 'dev-1', device_name: 'Test', platform: 'test' } },
  })
  if (response.status !== 201) {
    throw new Error(`signup failed: ${JSON.stringify(response.body)}`)
  }
  return { ...response.body, email, password }
}

/** Bedrock stub that returns a fixed reply and reports token usage. */
export function stubBedrock({ inputTokens = 100, outputTokens = 50, text = 'Tailored resume.' } = {}) {
  const calls = []
  setBedrockInvoker({
    async converse(params) {
      calls.push(params)
      return {
        content: [{ text }],
        stopReason: 'end_turn',
        usage: { inputTokens, outputTokens },
      }
    },
    async *converseStream(params) {
      calls.push(params)
      yield { type: 'messageStart', role: 'assistant' }
      yield { type: 'contentBlockDelta', contentBlockIndex: 0, delta: { text } }
      yield { type: 'contentBlockStop', contentBlockIndex: 0 }
      yield { type: 'messageStop', stopReason: 'end_turn' }
      return { inputTokens, outputTokens }
    },
  })
  return calls
}

export function failBedrock(error) {
  setBedrockInvoker({
    async converse() {
      throw error
    },
    // eslint-disable-next-line require-yield
    async *converseStream() {
      throw error
    },
  })
}

export const aiBody = (overrides = {}) => ({
  request_id: randomUUID(),
  capability: 'resume_edit',
  messages: [{ role: 'user', content: [{ text: 'Improve my summary.' }] }],
  ...overrides,
})
