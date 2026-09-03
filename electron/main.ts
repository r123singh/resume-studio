import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell,
} from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import type { AiCapability, ChatMessage, ProviderId } from './agent/types'
import {
  kitDirFromNotes,
  listApplications,
  setApplicationStatus,
  type ApplicationStatus,
} from './applications'
import { ensureJobPreferences, searchJobs } from './job-hunt'
import { searchWorkspace } from './workspace-search'
import { gitCommit, gitDiff, gitInit, gitStatus } from './git'
import { clearEvidenceCache, fetchJobContext } from './job-research'
import { runAgent, runCompletion } from './agent/runner'
import { PRODUCT_AWS } from './aws/product'
import * as platform from './platform/client'

/** In-flight agent runs, so the UI can cancel them. */
const agentRuns = new Map<string, AbortController>()
const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

type AppSettings = {
  provider: ProviderId
  model: string
  nvidiaKeyEnc?: string
  groqKeyEnc?: string
  cursorKeyEnc?: string
  openaiKeyEnc?: string
  anthropicKeyEnc?: string
  geminiKeyEnc?: string
  lastWorkspace?: string
  /** When false, block outbound LLM calls (local-only mode). */
  allowExternalAi?: boolean
  /** Redact email/phone/linkedin from prompts before send. */
  redactPii?: boolean
  /** Require diff confirm for large AI edits (renderer also enforces). */
  confirmLargeEdits?: boolean
  /** Opt-in: allow fetching job/company pages for Evidence-Backed Tailor. */
  allowWebResearch?: boolean
  /** Legacy Bedrock API key (bearer auth). Prefer access key + secret. */
  bedrockKeyEnc?: string
  bedrockAccessKeyIdEnc?: string
  bedrockSecretAccessKeyEnc?: string
  awsRegion?: string
  /** Named profile for Bedrock SigV4. Never `default`. Legacy fallback. */
  awsProfile?: string
  /** Optional allowlist so credential-chain calls cannot drift accounts. */
  awsAccountId?: string
  /** Let the model plan with tools instead of a single-shot prompt. */
  agentMode?: boolean
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

const DEFAULT_NVIDIA_MODEL = 'nvidia/nemotron-3-nano-30b-a3b'
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

/**
 * NVIDIA NIM model IDs that were retired from build.nvidia.com and now 404.
 * A persisted settings file may still point at one of these, which would make
 * every free-provider AI call fail, so we migrate them to the current default.
 */
const RETIRED_NVIDIA_MODELS = new Set([
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-70b-instruct',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'deepseek-ai/deepseek-r1',
  'qwen/qwen2.5-72b-instruct',
  'google/gemma-2-27b-it',
  'mistralai/mistral-small-24b-instruct',
])

const RETIRED_GEMINI_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
])

function migrateModel(provider: string | undefined, model: string | undefined): string {
  const resolved = model || DEFAULT_NVIDIA_MODEL
  if ((provider || 'nvidia') === 'nvidia' && RETIRED_NVIDIA_MODELS.has(resolved)) {
    return DEFAULT_NVIDIA_MODEL
  }
  if (provider === 'gemini' && RETIRED_GEMINI_MODELS.has(resolved)) {
    return DEFAULT_GEMINI_MODEL
  }
  return resolved
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      provider: parsed.provider || 'nvidia',
      model: migrateModel(parsed.provider, parsed.model),
      nvidiaKeyEnc: parsed.nvidiaKeyEnc,
      groqKeyEnc: parsed.groqKeyEnc,
      cursorKeyEnc: parsed.cursorKeyEnc,
      openaiKeyEnc: parsed.openaiKeyEnc,
      anthropicKeyEnc: parsed.anthropicKeyEnc,
      geminiKeyEnc: parsed.geminiKeyEnc,
      lastWorkspace: parsed.lastWorkspace,
      allowExternalAi: parsed.allowExternalAi !== false,
      redactPii: Boolean(parsed.redactPii),
      confirmLargeEdits: parsed.confirmLargeEdits !== false,
      allowWebResearch: Boolean(parsed.allowWebResearch),
      bedrockKeyEnc: parsed.bedrockKeyEnc,
      bedrockAccessKeyIdEnc: parsed.bedrockAccessKeyIdEnc,
      bedrockSecretAccessKeyEnc: parsed.bedrockSecretAccessKeyEnc,
      awsRegion: parsed.awsRegion || PRODUCT_AWS.region,
      awsProfile: parsed.awsProfile || PRODUCT_AWS.profile,
      awsAccountId: parsed.awsAccountId || '',
      agentMode: parsed.agentMode !== false,
    }
  } catch {
    return {
      provider: 'nvidia',
      model: DEFAULT_NVIDIA_MODEL,
      allowExternalAi: true,
      redactPii: false,
      confirmLargeEdits: true,
      allowWebResearch: false,
      awsRegion: PRODUCT_AWS.region,
      awsProfile: PRODUCT_AWS.profile,
      awsAccountId: '',
      agentMode: true,
    }
  }
}

