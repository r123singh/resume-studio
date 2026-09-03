/**
 * Model routing.
 *
 * The desktop asks for a capability; this decides which Bedrock model serves
 * it. Because the policy is data (with code defaults), models can be swapped,
 * upgraded, or made plan-specific without a client release — which is the whole
 * point of not letting the client name a model.
 */
import {
  getRouting,
  MODEL_CATALOG,
  tierAllowed,
  type Capability,
  type ModelDefinition,
  type Plan,
} from '../data/catalog.js'
import { ApiError, ErrorCode } from '../lib/errors.js'

export type RoutedModel = {
  modelKey: string
  definition: ModelDefinition
  /** Remaining candidates, tried in order if the primary fails. */
  fallbacks: { modelKey: string; definition: ModelDefinition }[]
}

export async function routeCapability(
  capability: Capability,
  plan: Plan,
): Promise<RoutedModel> {
  if (!plan.aiAccess) {
    throw new ApiError(
      ErrorCode.AI_ACCESS_DENIED,
      `The ${plan.name} plan does not include managed AI.`,
    )
  }

  if (!plan.capabilities.includes(capability)) {
    throw new ApiError(
      ErrorCode.AI_ACCESS_DENIED,
      `The ${plan.name} plan does not include ${capability.replace(/_/g, ' ')}.`,
      { details: { capability, plan: plan.planId } },
    )
  }

  const routing = await getRouting()
  const candidates = routing[capability] ?? []

  const allowed = candidates
    .map((modelKey) => ({ modelKey, definition: MODEL_CATALOG[modelKey] }))
    .filter(
      (entry): entry is { modelKey: string; definition: ModelDefinition } =>
        !!entry.definition && tierAllowed(entry.definition.tier, plan.maxTier),
    )

  const [primary, ...fallbacks] = allowed
  if (!primary) {
    throw new ApiError(
      ErrorCode.MODEL_UNAVAILABLE,
      'No model is currently available for this operation.',
      { details: { capability } },
    )
  }

  return { modelKey: primary.modelKey, definition: primary.definition, fallbacks }
}

/** Micro-USD, from Bedrock's own token counts. Never computed on the client. */
export function estimateCostMicroUsd(
  definition: ModelDefinition,
  inputTokens: number,
  outputTokens: number,
): number {
  const input = (inputTokens / 1000) * definition.inputCostPerKTokens
  const output = (outputTokens / 1000) * definition.outputCostPerKTokens
  return Math.round(input + output)
}
