import { createModel, supportsToolLoop, type ModelSpec } from './models'
import { buildResumeTools } from './tools'
import type {
  AgentRunResult,
  AgentToolEvent,
  ChatMessage,
  EditProposal,
  ProviderId,
} from './types'

/** Hard ceilings so a tool loop cannot run away with the user's tokens. */
const MAX_TURNS = 12
const MAX_TOTAL_TOKENS = 120_000

export const AGENT_SYSTEM_PROMPT = `You are the Resume Studio agent. You help a job seeker tailor their resume using evidence, not invention.

Your tools:
- list_workspace_files / read_resume_file / search_workspace — inspect the candidate's real resume.
- research_job — fetch a job posting and get numbered evidence snippets (S1, S2, ...).
- propose_edit — propose a rewritten file for the user to review.

Hard rules:
- NEVER invent employers, job titles, dates, degrees, certifications, or metrics. Every factual claim in a resume edit must already exist in the candidate's files.
- Evidence snippets describe what the EMPLOYER wants. Use them to choose emphasis and wording — never as a source of new facts about the candidate.
- Always read the target file before proposing an edit to it.
- Cite the evidence snippet ids that justify each change in the rationale and evidence fields.
- propose_edit does not save anything. The user reviews a diff and decides. Never claim you saved or committed a file.
- Work in as few tool calls as possible, then give a short plain-language summary of what you changed and why.`

export type RunAgentArgs = {
  spec: ModelSpec
  prompt: string
  /** Prior conversation, converted into the agent's seed history. */
  history?: ChatMessage[]
  workspace: string | null
  activeRelativePath: string | null
  allowWebResearch: boolean
  systemPrompt?: string
  maxTurns?: number
  onText: (delta: string) => void
  onToolEvent: (event: AgentToolEvent) => void
  onStatus?: (status: string) => void
  signal?: AbortSignal
}

/**
 * Runs one agentic invocation: the model plans, calls tools, and finishes with
 * a summary. Mutations are returned as proposals rather than applied.
 */
export async function runAgent(args: RunAgentArgs): Promise<AgentRunResult> {
  const provider: ProviderId = args.spec.provider

  if (!supportsToolLoop(provider)) {
    throw new Error(
      'The Cursor provider cannot run tool-using agents. Choose Bedrock, NVIDIA, OpenAI, Anthropic, or Gemini in Settings.',
    )
  }

  const { Agent } = await import('@strands-agents/sdk')
  const model = await createModel(args.spec)

  const proposals: EditProposal[] = []
  const toolCalls: AgentToolEvent[] = []

  const tools = await buildResumeTools({
    workspace: args.workspace,
    activeRelativePath: args.activeRelativePath,
    allowWebResearch: args.allowWebResearch,
    proposals,
    onToolEvent: (event) => {
      if (event.status !== 'running') toolCalls.push(event)
      args.onToolEvent(event)
    },
  })

  const contextLine = [
    args.workspace ? `Workspace: ${args.workspace}` : 'No workspace is open.',
    args.activeRelativePath ? `Currently open file: ${args.activeRelativePath}` : null,
    `Web research is ${args.allowWebResearch ? 'enabled' : 'disabled'}.`,
  ]
    .filter(Boolean)
    .join('\n')

  const agent = new Agent({
    model,
    tools,
    systemPrompt: `${args.systemPrompt || AGENT_SYSTEM_PROMPT}\n\n${contextLine}`,
    // The console printer would spam the Electron main process log.
    printer: false,
    ...(args.history?.length
      ? {
          messages: args.history
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: [{ type: 'textBlock' as const, text: m.content }],
            })),
        }
      : {}),
  })

  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let stopReason = 'endTurn'

  const stream = agent.stream(args.prompt, {
    cancelSignal: args.signal,
    limits: {
      turns: args.maxTurns ?? MAX_TURNS,
      totalTokens: MAX_TOTAL_TOKENS,
    },
  })

  while (true) {
    const next = await stream.next()
    if (next.done) {
      const result = next.value
      stopReason = String(result?.stopReason ?? stopReason)
      const usage = result?.metrics?.latestAgentInvocation?.usage as
        | { inputTokens?: number; outputTokens?: number }
        | undefined
      if (usage) {
        inputTokens = usage.inputTokens ?? inputTokens
        outputTokens = usage.outputTokens ?? outputTokens
      }
      const finalText = result?.toString?.() ?? ''
      if (finalText && !text) text = finalText
      break
    }

    const event = next.value as unknown as { type?: string; [k: string]: unknown }

    if (event.type === 'modelStreamUpdateEvent') {
      const delta = extractTextDelta(event)
      if (delta) {
        text += delta
        args.onText(delta)
      }
      continue
    }

    if (event.type === 'beforeModelCallEvent') {
      turns++
      args.onStatus?.(`Thinking (turn ${turns})…`)
    }
  }

  return {
    text: text.trim(),
    provider,
    model: args.spec.model,
    inputTokens,
    outputTokens,
    turns,
    toolCalls,
    stopReason,
    proposals,
  }
}

/** Pull the text out of a model stream update event, tolerating shape drift. */
function extractTextDelta(event: Record<string, unknown>): string {
  const inner = (event.event ?? event) as Record<string, unknown>
  const delta = inner?.delta as { type?: string; text?: string } | undefined
  if (delta && typeof delta.text === 'string' && delta.type === 'textDelta') return delta.text

  const nested = (inner?.modelStreamEvent ?? {}) as Record<string, unknown>
  const nestedDelta = nested?.delta as { type?: string; text?: string } | undefined
  if (nestedDelta && typeof nestedDelta.text === 'string' && nestedDelta.type === 'textDelta') {
    return nestedDelta.text
  }
  return ''
}

/**
 * Single-shot completion through Strands, replacing the old direct HTTP calls.
 * Used by the non-agentic code paths (tailor, edit, interview prep) so the whole
 * app runs on one framework.
 */
export async function runCompletion(args: {
  spec: ModelSpec
  messages: ChatMessage[]
  onChunk?: (delta: string) => void
  signal?: AbortSignal
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const { Agent } = await import('@strands-agents/sdk')
  const model = await createModel(args.spec)

  const system = args.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const conversation = args.messages.filter((m) => m.role !== 'system')
  const last = conversation.pop()
  if (!last) throw new Error('No user message to send.')

  const agent = new Agent({
    model,
    printer: false,
    ...(system ? { systemPrompt: system } : {}),
    ...(conversation.length
      ? {
          messages: conversation.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: [{ type: 'textBlock' as const, text: m.content }],
          })),
        }
      : {}),
  })

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  const stream = agent.stream(last.content, { cancelSignal: args.signal })
  while (true) {
    const next = await stream.next()
    if (next.done) {
      const usage = next.value?.metrics?.latestAgentInvocation?.usage as
        | { inputTokens?: number; outputTokens?: number }
        | undefined
      inputTokens = usage?.inputTokens ?? 0
      outputTokens = usage?.outputTokens ?? 0
      if (!text) text = next.value?.toString?.() ?? ''
      break
    }
    const event = next.value as unknown as { type?: string }
    if (event.type === 'modelStreamUpdateEvent') {
      const delta = extractTextDelta(next.value as unknown as Record<string, unknown>)
      if (delta) {
        text += delta
        args.onChunk?.(delta)
      }
    }
  }

  return { text: text.trim(), inputTokens, outputTokens }
}
