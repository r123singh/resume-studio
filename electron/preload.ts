import { contextBridge, ipcRenderer } from 'electron'

export type TreeNode = {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: TreeNode[]
}

export type PublicSettings = {
  provider: 'openai' | 'anthropic' | 'gemini'
  model: string
  lastWorkspace: string | null
  hasOpenAI: boolean
  hasAnthropic: boolean
  hasGemini: boolean
}

export type SecretSettings = {
  provider: 'openai' | 'anthropic' | 'gemini'
  model: string
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
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: {
    provider?: 'openai' | 'anthropic' | 'gemini'
    model?: string
    openaiKey?: string
    anthropicKey?: string
    geminiKey?: string
    lastWorkspace?: string | null
  }): Promise<boolean> => ipcRenderer.invoke('settings:set', patch),
  getSecrets: (): Promise<SecretSettings> => ipcRenderer.invoke('settings:getSecrets'),
  exportPdf: (html: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('pdf:export', { html, defaultName }),
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItem', filePath),
  pathJoin: (...parts: string[]): Promise<string> =>
    ipcRenderer.invoke('path:join', ...parts),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
}

contextBridge.exposeInMainWorld('resumeStudio', api)

export type ResumeStudioApi = typeof api
