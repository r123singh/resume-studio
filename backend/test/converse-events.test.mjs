/**
 * Desktop-side event translation.
 *
 * This lives in the backend suite because it is the other half of the same
 * contract: the backend flattens Converse events, and the desktop maps them to
 * Strands events. Testing both together is what stops the two sides drifting.
 *
 * The module is import-free by design, so it can be transpiled and loaded
 * directly rather than requiring the Electron build.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const source = readFileSync(
  new URL('../../electron/agent/converse-events.ts', import.meta.url),
  'utf8',
)
const { code } = transformSync(source, { loader: 'ts', format: 'esm' })
const { toStrandsEvent, toConverseMessages, toConverseContent, systemPromptText, toStrandsStopReason } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

describe('Converse to Strands event mapping', () => {
  it('maps a message start', () => {
    assert.deepEqual(toStrandsEvent({ type: 'messageStart', role: 'assistant' }), {
      type: 'modelMessageStartEvent',
      role: 'assistant',
    })
  })

  it('maps a text delta, which is what makes streaming visible', () => {
    assert.deepEqual(
      toStrandsEvent({ type: 'contentBlockDelta', contentBlockIndex: 0, delta: { text: 'Hi' } }),
      {
        type: 'modelContentBlockDeltaEvent',
        contentBlockIndex: 0,
        delta: { type: 'textDelta', text: 'Hi' },
      },
    )
  })

  it('maps a tool use start, which is what makes the agent loop work', () => {
    assert.deepEqual(
      toStrandsEvent({
        type: 'contentBlockStart',
        contentBlockIndex: 1,
        start: { toolUse: { toolUseId: 'tu-1', name: 'read_file' } },
      }),
      {
        type: 'modelContentBlockStartEvent',
        contentBlockIndex: 1,
        start: { type: 'toolUseStart', name: 'read_file', toolUseId: 'tu-1' },
      },
    )
  })

  it('maps partial tool input JSON', () => {
    assert.deepEqual(
      toStrandsEvent({
        type: 'contentBlockDelta',
        contentBlockIndex: 1,
        delta: { toolUse: { input: '{"path":' } },
      }),
      {
        type: 'modelContentBlockDeltaEvent',
        contentBlockIndex: 1,
        delta: { type: 'toolUseInputDelta', input: '{"path":' },
      },
    )
  })

  it('converts stop reasons to the casing Strands expects', () => {
    assert.equal(toStrandsStopReason('tool_use'), 'toolUse')
    assert.equal(toStrandsStopReason('end_turn'), 'endTurn')
    assert.equal(toStrandsStopReason('max_tokens'), 'maxTokens')
    assert.equal(toStrandsStopReason(undefined), 'endTurn')
    assert.equal(toStrandsStopReason('something_new'), 'endTurn')
  })

  it('totals usage on metadata events', () => {
    assert.deepEqual(
      toStrandsEvent({ type: 'metadata', usage: { inputTokens: 10, outputTokens: 4 } }),
      {
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      },
    )
  })

  it('drops control-plane framing and unknown events', () => {
    assert.equal(toStrandsEvent({ type: 'platformDone' }), null)
    assert.equal(toStrandsEvent({ type: 'somethingElse' }), null)
    assert.equal(toStrandsEvent({ type: 'contentBlockDelta', delta: { reasoning: 'x' } }), null)
  })
})

describe('Strands to Converse message conversion', () => {
  it('handles class-style and plain text blocks alike', () => {
    assert.deepEqual(toConverseContent([{ type: 'textBlock', text: 'a' }, { text: 'b' }]), [
      { text: 'a' },
      { text: 'b' },
    ])
  })

  it('preserves tool use and tool result round trips', () => {
    const blocks = toConverseContent([
      { type: 'toolUseBlock', toolUseId: 'tu-1', name: 'read_file', input: { path: 'a.md' } },
      {
        type: 'toolResultBlock',
        toolUseId: 'tu-1',
        status: 'success',
        content: [{ text: '# Resume' }],
      },
    ])

    assert.deepEqual(blocks[0], {
      toolUse: { toolUseId: 'tu-1', name: 'read_file', input: { path: 'a.md' } },
    })
    assert.deepEqual(blocks[1], {
      toolResult: { toolUseId: 'tu-1', status: 'success', content: [{ text: '# Resume' }] },
    })
  })

  it('drops empty text and unsupported block types', () => {
    assert.deepEqual(toConverseContent([{ text: '' }, { type: 'reasoningBlock', text: 'hmm' }]), [])
    assert.deepEqual(toConverseContent(null), [])
  })

  it('drops messages that carry no usable content', () => {
    const messages = toConverseMessages([
      { role: 'user', content: [{ text: 'hello' }] },
      { role: 'assistant', content: [] },
    ])
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role, 'user')
  })

  it('coerces unknown roles to user rather than sending them through', () => {
    const messages = toConverseMessages([{ role: 'system', content: [{ text: 'be nice' }] }])
    assert.equal(messages[0].role, 'user')
  })

  it('flattens system prompts from either supported shape', () => {
    assert.equal(systemPromptText('plain'), 'plain')
    assert.equal(systemPromptText([{ text: 'a' }, { textBlock: { text: 'b' } }]), 'a\n\nb')
    assert.equal(systemPromptText(undefined), '')
  })
})