async function writeSettings(settings: AppSettings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  return Buffer.from(plain, 'utf8').toString('base64')
}

function decryptSecret(enc?: string): string {
  if (!enc) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    }
    return Buffer.from(enc, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

async function ensureWorkspaceScaffold(root: string) {
  const resumesDir = path.join(root, 'resumes')
  const applyKitsDir = path.join(root, 'apply-kits')
  const baseResume = path.join(root, 'base-resume.md')
  const applicationsCsv = path.join(root, 'applications.csv')
  await fs.mkdir(resumesDir, { recursive: true })
  await fs.mkdir(applyKitsDir, { recursive: true })
  await fs.mkdir(path.join(root, 'interview-prep'), { recursive: true })
  await fs.mkdir(path.join(root, 'variants'), { recursive: true })
  await ensureJobPreferences(root)
  if (!fsSync.existsSync(baseResume)) {
    await fs.writeFile(
      baseResume,
      `# YOUR NAME

📍 City, Country | 📧 you@email.com | 🔗 LinkedIn

# Target Role Headline

## Summary

Write a 3–4 sentence professional summary.

## Experience

#### Role Title | Company
*Dates | Location*

- Achievement with metric
- Achievement with metric

## Skills

- **Product:** Roadmaps, PRDs, discovery
- **AI:** LLMs, agents, evaluation, governance

## Education & Certifications

- Degree, School (Year)
`,
      'utf8',
    )
  }
  if (!fsSync.existsSync(applicationsCsv)) {
    await fs.writeFile(
      applicationsCsv,
      'date,company,role,location,source,job_url,status,notes\n',
      'utf8',
    )
  }
}

/** Directories that are never worth showing in the file tree. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-bundle',
  'release',
  'out',
  'build',
  'coverage',
  '.git',
  '.cache',
  '.next',
  '.turbo',
  '.vite',
])

/** Files that are pure noise in a workspace listing. */
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/**
 * Full workspace tree, IDE-explorer style: every file and folder (not just
 * markdown), directories first then files, both alphabetical. Build artefacts
 * and VCS internals are pruned so the tree stays readable.
 */
async function listWorkspaceTree(root: string) {
  type TreeNode = {
    name: string
    path: string
    relativePath: string
    type: 'file' | 'directory'
    children?: TreeNode[]
  }

  async function walk(dir: string): Promise<TreeNode[]> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const dirs: TreeNode[] = []
    const files: TreeNode[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const relativePath = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        dirs.push({
          name: entry.name,
          path: full,
          relativePath,
          type: 'directory',
          children: await walk(full),
        })
      } else {
        if (IGNORED_FILES.has(entry.name)) continue
        files.push({ name: entry.name, path: full, relativePath, type: 'file' })
      }
    }

    const byName = (a: TreeNode, b: TreeNode) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    return [...dirs.sort(byName), ...files.sort(byName)]
  }

  return walk(root)
}

