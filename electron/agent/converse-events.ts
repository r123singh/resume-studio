/**
 * Translation between Bedrock Converse shapes and Strands shapes.
 *
 * Deliberately free of imports so the translation can be unit tested in
 * isolation. This is the load-bearing piece of the managed provider: if the
 * mapping drifts, streaming and tool calling break silently rather than loudly,
 * so it is kept small, pure, and covered by tests.
 */

export type StreamEvent = Record<string, unknown>

/** Bedrock stop reasons are snake_case; Strands expects camelCase. */
const STOP_REASONS: Record<string, string> = {
  end_turn: 'endTurn',
  tool_use: 'toolUse',
  max_tokens: 'maxTokens',
  stop_sequence: 'stopSequence',
  content_filtered: 'contentFiltered',
  guardrail_intervened: 'guardrailIntervened',
}

export const toStrandsStopReason = (reason: unknown): string =>
  STOP_REASONS[String(reason ?? 'end_turn')] ?? 'endTurn'

/**
 * Converts Strands message content into Converse blocks.
 *
 * Blocks arrive either as class instances (carrying a `type` discriminator) or
 * as plain data objects, depending on how the agent assembled its history, so
 * both shapes are accepted.
 */
export function toConverseContent(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) return []
  const blocks: Record<string, unknown>[] = []

  for (const raw of content) {
    const block = raw as Record<string, unknown>
    if (!block) continue

    const type = block.type as string | undefined

    if (type === 'textBlock' || (!type && typeof block.text === 'string')) {
      const text = String(block.text ?? '')
      if (text) blocks.push({ text })
      continue
    }

    if (type === 'toolUseBlock' || block.toolUse) {
      const source = (block.toolUse ?? block) as Record<string, unknown>
      blocks.push({
        toolUse: {
          toolUseId: String(source.toolUseId ?? ''),
          name: String(source.name ?? ''),
          input: source.input ?? {},
        },
      })
      continue
    }

    if (type === 'toolResultBlock' || block.toolResult) {
      const source = (block.toolResult ?? block) as Record<string, unknown>
      const inner = Array.isArray(source.content) ? source.content : []
      blocks.push({
        toolResult: {
          toolUseId: String(source.toolUseId ?? ''),
          status: source.status === 'error' ? 'error' : 'success',
          content: inner.map((entry) => {
            const item = entry as Record<string, unknown>
            if (typeof item?.text === 'string') return { text: item.text }
            if (item?.json !== undefined) return { json: item.json }
            return { text: JSON.stringify(item ?? {}) }
          }),
        },
      })
      continue
    }

    // Reasoning, cache points, and media blocks carry no meaning for this
    // product's text-only flows and are dropped rather than sent malformed.
  }

  return blocks
}

export type ConverseMessage = { role: 'user' | 'assistant'; content: Record<string, unknown>[] }

export function toConverseMessages(messages: unknown[]): ConverseMessage[] {
  const out: ConverseMessage[] = []
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown }
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const content = toConverseContent(message.content)
    if (content.length) out.push({ role, content })
  }
  return out
}

export function systemPromptText(systemPrompt: unknown): string {
  if (typeof systemPrompt === 'string') return systemPrompt
  if (!Array.isArray(systemPrompt)) return ''
  return systemPrompt
    .map((entry) => {
      const block = entry as { text?: unknown; textBlock?: { text?: unknown } }
      if (typeof block?.text === 'string') return block.text
      if (typeof block?.textBlock?.text === 'string') return block.textBlock.text
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Maps one backend stream event to its Strands equivalent.
 *
 * Returns null for events with no Strands counterpart; callers drop those.
 */
export function toStrandsEvent(event: StreamEvent): StreamEvent | null {
  switch (event.type) {
    case 'messageStart':
      return { type: 'modelMessageStartEvent', role: event.role ?? 'assistant' }

    case 'contentBlockStart': {
      const start = event.start as { toolUse?: { toolUseId?: string; name?: string } } | undefined
      if (start?.toolUse) {
        return {
          type: 'modelContentBlockStartEvent',
          contentBlockIndex: event.contentBlockIndex ?? 0,
          start: {
            type: 'toolUseStart',
            name: String(start.toolUse.name ?? ''),
            toolUseId: String(start.toolUse.toolUseId ?? ''),
          },
        }
      }
      return {
        type: 'modelContentBlockStartEvent',
        contentBlockIndex: event.contentBlockIndex ?? 0,
      }
    }

    case 'contentBlockDelta': {
      const delta = event.delta as { text?: string; toolUse?: { input?: string } } | undefined
      if (typeof delta?.text === 'string') {
        return {
          type: 'modelContentBlockDeltaEvent',
          contentBlockIndex: event.contentBlockIndex ?? 0,
          delta: { type: 'textDelta', text: delta.text },
        }
      }
      if (delta?.toolUse && typeof delta.toolUse.input === 'string') {
        return {
          type: 'modelContentBlockDeltaEvent',
          contentBlockIndex: event.contentBlockIndex ?? 0,
          delta: { type: 'toolUseInputDelta', input: delta.toolUse.input },
        }
      }
      return null
    }

    case 'contentBlockStop':
      return {
        type: 'modelContentBlockStopEvent',
        contentBlockIndex: event.contentBlockIndex ?? 0,
      }

    case 'messageStop':
      return {
        type: 'modelMessageStopEvent',
        stopReason: toStrandsStopReason(event.stopReason),
      }

    case 'metadata': {
      const usage = (event.usage ?? {}) as { inputTokens?: number; outputTokens?: number }
      const inputTokens = usage.inputTokens ?? 0
      const outputTokens = usage.outputTokens ?? 0
      return {
        type: 'modelMetadataEvent',
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      }
    }

    default:
      // `platformDone` and `platformError` are control-plane framing handled by
      // the caller, not model events.
      return null
  }
}
