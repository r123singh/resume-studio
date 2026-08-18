import type { Model } from '@strands-agents/sdk'
import type { ChatMessage, ProviderId } from './types'

export type { ProviderId }

/** Providers that can drive a tool-using agent loop. */
export const AGENTIC_PROVIDERS: ProviderId[] = ['bedrock', 'openai', 'nvidia', 'anthropic', 'gemini']

export type ModelSpec = {
  provider: ProviderId
  model: string
  apiKey: string
  /** Bedrock only. */
  region?: string
  temperature?: number
  maxTokens?: number
  /** Cursor runs its agent against a working directory. */
  workspace?: string | null
}

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'

/**
 * Builds a Strands `Model` for the configured provider.
 *
 * NVIDIA NIM is OpenAI wire-compatible, so it rides the OpenAI provider with a
 * custom baseURL rather than needing a bespoke implementation. That keeps the
 * app's free default working after the move to Strands.
 */
export async function createModel(spec: ModelSpec): Promise<Model> {
  const { provider, model, apiKey, temperature = 0.3, maxTokens = 4096 } = spec

  if (provider === 'bedrock') {
    const { BedrockModel } = await import('@strands-agents/sdk')
    return new BedrockModel({
      modelId: model,
      region: spec.region || process.env.AWS_REGION || 'us-east-1',
      temperature,
      maxTokens,
      // An explicit key uses Bedrock bearer auth; otherwise fall back to the
      // standard AWS credential chain (profile, env, SSO, instance role).
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    }) as unknown as Model
  }

  if (provider === 'nvidia' || provider === 'openai') {
    const { OpenAIModel } = await import('@strands-agents/sdk/models/openai')
    if (!apiKey.trim()) {
      throw new Error(`Missing API key for ${provider}. Open Settings to add one.`)
    }
    return new OpenAIModel({
      api: 'chat',
      modelId: model,
      apiKey: apiKey.trim(),
      temperature,
      maxTokens,
      ...(provider === 'nvidia'
        ? { clientConfig: { baseURL: NVIDIA_BASE_URL, apiKey: apiKey.trim() } }
        : {}),
    }) as unknown as Model
  }

  if (provider === 'anthropic') {
    const { AnthropicModel } = await import('@strands-agents/sdk/models/anthropic')
    if (!apiKey.trim()) throw new Error('Missing API key for anthropic. Open Settings to add one.')
    return new AnthropicModel({
      modelId: model,
      apiKey: apiKey.trim(),
      temperature,
      maxTokens,
    }) as unknown as Model
  }

  if (provider === 'gemini') {
    const { GoogleModel } = await import('@strands-agents/sdk/models/google')
    if (!apiKey.trim()) throw new Error('Missing API key for gemini. Open Settings to add one.')
    return new GoogleModel({
      modelId: model,
      apiKey: apiKey.trim(),
      temperature,
      maxTokens,
    }) as unknown as Model
  }

  return createCursorModel(spec)
}

/**
 * Cursor has no Strands provider, so wrap `Agent.prompt` in the Model contract.
 *
 * The Cursor SDK returns a finished string rather than a token stream and has no
 * tool-call channel, so this emits the whole response as one delta and cannot
 * participate in an agentic tool loop — callers must gate on
 * {@link supportsToolLoop} before offering agent mode.
 */
async function createCursorModel(spec: ModelSpec): Promise<Model> {
  const sdk = await import('@strands-agents/sdk')
  const { Model: StrandsModel } = sdk

  type StreamEvent = Record<string, unknown>

  class CursorModel extends (StrandsModel as unknown as new () => Model) {
    private config = { modelId: spec.model, temperature: spec.temperature ?? 0.3 }

    updateConfig(next: Record<string, unknown>) {
      this.config = { ...this.config, ...next }
    }

    getConfig() {
      return this.config
    }

    async *stream(messages: unknown[]): AsyncIterable<never> {
      const text = await runCursorPrompt({
        apiKey: spec.apiKey,
        model: spec.model,
        messages: toChatMessages(messages),
        workspace: spec.workspace ?? null,
      })

      const emit = (event: StreamEvent) => event as never

      yield emit({ type: 'modelMessageStartEvent', role: 'assistant' })
      yield emit({ type: 'modelContentBlockStartEvent', contentBlockIndex: 0 })
      yield emit({
        type: 'modelContentBlockDeltaEvent',
        contentBlockIndex: 0,
        delta: { type: 'textDelta', text },
      })
      yield emit({ type: 'modelContentBlockStopEvent', contentBlockIndex: 0 })
      yield emit({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    }
  }

  return new CursorModel() as unknown as Model
}

/** Flatten Strands message content blocks back into plain chat messages. */
function toChatMessages(messages: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const raw of messages) {
    const m = raw as { role?: string; content?: unknown }
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user'
    const blocks = Array.isArray(m.content) ? m.content : []
    const text = blocks
      .map((b) => {
        const block = b as { type?: string; text?: string }
        return block?.type === 'textBlock' || typeof block?.text === 'string' ? block.text || '' : ''
      })
      .filter(Boolean)
      .join('\n')
    if (text) out.push({ role, content: text })
  }
  return out
}

async function runCursorPrompt(args: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  workspace: string | null
}): Promise<string> {
  let CursorAgent: typeof import('@cursor/sdk').Agent
  try {
    ;({ Agent: CursorAgent } = await import('@cursor/sdk'))
  } catch {
    throw new Error(
      'Cursor SDK is not installed. Run: npm install @cursor/sdk — then restart Resume Studio.',
    )
  }

  const system = args.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const rest = args.messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join('\n\n')

  const prompt = `${system ? `${system}\n\n` : ''}${rest}

IMPORTANT:
- Return ONLY the final text response for the user (markdown/JSON as requested).
- Do not edit, create, or delete any files.
- Do not run shell commands.
- Do not explore the codebase.`

  const result = await CursorAgent.prompt(prompt, {
    apiKey: args.apiKey,
    model: { id: args.model || 'composer-2.5' },
    ...(args.workspace ? { local: { cwd: args.workspace } } : {}),
  })
  if (result.status === 'error') {
    throw new Error(`Cursor agent run failed (${result.id || 'unknown'})`)
  }
  return String(result.result || '').trim()
}

/** Cursor cannot emit tool calls, so it stays in single-shot mode. */
export function supportsToolLoop(provider: ProviderId): boolean {
  return provider !== 'cursor'
}
