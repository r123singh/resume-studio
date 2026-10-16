import type { Model } from '@strands-agents/sdk'
import type { AiCapability, ProviderId } from './types'
import { PRODUCT_AWS } from '../aws/product'
import { assertProductAwsIdentity } from '../aws/guard'
import { createManagedModel } from './managed-model'

export type { ProviderId }

/**
 * Providers that can drive a tool-using agent loop.
 *
 * `managed` qualifies because the backend proxies Bedrock Converse tool events
 * end to end, so the agent's tool protocol survives the extra hop.
 */
export const AGENTIC_PROVIDERS: ProviderId[] = [
  'managed',
  'bedrock',
  'openai',
  'nvidia',
  'ollama',
  'anthropic',
  'gemini',
]

export type ModelSpec = {
  provider: ProviderId
  model: string
  apiKey: string
  /** Bedrock only. */
  region?: string
  /** IAM Access Key ID from Settings. */
  accessKeyId?: string
  /** IAM Secret Access Key from Settings. */
  secretAccessKey?: string
  /** Named AWS profile. Never `default`. Legacy fallback. */
  profile?: string
  /** When set, credential-chain Bedrock calls must use this account. */
  expectedAccountId?: string
  temperature?: number
  maxTokens?: number
  /** Ollama: OpenAI-compatible base URL (default http://127.0.0.1:11434/v1). */
  baseURL?: string
  /** Managed provider: the logical operation the backend routes. */
  capability?: AiCapability
  /** Managed provider: groups turns of one conversation for auditing. */
  conversationId?: string
  signal?: AbortSignal
}

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1'

const OPENAI_COMPAT_BASE: Partial<Record<ProviderId, string>> = {
  nvidia: NVIDIA_BASE_URL,
}

/**
 * Builds a Strands `Model` for the configured provider.
 *
 * NVIDIA NIM is OpenAI wire-compatible, so it rides the OpenAI provider with a
 * custom baseURL rather than needing a bespoke implementation.
 */
export async function createModel(spec: ModelSpec): Promise<Model> {
  const { provider, model, apiKey, temperature = 0.3, maxTokens = 4096 } = spec

  if (provider === 'managed') {
    // No credentials, region, or model ID: the backend owns all of it.
    return createManagedModel(spec, {
      capability: spec.capability ?? 'resume_edit',
      ...(spec.conversationId ? { conversationId: spec.conversationId } : {}),
    })
  }

  if (provider === 'bedrock') {
    const { BedrockModel } = await import('@strands-agents/sdk')
    const region = spec.region?.trim() || PRODUCT_AWS.region
    const accessKeyId = spec.accessKeyId?.trim()
    const secretAccessKey = spec.secretAccessKey?.trim()

    if (accessKeyId && secretAccessKey) {
      await assertProductAwsIdentity({
        region,
        accessKeyId,
        secretAccessKey,
        expectedAccountId: spec.expectedAccountId,
      })
      return new BedrockModel({
        modelId: model,
        region,
        temperature,
        maxTokens,
        clientConfig: {
          region,
          credentials: { accessKeyId, secretAccessKey },
        },
      }) as unknown as Model
    }

    // Legacy Bedrock API key (bearer), if one was saved before access keys.
    if (apiKey.trim()) {
      return new BedrockModel({
        modelId: model,
        region,
        temperature,
        maxTokens,
        apiKey: apiKey.trim(),
      }) as unknown as Model
    }

    throw new Error(
      'Missing AWS Access Key ID or Secret Access Key. Open Settings → Bedrock to add them.',
    )
  }

  if (provider === 'nvidia' || provider === 'openai' || provider === 'ollama') {
    const { OpenAIModel } = await import('@strands-agents/sdk/models/openai')
    const baseURL =
      provider === 'ollama'
        ? spec.baseURL?.trim() || DEFAULT_OLLAMA_BASE_URL
        : OPENAI_COMPAT_BASE[provider]
    const resolvedKey = provider === 'ollama' ? apiKey.trim() || 'ollama' : apiKey.trim()
    if ((provider === 'openai' || provider === 'nvidia') && !resolvedKey) {
      throw new Error(
        provider === 'nvidia'
          ? 'NVIDIA NIM is not configured in this build.'
          : 'Missing API key for openai. Open Settings to add one.',
      )
    }
    return new OpenAIModel({
      api: 'chat',
      modelId: model,
      apiKey: resolvedKey,
      temperature,
      maxTokens,
      ...(baseURL ? { clientConfig: { baseURL, apiKey: resolvedKey } } : {}),
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

  throw new Error(`Unknown provider: ${provider}`)
}

/** Every remaining provider can emit tool calls and drive the agent loop. */
export function supportsToolLoop(provider: ProviderId): boolean {
  return AGENTIC_PROVIDERS.includes(provider)
}
