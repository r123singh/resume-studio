import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type TreeNode = {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: TreeNode[]
}

export type ProviderId =
  | 'nvidia'
  | 'groq'
  | 'cursor'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'bedrock'
  | 'managed'

/** Logical operation names the managed backend routes to a model. */
export type AiCapability =
  | 'resume_edit'
  | 'resume_analysis'
  | 'resume_generation'
  | 'resume_rewrite'
  | 'interview_prep'
  | 'agent'
  | 'chat'

export type PlatformStatus = {
  /** Whether this build has a backend URL compiled in. */
  configured: boolean
  signedIn: boolean
  email: string
}

export type PlatformResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

export type AccountState = {
  account: { user_id: string; email: string; status: string; created_at: string }
  subscription: {
    plan_id: string
    status: string
    current_period_start: string
    current_period_end: string
    cancel_at_period_end: boolean
    grace_period_ends_at?: string
  }
  entitlements: {
    planId: string
    planName: string
    aiAccess: boolean
    capabilities: string[]
    features: string[]
    requestsLimit: number
    requestsUsed: number
    requestsRemaining: number
    periodEnd: string
    degradedFrom?: string
  }
  usage: {
    period: string
    requests: number
    input_tokens: number
    output_tokens: number
    estimated_cost_usd: number
  }
  feature_flags: Record<string, boolean>
}

