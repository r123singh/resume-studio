export type ProviderId =
  | 'nvidia'
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'bedrock'
  | 'managed'

/**
 * Logical operations the managed backend routes to a model.
 *
 * The client asks for a capability rather than a model so model choice, cost,
 * and quality tuning stay a backend decision.
 */
export type AiCapability =
  | 'resume_edit'
  | 'resume_analysis'
  | 'resume_generation'
  | 'resume_rewrite'
  | 'interview_prep'
  | 'agent'
  | 'chat'

export const MODEL_OPTIONS: Record<ProviderId, string[]> = {
  // The managed provider has no client-side model list on purpose: the backend
  // picks the model, so there is nothing here for the user to get wrong.
  managed: [],
  bedrock: [
    'global.anthropic.claude-sonnet-4-6',
    'global.anthropic.claude-haiku-4-5',
    'us.amazon.nova-pro-v1:0',
    'us.amazon.nova-lite-v1:0',
    'us.meta.llama3-3-70b-instruct-v1:0',
  ],
  // Verified against build.nvidia.com's live catalog. The older Llama 3.x /
  // Qwen 2.5 IDs were retired and now 404, so they are replaced with current
  // free-tier, tool-calling chat models. IDs are `publisher/slug` exactly as
  // the API expects them.
  nvidia: [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'nvidia/nemotron-3-super-120b-a12b',
    'google/gemma-4-31b-it',
  ],
  // Fetched live from `GET /api/tags` when Ollama is selected in Settings.
  ollama: [],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  anthropic: [
    'claude-3-5-haiku-latest',
    'claude-3-5-sonnet-latest',
    'claude-sonnet-4-20250514',
  ],
  gemini: ['gemini-3.8-flash'],
}

export const FREE_PROVIDERS: ProviderId[] = ['nvidia', 'ollama']
/** Bring-your-own-key providers. The managed account is omitted until it can launch. */
export const PAID_PROVIDERS: ProviderId[] = ['bedrock', 'openai', 'anthropic', 'gemini']

/** Providers that run on localhost — not blocked when external AI is disabled. */
export const LOCAL_PROVIDERS: ProviderId[] = ['ollama']

export const isLocalProvider = (provider: ProviderId): boolean =>
  LOCAL_PROVIDERS.includes(provider)

/** Providers whose credentials and quota are owned by the backend account. */
export const MANAGED_PROVIDERS: ProviderId[] = ['managed']

export const isManagedProvider = (provider: ProviderId): boolean =>
  MANAGED_PROVIDERS.includes(provider)

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  managed: 'Resume Studio AI',
  nvidia: 'NVIDIA NIM (free)',
  ollama: 'Ollama (local)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  bedrock: 'Bedrock',
}

/**
 * Every direct provider can drive the agent loop. The managed provider can
 * too, because the backend forwards Bedrock Converse tool events end to end.
 */
export const AGENT_CAPABLE_PROVIDERS: ProviderId[] = [
  'managed',
  'bedrock',
  'nvidia',
  'ollama',
  'openai',
  'anthropic',
  'gemini',
]

export function supportsAgentMode(provider: ProviderId): boolean {
  return AGENT_CAPABLE_PROVIDERS.includes(provider)
}

export type AgentToolEvent = {
  name: string
  input: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  summary?: string
}

export type EditProposal = {
  id: string
  relativePath: string
  before: string
  after: string
  rationale: string
  evidence: string[]
}

export type AgentRunResult = {
  text: string
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  turns: number
  toolCalls: AgentToolEvent[]
  stopReason: string
  proposals: EditProposal[]
}

/** Runs the Strands agent loop in Electron main and streams progress back. */
export async function runAgent(args: {
  prompt: string
  history?: ChatMessage[]
  workspace?: string | null
  activeRelativePath?: string | null
  selectedText?: string | null
  provider?: ProviderId
  model?: string
  maxTurns?: number
  onText?: (delta: string, assembled: string) => void
  onTool?: (tool: AgentToolEvent) => void
  onStatus?: (status: string) => void
}): Promise<AgentRunResult> {
  let assembled = ''
  return window.resumeStudio.runAgent({
    prompt: args.prompt,
    history: args.history,
    workspace: args.workspace || null,
    activeRelativePath: args.activeRelativePath || null,
    selectedText: args.selectedText || null,
    provider: args.provider,
    model: args.model,
    maxTurns: args.maxTurns,
    onText: (delta) => {
      assembled += delta
      args.onText?.(delta, assembled)
    },
    onTool: args.onTool,
    onStatus: args.onStatus,
  })
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type StreamResult = {
  text: string
  provider: ProviderId
  model: string
  approxInputTokens: number
  approxOutputTokens: number
}

/** All LLM calls go through Electron main (avoids renderer CORS / Failed to fetch). */
export async function completeChat(args: {
  provider: ProviderId
  model: string
  apiKey?: string
  messages: ChatMessage[]
  workspace?: string | null
  /** Managed provider only; ignored by direct-vendor providers. */
  capability?: AiCapability
}): Promise<string> {
  return window.resumeStudio.completeChat({
    provider: args.provider,
    model: args.model,
    messages: args.messages,
    workspace: args.workspace || null,
    capability: args.capability,
  })
}

export async function streamChat(args: {
  provider: ProviderId
  model: string
  messages: ChatMessage[]
  workspace?: string | null
  capability?: AiCapability
  onChunk?: (chunk: string, assembled: string) => void
}): Promise<StreamResult> {
  let assembled = ''
  const result = await window.resumeStudio.streamChat({
    provider: args.provider,
    model: args.model,
    messages: args.messages,
    workspace: args.workspace || null,
    capability: args.capability,
    onChunk: (chunk) => {
      assembled += chunk
      args.onChunk?.(chunk, assembled)
    },
  })
  return {
    text: result.text,
    provider: result.provider,
    model: result.model,
    approxInputTokens: result.approxInputTokens,
    approxOutputTokens: result.approxOutputTokens,
  }
}

export function formatAttribution(r: {
  provider: string
  model: string
  approxInputTokens?: number
  approxOutputTokens?: number
}): string {
  const tokens =
    r.approxInputTokens || r.approxOutputTokens
      ? ` · ~${(r.approxInputTokens || 0) + (r.approxOutputTokens || 0)} tok est.`
      : ''
  return `${r.provider} / ${r.model}${tokens}`
}
