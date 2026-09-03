/**
 * Server-controlled catalog: plans, model routing policy, and feature flags.
 *
 * Code holds the defaults so a fresh stack works with an empty table; DynamoDB
 * holds optional overrides so pricing, quotas, and model choices can change
 * without shipping a desktop release. Overrides are cached briefly because this
 * is read on every AI request.
 */
import { store } from './store.js'

/**
 * Logical capabilities the desktop asks for. The client never names an AWS
 * model, which is what keeps model selection a backend concern.
 */
export const CAPABILITIES = [
  'resume_edit',
  'resume_analysis',
  'resume_generation',
  'resume_rewrite',
  'interview_prep',
  'agent',
  'chat',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export const isCapability = (value: unknown): value is Capability =>
  typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value)

export type ModelTier = 'fast' | 'standard' | 'advanced'

export type ModelDefinition = {
  /** Bedrock model or inference-profile ID. Never sent to the client. */
  modelId: string
  /** Shown in the desktop attribution line. */
  label: string
  tier: ModelTier
  /** Micro-USD per 1,000 tokens; integers avoid float drift in cost sums. */
  inputCostPerKTokens: number
  outputCostPerKTokens: number
  maxTokens: number
}

export const MODEL_CATALOG: Record<string, ModelDefinition> = {
  'claude-haiku': {
    modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    label: 'Claude 3.5 Haiku',
    tier: 'fast',
    inputCostPerKTokens: 800,
    outputCostPerKTokens: 4000,
    maxTokens: 8192,
  },
  'claude-sonnet': {
    modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    label: 'Claude 3.5 Sonnet',
    tier: 'advanced',
    inputCostPerKTokens: 3000,
    outputCostPerKTokens: 15000,
    maxTokens: 8192,
  },
  'nova-lite': {
    modelId: 'us.amazon.nova-lite-v1:0',
    label: 'Amazon Nova Lite',
    tier: 'standard',
    inputCostPerKTokens: 60,
    outputCostPerKTokens: 240,
    maxTokens: 5120,
  },
}

/**
 * Capability → ordered model preference. The first entry the plan is allowed to
 * use wins; later entries act as fallbacks when a model is unavailable.
 */
export type RoutingPolicy = Record<Capability, string[]>

export const DEFAULT_ROUTING: RoutingPolicy = {
  resume_edit: ['claude-haiku', 'nova-lite'],
  resume_analysis: ['claude-haiku', 'nova-lite'],
  resume_generation: ['claude-sonnet', 'claude-haiku'],
  resume_rewrite: ['claude-sonnet', 'claude-haiku'],
  interview_prep: ['claude-haiku', 'nova-lite'],
  agent: ['claude-sonnet', 'claude-haiku'],
  chat: ['claude-haiku', 'nova-lite'],
}

export type PlanId = 'free' | 'pro' | 'premium' | 'enterprise'

export type Plan = {
  planId: PlanId
  name: string
  /** Whether the managed AWS AI option works at all on this plan. */
  aiAccess: boolean
  capabilities: Capability[]
  /** Highest model tier the plan may route to. */
  maxTier: ModelTier
  requestsPerPeriod: number
  /** Belt-and-braces spend cap, independent of the request count. */
  tokenCeilingPerPeriod: number
  rateLimitPerMinute: number
  features: string[]
}

const TIER_RANK: Record<ModelTier, number> = { fast: 0, standard: 1, advanced: 2 }

export const tierAllowed = (tier: ModelTier, maxTier: ModelTier): boolean =>
  TIER_RANK[tier] <= TIER_RANK[maxTier]

export const DEFAULT_PLANS: Record<PlanId, Plan> = {
  free: {
    planId: 'free',
    name: 'Free',
    aiAccess: true,
    capabilities: ['resume_edit', 'resume_analysis', 'chat'],
    maxTier: 'fast',
    requestsPerPeriod: 50,
    tokenCeilingPerPeriod: 300_000,
    rateLimitPerMinute: 5,
    features: ['managed_ai'],
  },
  pro: {
    planId: 'pro',
    name: 'Pro',
    aiAccess: true,
    capabilities: [
      'resume_edit',
      'resume_analysis',
      'resume_generation',
      'resume_rewrite',
      'interview_prep',
      'chat',
    ],
    maxTier: 'standard',
    requestsPerPeriod: 2_000,
    tokenCeilingPerPeriod: 20_000_000,
    rateLimitPerMinute: 20,
    features: ['managed_ai', 'evidence_tailor', 'recruiter_lens'],
  },
  premium: {
    planId: 'premium',
    name: 'Premium',
    aiAccess: true,
    capabilities: [...CAPABILITIES],
    maxTier: 'advanced',
    requestsPerPeriod: 10_000,
    tokenCeilingPerPeriod: 100_000_000,
    rateLimitPerMinute: 40,
    features: ['managed_ai', 'evidence_tailor', 'recruiter_lens', 'agent_mode'],
  },
  enterprise: {
    planId: 'enterprise',
    name: 'Enterprise',
    aiAccess: true,
    capabilities: [...CAPABILITIES],
    maxTier: 'advanced',
    requestsPerPeriod: 100_000,
    tokenCeilingPerPeriod: 1_000_000_000,
    rateLimitPerMinute: 120,
    features: ['managed_ai', 'evidence_tailor', 'recruiter_lens', 'agent_mode', 'sso', 'audit_log'],
  },
}

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === 'string' && value in DEFAULT_PLANS

type CacheEntry<T> = { value: T; expiresAt: number }
const CACHE_TTL_MS = 60_000
let planCache: CacheEntry<Partial<Record<PlanId, Plan>>> | null = null
let routingCache: CacheEntry<RoutingPolicy> | null = null
let flagCache: CacheEntry<Record<string, boolean>> | null = null

const fresh = <T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> =>
  !!entry && entry.expiresAt > Date.now()

async function loadPlanOverrides(): Promise<Partial<Record<PlanId, Plan>>> {
  if (fresh(planCache)) return planCache.value
  const rows = await store().query<{ plan?: Plan }>('CONFIG#PLANS', '')
  const overrides: Partial<Record<PlanId, Plan>> = {}
  for (const row of rows) {
    if (row.plan && isPlanId(row.plan.planId)) overrides[row.plan.planId] = row.plan
  }
  planCache = { value: overrides, expiresAt: Date.now() + CACHE_TTL_MS }
  return overrides
}

export async function getPlan(planId: PlanId): Promise<Plan> {
  const overrides = await loadPlanOverrides()
  return overrides[planId] ?? DEFAULT_PLANS[planId]
}

export async function getRouting(): Promise<RoutingPolicy> {
  if (fresh(routingCache)) return routingCache.value
  const row = await store().get<{ routing?: Partial<RoutingPolicy> }>('CONFIG#ROUTING', 'CURRENT')
  const merged = { ...DEFAULT_ROUTING, ...(row?.routing ?? {}) } as RoutingPolicy
  routingCache = { value: merged, expiresAt: Date.now() + CACHE_TTL_MS }
  return merged
}

export async function getFlags(): Promise<Record<string, boolean>> {
  if (fresh(flagCache)) return flagCache.value
  const row = await store().get<{ flags?: Record<string, boolean> }>('CONFIG#FLAGS', 'CURRENT')
  const flags = row?.flags ?? {}
  flagCache = { value: flags, expiresAt: Date.now() + CACHE_TTL_MS }
  return flags
}

/** Test hook: catalog caches would otherwise leak between cases. */
export function resetCatalogCache(): void {
  planCache = null
  routingCache = null
  flagCache = null
}