function createWindow() {
  nativeTheme.themeSource = 'dark'
  Menu.setApplicationMenu(null)

  const workbench = '#141414'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: workbench,
    title: 'Resume Studio',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 10 } }
      : {
          titleBarOverlay: {
            color: workbench,
            symbolColor: '#cccccc',
            height: 35,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const root = result.filePaths[0]
  await ensureWorkspaceScaffold(root)
  const settings = await readSettings()
  settings.lastWorkspace = root
  await writeSettings(settings)
  return root
})

ipcMain.handle('workspace:list', async (_e, root: string) => {
  if (!root) return []
  await ensureWorkspaceScaffold(root)
  return listWorkspaceTree(root)
})

ipcMain.handle('workspace:readFile', async (_e, filePath: string) => {
  return fs.readFile(filePath, 'utf8')
})

ipcMain.handle('workspace:writeFile', async (_e, filePath: string, content: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  return true
})

ipcMain.handle('workspace:ensureResumesDir', async (_e, root: string) => {
  const resumesDir = path.join(root, 'resumes')
  await fs.mkdir(resumesDir, { recursive: true })
  return resumesDir
})

ipcMain.handle('workspace:ensureInterviewPrepDir', async (_e, root: string) => {
  const dir = path.join(root, 'interview-prep')
  await fs.mkdir(dir, { recursive: true })
  return dir
})

ipcMain.handle('settings:get', async () => {
  const s = await readSettings()
  return {
    provider: s.provider,
    model: s.model,
    lastWorkspace: s.lastWorkspace ?? null,
    hasNvidia: Boolean(decryptSecret(s.nvidiaKeyEnc)),
    hasGroq: Boolean(decryptSecret(s.groqKeyEnc)),
    hasCursor: Boolean(decryptSecret(s.cursorKeyEnc)),
    hasOpenAI: Boolean(decryptSecret(s.openaiKeyEnc)),
    hasAnthropic: Boolean(decryptSecret(s.anthropicKeyEnc)),
    hasGemini: Boolean(decryptSecret(s.geminiKeyEnc)),
    hasBedrock: hasBedrockCredentials(s),
    hasBedrockAccessKeyId: Boolean(decryptSecret(s.bedrockAccessKeyIdEnc)),
    hasBedrockSecretAccessKey: Boolean(decryptSecret(s.bedrockSecretAccessKeyEnc)),
    awsRegion: s.awsRegion || PRODUCT_AWS.region,
    awsProfile: s.awsProfile || PRODUCT_AWS.profile,
    awsAccountId: s.awsAccountId || '',
    agentMode: s.agentMode !== false,
    allowExternalAi: s.allowExternalAi !== false,
    redactPii: Boolean(s.redactPii),
    confirmLargeEdits: s.confirmLargeEdits !== false,
    allowWebResearch: Boolean(s.allowWebResearch),
  }
})

