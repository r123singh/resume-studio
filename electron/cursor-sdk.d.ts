declare module '@cursor/sdk' {
  export type AgentPromptResult = {
    status: string
    result?: string
    id?: string
  }

  export const Agent: {
    prompt: (
      prompt: string,
      options: {
        apiKey: string
        model?: { id: string }
        local?: { cwd: string }
      },
    ) => Promise<AgentPromptResult>
  }
}

export {}
