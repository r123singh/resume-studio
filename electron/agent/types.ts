/**
 * `managed` is the account-based AWS option: requests go through the AI Backend
 * Control Layer, which owns identity, entitlement, routing, and metering.
 * `bedrock` remains the bring-your-own-AWS path for self-hosting.
 */
export type ProviderId =
  | 'nvidia'
  | 'groq'
  | 'cursor'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'bedrock'
  | 'managed'

/** Logical operations the managed backend routes to a model. */
export type AiCapability =
  | 'resume_edit'
  | 'resume_analysis'
  | 'resume_generation'
  | 'resume_rewrite'
  | 'interview_prep'
  | 'agent'
  | 'chat'

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