ipcMain.handle(
  'settings:set',
  async (
    _e,
    patch: {
      provider?: AppSettings['provider']
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
    },
  ) => {
    const s = await readSettings()
    if (patch.provider) s.provider = patch.provider
    if (typeof patch.awsRegion === 'string') s.awsRegion = patch.awsRegion.trim() || PRODUCT_AWS.region
    if (typeof patch.awsProfile === 'string') {
      const next = patch.awsProfile.trim() || PRODUCT_AWS.profile
      if (next === 'default') {
        throw new Error(
          `AWS profile "default" is blocked. Use "${PRODUCT_AWS.profile}" from the product AWS account.`,
        )
      }
      s.awsProfile = next
    }
    if (typeof patch.awsAccountId === 'string') s.awsAccountId = patch.awsAccountId.trim()
    if (typeof patch.agentMode === 'boolean') s.agentMode = patch.agentMode
    if (typeof patch.bedrockKey === 'string' && patch.bedrockKey.trim()) {
      s.bedrockKeyEnc = encryptSecret(patch.bedrockKey.trim())
    }
    if (typeof patch.bedrockAccessKeyId === 'string' && patch.bedrockAccessKeyId.trim()) {
      s.bedrockAccessKeyIdEnc = encryptSecret(patch.bedrockAccessKeyId.trim())
    }
    if (typeof patch.bedrockSecretAccessKey === 'string' && patch.bedrockSecretAccessKey.trim()) {
      s.bedrockSecretAccessKeyEnc = encryptSecret(patch.bedrockSecretAccessKey.trim())
    }
    if (patch.model) s.model = patch.model
    if (patch.lastWorkspace !== undefined) {
      s.lastWorkspace = patch.lastWorkspace || undefined
    }
    if (typeof patch.allowExternalAi === 'boolean') s.allowExternalAi = patch.allowExternalAi
    if (typeof patch.redactPii === 'boolean') s.redactPii = patch.redactPii
    if (typeof patch.confirmLargeEdits === 'boolean') s.confirmLargeEdits = patch.confirmLargeEdits
    if (typeof patch.allowWebResearch === 'boolean') s.allowWebResearch = patch.allowWebResearch
    if (typeof patch.nvidiaKey === 'string' && patch.nvidiaKey.trim()) {
      s.nvidiaKeyEnc = encryptSecret(patch.nvidiaKey.trim())
    }
    if (typeof patch.groqKey === 'string' && patch.groqKey.trim()) {
      s.groqKeyEnc = encryptSecret(patch.groqKey.trim())
    }
    if (typeof patch.cursorKey === 'string' && patch.cursorKey.trim()) {
      s.cursorKeyEnc = encryptSecret(patch.cursorKey.trim())
    }
    if (typeof patch.openaiKey === 'string' && patch.openaiKey.trim()) {
      s.openaiKeyEnc = encryptSecret(patch.openaiKey.trim())
    }
    if (typeof patch.anthropicKey === 'string' && patch.anthropicKey.trim()) {
      s.anthropicKeyEnc = encryptSecret(patch.anthropicKey.trim())
    }
    if (typeof patch.geminiKey === 'string' && patch.geminiKey.trim()) {
      s.geminiKeyEnc = encryptSecret(patch.geminiKey.trim())
    }
    await writeSettings(s)
    return true
  },
)

ipcMain.handle('settings:getSecrets', async () => {
  const s = await readSettings()
  return {
    provider: s.provider,
    model: s.model,
    nvidiaKey: decryptSecret(s.nvidiaKeyEnc),
    groqKey: decryptSecret(s.groqKeyEnc),
    cursorKey: decryptSecret(s.cursorKeyEnc),
    openaiKey: decryptSecret(s.openaiKeyEnc),
    anthropicKey: decryptSecret(s.anthropicKeyEnc),
    geminiKey: decryptSecret(s.geminiKeyEnc),
    bedrockKey: decryptSecret(s.bedrockKeyEnc),
    bedrockAccessKeyId: decryptSecret(s.bedrockAccessKeyIdEnc),
    bedrockSecretAccessKey: decryptSecret(s.bedrockSecretAccessKeyEnc),
    awsRegion: s.awsRegion || PRODUCT_AWS.region,
    awsProfile: s.awsProfile || PRODUCT_AWS.profile,
    awsAccountId: s.awsAccountId || '',
  }
})

/**
 * Managed-account IPC.
 *
 * These handlers are a thin pass-through by design: the backend is the source
 * of truth for identity, plan, entitlement, and usage, so nothing is cached or
 * recomputed here. Errors are flattened to `{ code, message }` so the renderer
 * can show the standard copy for each error code.
 */
async function platformCall<T>(fn: () => Promise<T>): Promise<
  { ok: true; data: T } | { ok: false; code: string; message: string }
> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (err instanceof platform.PlatformError) {
      return { ok: false, code: err.code, message: err.message }
    }
    // A transport failure is the offline case; the desktop must say so rather
    // than assume the subscription is still valid.
    return {
      ok: false,
      code: 'NETWORK_UNAVAILABLE',
      message: 'Could not reach the AI service. Check your connection.',
    }
  }
}

ipcMain.handle('platform:status', async () => {
  const signedIn = await platform.isSignedIn()
  return {
    configured: platform.isConfigured(),
    signedIn,
    email: signedIn ? await platform.currentEmail() : '',
  }
})

ipcMain.handle('platform:signIn', async (_e, payload: { email: string; password: string }) =>
  platformCall(() => platform.signIn(payload.email, payload.password)),
)

