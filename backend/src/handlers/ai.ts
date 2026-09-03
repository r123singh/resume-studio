/**
 * The AI request gateway.
 *
 * This is the only path to a model. It validates the request, runs the
 * authorization pipeline, claims the request ID for idempotency, routes to a
 * model, invokes Bedrock, and meters the result — in that order, so a request
 * is never billed without having been authorized and never charged twice.
 */
import { ApiError, ErrorCode, badRequest, toApiError } from '../lib/errors.js'
import { ok, parseJsonBody, type HttpRequest, type HttpResponse } from '../lib/http.js'
import { config } from '../lib/config.js'
import { isCapability, type Capability } from '../data/catalog.js'
import { authenticateRequest, authorizeAiRequest, type AuthorizedAiContext } from '../domain/authorize.js'
import { estimateCostMicroUsd } from '../domain/router.js'
import { converse, converseStream, type AiMessage, type ToolSpec } from '../domain/bedrock.js'
import { claimRequest, recordUsage, releaseRequest, settleRequest } from '../data/usage.js'

type AiRequestBody = {
  request_id?: string
  conversation_id?: string
  capability?: string
  system?: string
  messages?: unknown
  tools?: unknown
  params?: { temperature?: number; maxTokens?: number }
  metadata?: Record<string, unknown>
}

type ValidatedRequest = {
  requestId: string
  conversationId?: string
  capability: Capability
  system?: string
  messages: AiMessage[]
  tools: ToolSpec[]
  temperature?: number
  maxTokens?: number
}

function validate(req: HttpRequest): ValidatedRequest {
  if (req.rawBody.length > config.maxRequestBytes) {
    throw new ApiError(ErrorCode.INVALID_REQUEST, 'The request is too large.', {
      details: { max_bytes: config.maxRequestBytes },
    })
  }

  const body = parseJsonBody<AiRequestBody>(req)

  const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : ''
  if (!requestId || requestId.length > 100) {
    throw badRequest('`request_id` is required and must be under 100 characters.')
  }

  if (!isCapability(body.capability)) {
    throw badRequest('`capability` is not a recognised operation.')
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw badRequest('`messages` must be a non-empty array.')
  }
  if (body.messages.length > config.maxMessages) {
    throw badRequest(`Conversations are limited to ${config.maxMessages} messages.`)
  }

  const messages: AiMessage[] = body.messages.map((raw, index) => {
    const message = raw as { role?: unknown; content?: unknown }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw badRequest(`messages[${index}].role must be "user" or "assistant".`)
    }
    if (!Array.isArray(message.content) || message.content.length === 0) {
      throw badRequest(`messages[${index}].content must be a non-empty array of blocks.`)
    }
    return { role: message.role, content: message.content as Record<string, unknown>[] }
  })

  const tools: ToolSpec[] = Array.isArray(body.tools)
    ? body.tools.map((raw, index) => {
        const tool = raw as { name?: unknown; description?: unknown; inputSchema?: unknown }
        if (typeof tool.name !== 'string' || !tool.name) {
          throw badRequest(`tools[${index}].name is required.`)
        }
        return {
          name: tool.name,
          ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
          inputSchema:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? (tool.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
        }
      })
    : []

  const temperature = body.params?.temperature
  const maxTokens = body.params?.maxTokens

  return {
    requestId,
    ...(typeof body.conversation_id === 'string'
      ? { conversationId: body.conversation_id.slice(0, 100) }
      : {}),
    capability: body.capability,
    ...(typeof body.system === 'string' && body.system ? { system: body.system } : {}),
    messages,
    tools,
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
  }
}

type Prepared = { request: ValidatedRequest; context: AuthorizedAiContext }

async function prepare(req: HttpRequest): Promise<Prepared> {
  const request = validate(req)
  const principal = await authenticateRequest(req)

  let context: AuthorizedAiContext
  try {
    context = await authorizeAiRequest(principal, request.capability)
  } catch (err) {
    // Refusals are audited so blocked traffic is visible, but they consume no
    // quota and are not billed.
    const apiError = toApiError(err)
    await recordUsage({
      userId: principal.userId,
      requestId: request.requestId,
      capability: request.capability,
      modelKey: 'none',
      modelId: 'none',
      planId: 'unknown',
      period: new Date().toISOString().slice(0, 7),
      status: 'blocked',
      failureReason: apiError.code,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicroUsd: 0,
      latencyMs: 0,
      createdAt: new Date().toISOString(),
      ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    })
    throw err
  }

  const claim = await claimRequest(principal.userId, request.requestId)
  if (!claim.claimed) {
    if (claim.inFlight) {
      throw new ApiError(
        ErrorCode.CONFLICT,
        'This request is already being processed.',
        { retryAfterSeconds: 2 },
      )
    }
    throw new ApiError(ErrorCode.CONFLICT, 'This request has already been completed.', {
      details: claim.record
        ? { request_id: claim.record.requestId, status: claim.record.status }
        : undefined,
    })
  }

  return { request, context }
}

function entitlementSummary(context: AuthorizedAiContext, consumed: number) {
  return {
    requests_remaining: Math.max(0, context.entitlements.requestsRemaining - consumed),
    requests_limit: context.entitlements.requestsLimit,
    period_end: context.entitlements.periodEnd,
    plan_id: context.entitlements.planId,
  }
}

