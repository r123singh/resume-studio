export type ProviderId =
  | 'nvidia'
  | 'cursor'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'bedrock'

export const MODEL_OPTIONS: Record<ProviderId, string[]> = {
  bedrock: [
    'global.anthropic.claude-sonnet-4-6',
    'global.anthropic.claude-haiku-4-5',
    'us.amazon.nova-pro-v1:0',
    'us.amazon.nova-lite-v1:0',
    'us.meta.llama3-3-70b-instruct-v1:0',
  ],
  nvidia: [
    'meta/llama-3.3-70b-instruct',
    'meta/llama-3.1-70b-instruct',
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'deepseek-ai/deepseek-r1',
    'qwen/qwen2.5-72b-instruct',
    'google/gemma-2-27b-it',
    'mistralai/mistral-small-24b-instruct',
  ],
  cursor: ['composer-2.5', 'composer-2', 'gpt-5.3-codex'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  anthropic: [
    'claude-3-5-haiku-latest',
    'claude-3-5-sonnet-latest',
    'claude-sonnet-4-20250514',
  ],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
}

export const FREE_PROVIDERS: ProviderId[] = ['nvidia', 'cursor']
export const PAID_PROVIDERS: ProviderId[] = ['bedrock', 'openai', 'anthropic', 'gemini']

/**
 * Cursor returns a finished string with no tool-call channel, so it cannot
 * drive the agent loop.
 */
export const AGENT_CAPABLE_PROVIDERS: ProviderId[] = [
  'bedrock',
  'nvidia',
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
}): Promise<string> {
  return window.resumeStudio.completeChat({
    provider: args.provider,
    model: args.model,
    messages: args.messages,
    workspace: args.workspace || null,
  })
}

export async function streamChat(args: {
  provider: ProviderId
  model: string
  messages: ChatMessage[]
  workspace?: string | null
  onChunk?: (chunk: string, assembled: string) => void
}): Promise<StreamResult> {
  let assembled = ''
  const result = await window.resumeStudio.streamChat({
    provider: args.provider,
    model: args.model,
    messages: args.messages,
    workspace: args.workspace || null,
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
