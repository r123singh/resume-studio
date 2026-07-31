export type ProviderId =
  | 'nvidia'
  | 'cursor'
  | 'openai'
  | 'anthropic'
  | 'gemini'

export const MODEL_OPTIONS: Record<ProviderId, string[]> = {
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
export const PAID_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'gemini']

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
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