export async function aiRequest(req: HttpRequest): Promise<HttpResponse> {
  const { request, context } = await prepare(req)
  const { route, principal } = context
  const startedAt = Date.now()

  const log = req.log.child({
    userId: principal.userId,
    requestId: request.requestId,
    capability: request.capability,
    modelKey: route.modelKey,
    planId: context.plan.planId,
  })

  try {
    const result = await converse({
      modelId: route.definition.modelId,
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages,
      ...(request.tools.length ? { tools: request.tools } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      maxTokens: Math.min(request.maxTokens ?? route.definition.maxTokens, route.definition.maxTokens),
    })

    const latencyMs = Date.now() - startedAt
    const cost = estimateCostMicroUsd(
      route.definition,
      result.usage.inputTokens,
      result.usage.outputTokens,
    )

    await recordUsage({
      userId: principal.userId,
      requestId: request.requestId,
      capability: request.capability,
      modelKey: route.modelKey,
      modelId: route.definition.modelId,
      planId: context.plan.planId,
      period: context.period,
      status: 'succeeded',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostMicroUsd: cost,
      latencyMs,
      createdAt: new Date().toISOString(),
      ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    })
    await settleRequest(principal.userId, request.requestId, 'succeeded')

    log.info('ai.request.succeeded', {
      latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costMicroUsd: cost,
    })
    log.metric('AiRequestLatency', latencyMs, 'Milliseconds', {
      capability: request.capability,
      model: route.modelKey,
    })
    log.metric('AiTokens', result.usage.inputTokens + result.usage.outputTokens, 'Count', {
      capability: request.capability,
      model: route.modelKey,
    })

    return ok({
      request_id: request.requestId,
      capability: request.capability,
      model: route.definition.label,
      stop_reason: result.stopReason,
      content: result.content,
      usage: {
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
      },
      entitlement: entitlementSummary(context, 1),
    })
  } catch (err) {
    await handleFailure(err, request, context, startedAt, log)
    throw err
  }
}

/**
 * SSE variant.
 *
 * Errors are written into the stream as well as thrown, because once the first
 * byte is sent the HTTP status is already committed and the client can only
 * learn about a mid-stream failure in-band.
 */
export async function aiStream(
  req: HttpRequest,
  write: (payload: unknown) => void,
): Promise<void> {
  const { request, context } = await prepare(req)
  const { route, principal } = context
  const startedAt = Date.now()

  const log = req.log.child({
    userId: principal.userId,
    requestId: request.requestId,
    capability: request.capability,
    modelKey: route.modelKey,
    planId: context.plan.planId,
  })

  let inputTokens = 0
  let outputTokens = 0

  try {
    const stream = converseStream({
      modelId: route.definition.modelId,
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages,
      ...(request.tools.length ? { tools: request.tools } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      maxTokens: Math.min(request.maxTokens ?? route.definition.maxTokens, route.definition.maxTokens),
    })

    while (true) {
      const next = await stream.next()
      if (next.done) {
        inputTokens = next.value.inputTokens
        outputTokens = next.value.outputTokens
        break
      }
      write(next.value)
    }

    const latencyMs = Date.now() - startedAt
    const cost = estimateCostMicroUsd(route.definition, inputTokens, outputTokens)

    await recordUsage({
      userId: principal.userId,
      requestId: request.requestId,
      capability: request.capability,
      modelKey: route.modelKey,
      modelId: route.definition.modelId,
      planId: context.plan.planId,
      period: context.period,
      status: 'succeeded',
      inputTokens,
      outputTokens,
      estimatedCostMicroUsd: cost,
      latencyMs,
      createdAt: new Date().toISOString(),
      ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    })
    await settleRequest(principal.userId, request.requestId, 'succeeded')

    log.info('ai.stream.succeeded', { latencyMs, inputTokens, outputTokens, costMicroUsd: cost })
    log.metric('AiRequestLatency', latencyMs, 'Milliseconds', {
      capability: request.capability,
      model: route.modelKey,
    })

    write({
      type: 'platformDone',
      requestId: request.requestId,
      model: route.definition.label,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      entitlement: entitlementSummary(context, 1),
    })
  } catch (err) {
    await handleFailure(err, request, context, startedAt, log)
    const apiError = toApiError(err)
    write({ type: 'platformError', code: apiError.code, message: apiError.message })
  }
}

/**
 * Records a failed request and decides whether its ID can be retried.
 *
 * Provider outages and rate limits release the claim so the client can retry
 * with the same ID; anything else settles as failed so a genuinely bad request
 * is not replayed indefinitely.
 */
async function handleFailure(
  err: unknown,
  request: ValidatedRequest,
  context: AuthorizedAiContext,
  startedAt: number,
  log: HttpRequest['log'],
): Promise<void> {
  const apiError = toApiError(err)
  const latencyMs = Date.now() - startedAt

  await recordUsage({
    userId: context.principal.userId,
    requestId: request.requestId,
    capability: request.capability,
    modelKey: context.route.modelKey,
    modelId: context.route.definition.modelId,
    planId: context.plan.planId,
    period: context.period,
    status: 'failed',
    failureReason: apiError.code,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostMicroUsd: 0,
    latencyMs,
    createdAt: new Date().toISOString(),
    ...(request.conversationId ? { conversationId: request.conversationId } : {}),
  })

  const retryable =
    apiError.code === ErrorCode.AI_PROVIDER_ERROR ||
    apiError.code === ErrorCode.RATE_LIMITED ||
    apiError.code === ErrorCode.MODEL_UNAVAILABLE

  if (retryable) await releaseRequest(context.principal.userId, request.requestId)
  else await settleRequest(context.principal.userId, request.requestId, 'failed')

  log.error('ai.request.failed', { code: apiError.code, latencyMs, retryable })
  log.metric('AiRequestFailure', 1, 'Count', {
    capability: request.capability,
    code: apiError.code,
  })
}
