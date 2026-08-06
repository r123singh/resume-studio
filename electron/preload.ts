import { contextBridge, ipcRenderer } from 'electron'

export type TreeNode = {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: TreeNode[]
}

export type PublicSettings = {
  provider: 'nvidia' | 'cursor' | 'openai' | 'anthropic' | 'gemini'
  model: string
  lastWorkspace: string | null
  hasNvidia: boolean
  hasCursor: boolean
  hasOpenAI: boolean
  hasAnthropic: boolean
  hasGemini: boolean
}

export type SecretSettings = {
  provider: 'nvidia' | 'cursor' | 'openai' | 'anthropic' | 'gemini'
  model: string
  nvidiaKey: string
  cursorKey: string
  openaiKey: string
  anthropicKey: string
  geminiKey: string
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
    cursorKey?: string
    openaiKey?: string
    anthropicKey?: string
    geminiKey?: string
    lastWorkspace?: string | null
  }): Promise<boolean> => ipcRenderer.invoke('settings:set', patch),
  getSecrets: (): Promise<SecretSettings> => ipcRenderer.invoke('settings:getSecrets'),
  completeChat: (payload: {
    provider: PublicSettings['provider']
    model: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    workspace: string | null
  }): Promise<string> => ipcRenderer.invoke('ai:complete', payload),
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
}

contextBridge.exposeInMainWorld('resumeStudio', api)

export type ResumeStudioApi = typeof api
