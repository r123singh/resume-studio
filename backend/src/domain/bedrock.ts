/**
 * Bedrock Converse integration.
 *
 * Converse is used rather than per-model native APIs because its message and
 * tool schema is model-agnostic, so the router can switch between Anthropic and
 * Amazon models without the request shape changing. Its stream event shape also
 * maps one-to-one onto the Strands events the desktop already consumes, which
 * is what lets the existing agent loop work unchanged through the backend.
 */
import { config } from '../lib/config.js'
import { ApiError, ErrorCode } from '../lib/errors.js'
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'

export type ContentBlock = Record<string, unknown>
export type AiMessage = { role: 'user' | 'assistant'; content: ContentBlock[] }
export type ToolSpec = { name: string; description?: string; inputSchema: Record<string, unknown> }

export type ConverseParams = {
  modelId: string
  system?: string
  messages: AiMessage[]
  tools?: ToolSpec[]
  temperature?: number
  maxTokens: number
  signal?: AbortSignal
}

export type Usage = { inputTokens: number; outputTokens: number }

export type ConverseResult = {
  content: ContentBlock[]
  stopReason: string
  usage: Usage
}

/**
 * Test seam.
 *
 * The alternative is mocking the AWS SDK's module graph, which couples tests to
 * SDK internals. An explicit injection point keeps the control-plane tests
 * about entitlements and metering rather than about AWS.
 */
export type BedrockInvoker = {
  converse?: (params: ConverseParams) => Promise<ConverseResult>
  converseStream?: (params: ConverseParams) => AsyncGenerator<StreamEvent, Usage, undefined>
}

let invokerOverride: BedrockInvoker | null = null

export function setBedrockInvoker(next: BedrockInvoker | null): void {
  invokerOverride = next
}

let clientPromise: Promise<BedrockRuntimeClient> | null = null

async function client(): Promise<BedrockRuntimeClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime')
      // Credentials come from the Lambda execution role. No keys exist here.
      return new BedrockRuntimeClient({ region: config.bedrockRegion })
    })()
  }
  return clientPromise
}

function buildInput(params: ConverseParams) {
  return {
    modelId: params.modelId,
    messages: params.messages,
    ...(params.system ? { system: [{ text: params.system }] } : {}),
    inferenceConfig: {
      maxTokens: params.maxTokens,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    },
    ...(params.tools?.length
      ? {
          toolConfig: {
            tools: params.tools.map((tool) => ({
              toolSpec: {
                name: tool.name,
                ...(tool.description ? { description: tool.description } : {}),
                inputSchema: { json: tool.inputSchema },
              },
            })),
          },
        }
      : {}),
  }
}

export async function converse(params: ConverseParams): Promise<ConverseResult> {
  try {
    // The override sits inside the try so an injected failure is mapped by the
    // same code path as a real AWS one.
    if (invokerOverride?.converse) return await invokerOverride.converse(params)

    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
    const bedrock = await client()
    const response = await bedrock.send(new ConverseCommand(buildInput(params) as never), {
      ...(params.signal ? { abortSignal: params.signal as never } : {}),
    })
    return {
      content: (response.output?.message?.content ?? []) as unknown as ContentBlock[],
      stopReason: String(response.stopReason ?? 'end_turn'),
      usage: {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
      },
    }
  } catch (err) {
    throw mapBedrockError(err)
  }
}

export type StreamEvent = { type: string; [key: string]: unknown }

/**
 * Streams a Converse response as flat, discriminated events.
 *
 * The SDK yields single-key union objects (`{ contentBlockDelta: {...} }`);
 * flattening them to `{ type: 'contentBlockDelta', ... }` here means the
 * transport, the client mapper, and the tests all speak one shape.
 */
export async function* converseStream(
  params: ConverseParams,
): AsyncGenerator<StreamEvent, Usage, undefined> {
  if (invokerOverride?.converseStream) {
    try {
      return yield* invokerOverride.converseStream(params)
    } catch (err) {
      throw mapBedrockError(err)
    }
  }

  const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const bedrock = await client()

  const usage: Usage = { inputTokens: 0, outputTokens: 0 }
  let response
  try {
    response = await bedrock.send(new ConverseStreamCommand(buildInput(params) as never), {
      ...(params.signal ? { abortSignal: params.signal as never } : {}),
    })
  } catch (err) {
    throw mapBedrockError(err)
  }

  if (!response.stream) throw new ApiError(ErrorCode.AI_PROVIDER_ERROR, 'Model returned no stream.')

  try {
    for await (const chunk of response.stream) {
      const entries = Object.entries(chunk as unknown as Record<string, unknown>)
      const entry = entries.find(([, value]) => value !== undefined)
      if (!entry) continue
      const [name, value] = entry as [string, Record<string, unknown>]

      if (name === 'metadata') {
        const u = (value.usage ?? {}) as { inputTokens?: number; outputTokens?: number }
        usage.inputTokens = u.inputTokens ?? usage.inputTokens
        usage.outputTokens = u.outputTokens ?? usage.outputTokens
        yield { type: 'metadata', usage: { ...usage } }
        continue
      }

      if (
        name === 'internalServerException' ||
        name === 'modelStreamErrorException' ||
        name === 'throttlingException' ||
        name === 'validationException' ||
        name === 'serviceUnavailableException'
      ) {
        throw mapBedrockError({ name: name.charAt(0).toUpperCase() + name.slice(1) })
      }

      yield { type: name, ...value }
    }
  } catch (err) {
    throw mapBedrockError(err)
  }

  return usage
}

/**
 * Collapses AWS failures into the public error taxonomy.
 *
 * Raw Bedrock errors can carry account IDs, model ARNs, and quota details, none
 * of which should reach an end user.
 */
export function mapBedrockError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  const name = String((err as { name?: string })?.name ?? '')

  if (name === 'ThrottlingException' || name === 'TooManyRequestsException') {
    return new ApiError(ErrorCode.RATE_LIMITED, 'The AI service is busy. Try again shortly.', {
      retryAfterSeconds: 5,
    })
  }
  if (name === 'ValidationException') {
    return new ApiError(ErrorCode.INVALID_REQUEST, 'The AI request was rejected as invalid.')
  }
  if (
    name === 'ResourceNotFoundException' ||
    name === 'ModelNotReadyException' ||
    name === 'AccessDeniedException'
  ) {
    return new ApiError(ErrorCode.MODEL_UNAVAILABLE, 'The requested model is unavailable.')
  }
  if (name === 'ServiceQuotaExceededException') {
    return new ApiError(ErrorCode.MODEL_UNAVAILABLE, 'The AI service is at capacity.')
  }
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new ApiError(ErrorCode.AI_PROVIDER_ERROR, 'The AI request timed out.')
  }
  return new ApiError(ErrorCode.AI_PROVIDER_ERROR, 'The AI service failed to respond.')
}
