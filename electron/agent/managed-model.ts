/**
 * Strands `Model` backed by the AI Backend Control Layer.
 *
 * This is the seam that lets the entire existing product run through the
 * control plane without touching a single prompt, tool, or workflow. Strands'
 * stream event union mirrors Bedrock Converse, and the backend forwards
 * Converse events verbatim, so translation is a rename rather than a
 * reinterpretation — streaming and tool calling survive intact.
 *
 * Nothing here knows an AWS model ID, a price, or a quota. It sends a
 * capability and reads back tokens.
 */
import { randomUUID } from 'node:crypto'
import type { Model } from '@strands-agents/sdk'
import type { ModelSpec } from './models'
import { systemPromptText, toConverseMessages, toStrandsEvent } from './converse-events'
import { PlatformError, streamAi, type AiRequestBody } from '../platform/client'

export type ManagedModelOptions = {
  capability: string
  conversationId?: string
  /** Receives the backend's post-request entitlement snapshot. */
  onEntitlement?: (entitlement: Record<string, unknown>) => void
  clientVersion?: string
}

/**
 * Builds the managed provider model.
 *
 * The Strands `Model` base class is extended dynamically because the SDK is
 * imported lazily throughout this codebase to keep Electron start-up fast.
 */
export async function createManagedModel(
  spec: ModelSpec,
  options: ManagedModelOptions,
): Promise<Model> {
  const sdk = await import('@strands-agents/sdk')
  const { Model: StrandsModel } = sdk

  class ManagedModel extends (StrandsModel as unknown as new () => Model) {
    private config: Record<string, unknown> = {
      // The capability stands in for a model ID, since the client is not told
      // which model serves it.
      modelId: options.capability,
      temperature: spec.temperature ?? 0.3,
      maxTokens: spec.maxTokens ?? 4096,
    }

    updateConfig(next: Record<string, unknown>) {
      this.config = { ...this.config, ...next }
    }

    getConfig() {
      return this.config as never
    }

    async *stream(
      messages: unknown[],
      streamOptions?: { systemPrompt?: unknown; toolSpecs?: unknown[] },
    ): AsyncIterable<never> {
      const system = systemPromptText(streamOptions?.systemPrompt)
      const tools = (streamOptions?.toolSpecs ?? []).map((raw) => {
        const tool = raw as { name?: string; description?: string; inputSchema?: unknown }
        return {
          name: String(tool.name ?? ''),
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? (tool.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
        }
      })

      const body: AiRequestBody = {
        // A fresh ID per model turn: the agent loop makes several calls per
        // user action, and each is separately metered and separately retryable.
        request_id: randomUUID(),
        capability: options.capability,
        messages: toConverseMessages(messages),
        ...(options.conversationId ? { conversation_id: options.conversationId } : {}),
        ...(system ? { system } : {}),
        ...(tools.length ? { tools } : {}),
        params: {
          temperature: Number(this.config.temperature ?? 0.3),
          maxTokens: Number(this.config.maxTokens ?? 4096),
        },
        metadata: {
          client: 'desktop',
          ...(options.clientVersion ? { clientVersion: options.clientVersion } : {}),
        },
      }

      if (!body.messages.length) {
        throw new PlatformError('INVALID_REQUEST', 'There is nothing to send to the model.')
      }

      for await (const event of streamAi(body, spec.signal)) {
        if (event.type === 'platformDone' && event.entitlement) {
          options.onEntitlement?.(event.entitlement as Record<string, unknown>)
          continue
        }
        const mapped = toStrandsEvent(event)
        if (mapped) yield mapped as never
      }
    }
  }

  return new ManagedModel() as unknown as Model
}