ipcMain.handle('platform:signUp', async (_e, payload: { email: string; password: string }) =>
  platformCall(() => platform.signUp(payload.email, payload.password)),
)

ipcMain.handle('platform:signOut', async () => {
  await platform.signOut()
  return true
})

ipcMain.handle('platform:account', async () => platformCall(() => platform.getAccount()))

ipcMain.handle('platform:usage', async () => platformCall(() => platform.getUsage()))

function keyForProvider(s: AppSettings, p: ProviderId): string {
  if (p === 'nvidia') return decryptSecret(s.nvidiaKeyEnc)
  if (p === 'groq') return decryptSecret(s.groqKeyEnc)
  if (p === 'cursor') return decryptSecret(s.cursorKeyEnc)
  if (p === 'openai') return decryptSecret(s.openaiKeyEnc)
  if (p === 'anthropic') return decryptSecret(s.anthropicKeyEnc)
  if (p === 'bedrock') return decryptSecret(s.bedrockKeyEnc)
  // The managed provider authenticates with an account token, not an API key.
  if (p === 'managed') return ''
  return decryptSecret(s.geminiKeyEnc)
}

function hasBedrockCredentials(s: AppSettings): boolean {
  const access = decryptSecret(s.bedrockAccessKeyIdEnc)
  const secret = decryptSecret(s.bedrockSecretAccessKeyEnc)
  return Boolean(access && secret) || Boolean(decryptSecret(s.bedrockKeyEnc))
}

/**
 * Providers that hold their own credential locally.
 *
 * `managed` uses the signed-in account, so it is not blocked on a missing key.
 */
function needsLocalApiKey(provider: ProviderId): boolean {
  return provider !== 'managed'
}

function assertProviderCredentials(s: AppSettings, provider: ProviderId): void {
  if (provider === 'managed') return
  if (provider === 'bedrock') {
    if (hasBedrockCredentials(s)) return
    throw new Error(
      'Missing AWS Access Key ID or Secret Access Key. Open Settings → Bedrock to add them.',
    )
  }
  if (needsLocalApiKey(provider) && !keyForProvider(s, provider).trim()) {
    throw new Error(`Missing API key for ${provider}. Open Settings to add one.`)
  }
}

function modelSpecFromSettings(
  s: AppSettings,
  provider: ProviderId,
  model: string,
  workspace?: string | null,
  capability?: AiCapability,
) {
  return {
    provider,
    model,
    apiKey: keyForProvider(s, provider),
    region: s.awsRegion || PRODUCT_AWS.region,
    accessKeyId: decryptSecret(s.bedrockAccessKeyIdEnc),
    secretAccessKey: decryptSecret(s.bedrockSecretAccessKeyEnc),
    profile: s.awsProfile || PRODUCT_AWS.profile,
    expectedAccountId: s.awsAccountId,
    workspace: workspace ?? null,
    ...(capability ? { capability } : {}),
  }
}

async function appendAudit(workspace: string, row: Record<string, unknown>) {
  if (!fsSync.existsSync(workspace)) return
  const dir = path.join(workspace, '.resume-studio')
  await fs.mkdir(dir, { recursive: true })
  await fs.appendFile(
    path.join(dir, 'ai-audit.jsonl'),
    `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`,
    'utf8',
  )
}

function redactPiiText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, '[phone redacted]')
    .replace(/linkedin\.com\/in\/[^\s)]+/gi, 'linkedin.com/in/[redacted]')
}