export type PublicSettings = {
  provider: ProviderId
  model: string
  lastWorkspace: string | null
  hasNvidia: boolean
  hasGroq: boolean
  hasCursor: boolean
  hasOpenAI: boolean
  hasAnthropic: boolean
  hasGemini: boolean
  hasBedrock: boolean
  hasBedrockAccessKeyId: boolean
  hasBedrockSecretAccessKey: boolean
  awsRegion: string
  awsProfile: string
  awsAccountId: string
  agentMode: boolean
  allowExternalAi: boolean
  redactPii: boolean
  confirmLargeEdits: boolean
  allowWebResearch: boolean
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

export type EvidenceSnippet = {
  id: string
  sourceUrl: string
  sourceTitle: string
  kind: 'job' | 'company' | 'repo' | 'resume'
  text: string
  score: number
}

export type JobContext = {
  url: string
  title: string
  company: string
  companyUrl: string
  jobText: string
  snippets: EvidenceSnippet[]
  fetchedPages: Array<{ url: string; title: string; chars: number; ok: boolean; error?: string }>
  cached: boolean
  fetchedAt: string
}

export type SecretSettings = {
  provider: ProviderId
  model: string
  nvidiaKey: string
  groqKey: string
  cursorKey: string
  openaiKey: string
  anthropicKey: string
  geminiKey: string
  bedrockKey: string
  bedrockAccessKeyId: string
  bedrockSecretAccessKey: string
  awsRegion: string
  awsProfile: string
  awsAccountId: string
}

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  listWorkspace: (root: string): Promise<TreeNode[]> =>
    ipcRenderer.invoke('workspace:list', root),
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('workspace:readFile', filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('workspace:writeFile', filePath, content),
  ensureResumesDir: (root: string): Promise<string> =>
    ipcRenderer.invoke('workspace:ensureResumesDir', root),
  ensureInterviewPrepDir: (root: string): Promise<string> =>
    ipcRenderer.invoke('workspace:ensureInterviewPrepDir', root),
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: {
    provider?: PublicSettings['provider']
    model?: string
    nvidiaKey?: string
    groqKey?: string
    cursorKey?: string
    openaiKey?: string
    anthropicKey?: string
    geminiKey?: string
    lastWorkspace?: string | null
    allowExternalAi?: boolean
    redactPii?: boolean
    confirmLargeEdits?: boolean
    allowWebResearch?: boolean
    bedrockKey?: string
    bedrockAccessKeyId?: string
    bedrockSecretAccessKey?: string
    awsRegion?: string
    awsProfile?: string
    awsAccountId?: string
    agentMode?: boolean
  }): Promise<boolean> => ipcRenderer.invoke('settings:set', patch),
  getSecrets: (): Promise<SecretSettings> => ipcRenderer.invoke('settings:getSecrets'),
  /** Managed AI account. Server-side truth; nothing here is cached locally. */
  platformStatus: (): Promise<PlatformStatus> => ipcRenderer.invoke('platform:status'),
  platformSignIn: (
    email: string,
    password: string,
  ): Promise<PlatformResult<{ userId: string; email: string }>> =>
    ipcRenderer.invoke('platform:signIn', { email, password }),
  platformSignUp: (
    email: string,
    password: string,
  ): Promise<PlatformResult<{ userId: string; email: string }>> =>
    ipcRenderer.invoke('platform:signUp', { email, password }),
  platformSignOut: (): Promise<boolean> => ipcRenderer.invoke('platform:signOut'),
  platformAccount: (): Promise<PlatformResult<AccountState>> =>
    ipcRenderer.invoke('platform:account'),
  platformUsage: (): Promise<PlatformResult<Record<string, unknown>>> =>
    ipcRenderer.invoke('platform:usage'),
  completeChat: (payload: {
    provider: PublicSettings['provider']
    model: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    workspace: string | null
    capability?: AiCapability
  }): Promise<string> => ipcRenderer.invoke('ai:complete', payload),
  streamChat: (payload: {
    provider: PublicSettings['provider']
    model: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    workspace: string | null
    capability?: AiCapability
    onChunk?: (chunk: string) => void
  }): Promise<{
    text: string
    provider: PublicSettings['provider']
    model: string
    approxInputTokens: number
    approxOutputTokens: number
  }> => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const handler = (_event: IpcRendererEvent, data: { requestId: string; text: string }) => {
      if (data.requestId !== requestId) return
      payload.onChunk?.(data.text)
    }
    ipcRenderer.on('ai:stream:chunk', handler)
    return ipcRenderer
      .invoke('ai:stream', {
        requestId,
        provider: payload.provider,
        model: payload.model,
        messages: payload.messages,
        workspace: payload.workspace,
        capability: payload.capability,
      })
      .finally(() => {
        ipcRenderer.removeListener('ai:stream:chunk', handler)
      })
  },
  runAgent: (payload: {
    prompt: string
    history?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    workspace: string | null
    activeRelativePath: string | null
    provider?: ProviderId
    model?: string
    maxTurns?: number
    onText?: (text: string) => void
    onTool?: (tool: AgentToolEvent) => void
    onStatus?: (status: string) => void
  }): Promise<AgentRunResult> & { requestId: string } => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const handler = (
      _event: IpcRendererEvent,
      data: {
        requestId: string
        kind: 'text' | 'tool' | 'status'
        text?: string
        tool?: AgentToolEvent
        status?: string
      },
    ) => {
      if (data.requestId !== requestId) return
      if (data.kind === 'text' && data.text) payload.onText?.(data.text)
      else if (data.kind === 'tool' && data.tool) payload.onTool?.(data.tool)
      else if (data.kind === 'status' && data.status) payload.onStatus?.(data.status)
    }
    ipcRenderer.on('agent:event', handler)
    const promise = ipcRenderer
      .invoke('agent:run', {
        requestId,
        prompt: payload.prompt,
        history: payload.history || [],
        workspace: payload.workspace,
        activeRelativePath: payload.activeRelativePath,
        provider: payload.provider,
        model: payload.model,
        maxTurns: payload.maxTurns,
      })
      .finally(() => {
        ipcRenderer.removeListener('agent:event', handler)
      })
    return Object.assign(promise, { requestId })
  },
  cancelAgent: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('agent:cancel', requestId),
  submitAiFeedback: (payload: {
    workspace: string
    rating: 'up' | 'down'
    note?: string
    provider?: string
    model?: string
    snippet?: string
  }): Promise<boolean> => ipcRenderer.invoke('ai:feedback', payload),
  exportPdf: (html: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('pdf:export', { html, defaultName }),
  writePdfToPath: (html: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke('pdf:writeToPath', { html, filePath }),
  writeApplyKit: (payload: {
    workspace: string
    kitSlug: string
    files: Record<string, string>
    pdfHtml?: string
    tracker?: {
      company: string
      role: string
      location: string
      jobUrl: string
      notes: string
    }
  }): Promise<{ kitDir: string; pdfPath: string | null }> =>
    ipcRenderer.invoke('applyKit:write', payload),
  listApplications: (workspace: string) =>
    ipcRenderer.invoke('applications:list', workspace) as Promise<
      Array<{
        id: number
        date: string
        company: string
        role: string
        location: string
        source: string
        jobUrl: string
        status: 'ready-to-apply' | 'applied' | 'skipped' | 'closed'
        notes: string
      }>
    >,
  searchJobs: (workspace: string, query: string) =>
    ipcRenderer.invoke('jobHunt:search', { workspace, query }) as Promise<
      Array<{
        id: string
        title: string
        company: string
        location: string
        jobUrl: string
        source: 'RemoteOK' | 'Remotive'
        description: string
        tags: string[]
        score: number
        scoreReasons: string[]
        alreadyTracked: boolean
      }>
    >,
  ensureJobPreferences: (workspace: string): Promise<string> =>
    ipcRenderer.invoke('jobHunt:ensurePreferences', workspace),
  setApplicationStatus: (payload: {
    workspace: string
    id: number
    status: 'ready-to-apply' | 'applied' | 'skipped' | 'closed'
    note?: string
  }) => ipcRenderer.invoke('applications:setStatus', payload),
  openApplicationKit: (workspace: string, notes: string): Promise<string> =>
    ipcRenderer.invoke('applications:openKit', { workspace, notes }),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  openPath: (targetPath: string): Promise<string> =>
    ipcRenderer.invoke('shell:openPath', targetPath),
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItem', filePath),
  pathJoin: (...parts: string[]): Promise<string> =>
    ipcRenderer.invoke('path:join', ...parts),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  searchWorkspace: (workspace: string, query: string) =>
    ipcRenderer.invoke('workspace:search', { workspace, query }) as Promise<
      Array<{
        path: string
        relativePath: string
        line: number
        preview: string
      }>
    >,
  gitStatus: (workspace: string) =>
    ipcRenderer.invoke('git:status', workspace) as Promise<{
      isRepo: boolean
      branch: string | null
      staged: string[]
      modified: string[]
      not_added: string[]
      deleted: string[]
      conflicted: string[]
      ahead: number
      behind: number
      summary: string
    }>,
  gitDiff: (workspace: string) =>
    ipcRenderer.invoke('git:diff', workspace) as Promise<{
      staged: string
      unstaged: string
    }>,
  gitCommit: (workspace: string, message: string, paths?: string[]) =>
    ipcRenderer.invoke('git:commit', { workspace, message, paths }) as Promise<{
      commit: string
    }>,
  gitInit: (workspace: string): Promise<boolean> =>
    ipcRenderer.invoke('git:init', workspace),
  fetchJobContext: (payload: {
    workspace: string | null
    url: string
    jobDescription?: string
    pastedText?: string
    topK?: number
    refresh?: boolean
  }): Promise<JobContext> => ipcRenderer.invoke('research:fetchJobContext', payload),
  clearEvidenceCache: (workspace: string): Promise<boolean> =>
    ipcRenderer.invoke('research:clearCache', workspace),
  recordAiAudit: (payload: {
    workspace: string
    action: string
    provider?: string
    model?: string
    jobUrl?: string
    evidence?: Array<{ id: string; sourceUrl: string; excerpt: string }>
    promptSnapshot?: string
    targetFile?: string
  }): Promise<boolean> => ipcRenderer.invoke('ai:audit', payload),
}

contextBridge.exposeInMainWorld('resumeStudio', api)

export type ResumeStudioApi = typeof api
