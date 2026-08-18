export type ProviderId = 'nvidia' | 'cursor' | 'openai' | 'anthropic' | 'gemini' | 'bedrock'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** A tool call the agent made, surfaced to the UI as an activity trail. */
export type AgentToolEvent = {
  name: string
  input: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  summary?: string
}

/** Streaming events pushed from the agent runner to the renderer. */
export type AgentStreamPayload =
  | { requestId: string; kind: 'text'; text: string }
  | { requestId: string; kind: 'tool'; tool: AgentToolEvent }
  | { requestId: string; kind: 'status'; status: string }

export type AgentRunResult = {
  text: string
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  turns: number
  toolCalls: AgentToolEvent[]
  stopReason: string
  /** Edits the agent proposed but did not apply; the UI confirms them. */
  proposals: EditProposal[]
}

export type EditProposal = {
  id: string
  relativePath: string
  before: string
  after: string
  rationale: string
  evidence: string[]
}