function prepareMessages(messages: ChatMessage[], redact: boolean): ChatMessage[] {
  if (!redact) return messages
  return messages.map((m) => ({ ...m, content: redactPiiText(m.content) }))
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

ipcMain.handle(
  'ai:complete',
  async (
    _e,
    payload: {
      provider?: ProviderId
      model?: string
      messages: ChatMessage[]
      workspace?: string | null
      capability?: AiCapability
    },
  ) => {
    const s = await readSettings()
    if (s.allowExternalAi === false) {
      throw new Error(
        'External AI is disabled in Settings (privacy). Enable “Allow external AI” to continue.',
      )
    }
    const provider = (payload.provider || s.provider) as ProviderId
    const model = payload.model || s.model
    const messages = prepareMessages(payload.messages, Boolean(s.redactPii))

    const spec = modelSpecFromSettings(s, provider, model, payload.workspace, payload.capability)
    assertProviderCredentials(s, provider)

    const result = await runCompletion({
      spec,
      messages,
    })
    return result.text
  },
)

ipcMain.handle(
  'ai:stream',
  async (
    e,
    payload: {
      requestId: string
      provider?: ProviderId
      model?: string
      messages: ChatMessage[]
      workspace?: string | null
      capability?: AiCapability
    },
  ) => {
    const s = await readSettings()
    if (s.allowExternalAi === false) {
      throw new Error(
        'External AI is disabled in Settings (privacy). Enable “Allow external AI” to continue.',
      )
    }
    const provider = (payload.provider || s.provider) as ProviderId
    const model = payload.model || s.model
    const messages = prepareMessages(payload.messages, Boolean(s.redactPii))
    const inputTokens = messages.reduce((n, m) => n + estimateTokens(m.content), 0)

    const spec = modelSpecFromSettings(s, provider, model, payload.workspace, payload.capability)
    assertProviderCredentials(s, provider)

    const sendChunk = (text: string) => {
      e.sender.send('ai:stream:chunk', { requestId: payload.requestId, text })
    }

    const result = await runCompletion({
      spec,
      messages,
      onChunk: sendChunk,
    })

    return {
      text: result.text,
      provider,
      model,
      // Strands reports real usage; fall back to the estimate when a provider
      // does not return it.
      approxInputTokens: result.inputTokens || inputTokens,
      approxOutputTokens: result.outputTokens || estimateTokens(result.text),
    }
  },
)

ipcMain.handle(
  'agent:run',
  async (
    e,
    payload: {
      requestId: string
      prompt: string
      history?: ChatMessage[]
      workspace: string | null
      activeRelativePath: string | null
      provider?: ProviderId
      model?: string
      maxTurns?: number
    },
  ) => {
    const s = await readSettings()
    if (s.allowExternalAi === false) {
      throw new Error(
        'External AI is disabled in Settings (privacy). Enable “Allow external AI” to continue.',
      )
    }

    const provider = (payload.provider || s.provider) as ProviderId
    const model = payload.model || s.model
    const spec = modelSpecFromSettings(s, provider, model, payload.workspace, 'agent')
    assertProviderCredentials(s, provider)

    const send = (data: Record<string, unknown>) => {
      e.sender.send('agent:event', { requestId: payload.requestId, ...data })
    }

    const controller = new AbortController()
    agentRuns.set(payload.requestId, controller)

    try {
      const result = await runAgent({
        spec,
        prompt: payload.prompt,
        history: prepareMessages(payload.history || [], Boolean(s.redactPii)),
        workspace: payload.workspace,
        activeRelativePath: payload.activeRelativePath,
        allowWebResearch: Boolean(s.allowWebResearch),
        maxTurns: payload.maxTurns,
        signal: controller.signal,
        onText: (text) => send({ kind: 'text', text }),
        onToolEvent: (toolEvent) => send({ kind: 'tool', tool: toolEvent }),
        onStatus: (status) => send({ kind: 'status', status }),
      })

      if (payload.workspace) {
        await appendAudit(payload.workspace, {
          action: 'agent-run',
          provider,
          model,
          targetFile: payload.activeRelativePath || '',
          promptSnapshot: payload.prompt,
          toolCalls: result.toolCalls.map((t) => `${t.name}:${t.status}`),
          turns: result.turns,
          stopReason: result.stopReason,
        })
      }

      return result
    } finally {
      agentRuns.delete(payload.requestId)
    }
  },
)

ipcMain.handle('agent:cancel', async (_e, requestId: string) => {
  const controller = agentRuns.get(requestId)
  if (!controller) return false
  controller.abort()
  return true
})

ipcMain.handle(
  'ai:feedback',
  async (
    _e,
    payload: {
      workspace: string
      rating: 'up' | 'down'
      note?: string
      provider?: string
      model?: string
      snippet?: string
    },
  ) => {
    const dir = payload.workspace
    if (!dir || !fsSync.existsSync(dir)) {
      throw new Error('Workspace required to store feedback')
    }
    const file = path.join(dir, '.ai-feedback.jsonl')
    const row = {
      ts: new Date().toISOString(),
      rating: payload.rating,
      note: payload.note || '',
      provider: payload.provider || '',
      model: payload.model || '',
      snippet: (payload.snippet || '').slice(0, 500),
    }
    await fs.appendFile(file, `${JSON.stringify(row)}\n`, 'utf8')
    return true
  },
)

ipcMain.handle(
  'pdf:export',
  async (_e, payload: { html: string; defaultName: string }) => {
    const result = await dialog.showSaveDialog({
      title: 'Export resume PDF',
      defaultPath: payload.defaultName.endsWith('.pdf')
        ? payload.defaultName
        : `${payload.defaultName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return null

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    })
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(payload.html)}`
    await pdfWindow.loadURL(dataUrl)
    const pdf = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
    })
    await fs.writeFile(result.filePath, pdf)
    pdfWindow.destroy()
    return result.filePath
  },
)

ipcMain.handle(
  'pdf:writeToPath',
  async (_e, payload: { html: string; filePath: string }) => {
    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    })
    try {
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(payload.html)}`
      await pdfWindow.loadURL(dataUrl)
      const pdf = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'default' },
      })
      await fs.mkdir(path.dirname(payload.filePath), { recursive: true })
      await fs.writeFile(payload.filePath, pdf)
      return payload.filePath
    } finally {
      pdfWindow.destroy()
    }
  },
)

ipcMain.handle(
  'applyKit:write',
  async (
    _e,
    payload: {
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
    },
  ) => {
    const kitDir = path.join(payload.workspace, 'apply-kits', payload.kitSlug)
    await fs.mkdir(kitDir, { recursive: true })

    for (const [name, content] of Object.entries(payload.files)) {
      await fs.writeFile(path.join(kitDir, name), content, 'utf8')
    }

    let pdfPath: string | null = null
    if (payload.pdfHtml) {
      pdfPath = path.join(kitDir, 'resume.pdf')
      const pdfWindow = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true },
      })
      try {
        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(payload.pdfHtml)}`
        await pdfWindow.loadURL(dataUrl)
        const pdf = await pdfWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { marginType: 'default' },
        })
        await fs.writeFile(pdfPath, pdf)
      } finally {
        pdfWindow.destroy()
      }
    }

    if (payload.tracker) {
      const csvPath = path.join(payload.workspace, 'applications.csv')
      if (!fsSync.existsSync(csvPath)) {
        await fs.writeFile(
          csvPath,
          'date,company,role,location,source,job_url,status,notes\n',
          'utf8',
        )
      }
      const existing = await listApplications(payload.workspace)
      const jobUrl = (payload.tracker.jobUrl || '').trim()
      const already =
        jobUrl &&
        existing.some(
          (r) => r.jobUrl.trim() === jobUrl && r.status !== 'skipped' && r.status !== 'closed',
        )
      if (!already) {
        const date = new Date().toISOString().slice(0, 10)
        const esc = (v: string) => {
          const s = v.replace(/"/g, '""')
          return /[",\n]/.test(s) ? `"${s}"` : s
        }
        const row = [
          date,
          payload.tracker.company,
          payload.tracker.role,
          payload.tracker.location,
          'Resume Studio',
          payload.tracker.jobUrl,
          'ready-to-apply',
          payload.tracker.notes,
        ]
          .map(esc)
          .join(',')
        await fs.appendFile(csvPath, `${row}\n`, 'utf8')
      }
    }

    return { kitDir, pdfPath }
  },
)

ipcMain.handle(
  'jobHunt:search',
  async (_e, payload: { workspace: string; query: string }) => {
    if (!payload.workspace) throw new Error('Open a workspace first')
    await ensureWorkspaceScaffold(payload.workspace)
    return searchJobs({
      workspace: payload.workspace,
      query: payload.query,
    })
  },
)

ipcMain.handle('jobHunt:ensurePreferences', async (_e, workspace: string) => {
  return ensureJobPreferences(workspace)
})

ipcMain.handle('applications:list', async (_e, workspace: string) => {
  if (!workspace) return []
  await ensureWorkspaceScaffold(workspace)
  return listApplications(workspace)
})

ipcMain.handle(
  'applications:setStatus',
  async (
    _e,
    payload: {
      workspace: string
      id: number
      status: ApplicationStatus
      note?: string
    },
  ) => {
    return setApplicationStatus(
      payload.workspace,
      payload.id,
      payload.status,
      payload.note,
    )
  },
)

ipcMain.handle(
  'applications:openKit',
  async (_e, payload: { workspace: string; notes: string }) => {
    const kitDir = kitDirFromNotes(payload.workspace, payload.notes)
    if (!kitDir || !fsSync.existsSync(kitDir)) {
      throw new Error('Apply kit folder not found for this row')
    }
    await shell.openPath(kitDir)
    return kitDir
  },
)

ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Only http(s) URLs can be opened')
  }
  await shell.openExternal(url)
})

ipcMain.handle('shell:openPath', async (_e, targetPath: string) => {
  return shell.openPath(targetPath)
})

ipcMain.handle('shell:showItem', async (_e, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('path:join', async (_e, ...parts: string[]) => path.join(...parts))

ipcMain.handle('app:getVersion', async () => app.getVersion())

ipcMain.handle(
  'workspace:search',
  async (_e, payload: { workspace: string; query: string }) => {
    return searchWorkspace(payload.workspace, payload.query)
  },
)

ipcMain.handle('git:status', async (_e, workspace: string) => gitStatus(workspace))

ipcMain.handle('git:diff', async (_e, workspace: string) => gitDiff(workspace))

ipcMain.handle(
  'git:commit',
  async (_e, payload: { workspace: string; message: string; paths?: string[] }) => {
    return gitCommit(payload.workspace, payload.message, payload.paths)
  },
)

ipcMain.handle('git:init', async (_e, workspace: string) => gitInit(workspace))

ipcMain.handle(
  'research:fetchJobContext',
  async (
    _e,
    payload: {
      workspace: string | null
      url: string
      jobDescription?: string
      pastedText?: string
      topK?: number
      refresh?: boolean
    },
  ) => {
    const s = await readSettings()
    // Pasted text never leaves the machine, so it needs no research opt-in.
    if (payload.url.trim() && !s.allowWebResearch) {
      throw new Error(
        'Web research is off. Enable “Allow job/company web research” in Settings to use Evidence-Backed Tailor.',
      )
    }
    return fetchJobContext(payload)
  },
)

ipcMain.handle('research:clearCache', async (_e, workspace: string) =>
  clearEvidenceCache(workspace),
)

ipcMain.handle(
  'ai:audit',
  async (
    _e,
    payload: {
      workspace: string
      action: string
      provider?: string
      model?: string
      jobUrl?: string
      evidence?: Array<{ id: string; sourceUrl: string; excerpt: string }>
      promptSnapshot?: string
      targetFile?: string
    },
  ) => {
    if (!payload.workspace || !fsSync.existsSync(payload.workspace)) {
      throw new Error('Workspace required to store the audit record')
    }
    const dir = path.join(payload.workspace, '.resume-studio')
    await fs.mkdir(dir, { recursive: true })
    const row = {
      ts: new Date().toISOString(),
      action: payload.action,
      provider: payload.provider || '',
      model: payload.model || '',
      jobUrl: payload.jobUrl || '',
      targetFile: payload.targetFile || '',
      evidence: (payload.evidence || []).map((e) => ({
        id: e.id,
        sourceUrl: e.sourceUrl,
        excerpt: e.excerpt.slice(0, 300),
      })),
      promptSnapshot: (payload.promptSnapshot || '').slice(0, 4000),
    }
    await fs.appendFile(path.join(dir, 'ai-audit.jsonl'), `${JSON.stringify(row)}\n`, 'utf8')
    return true
  },
)
