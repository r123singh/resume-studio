import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { completeHttpChat, type ChatMessage, type ProviderId } from './ai-http'
import {
  kitDirFromNotes,
  listApplications,
  setApplicationStatus,
  type ApplicationStatus,
} from './applications'
import { ensureJobPreferences, searchJobs } from './job-hunt'
const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

type AppSettings = {
  provider: 'nvidia' | 'cursor' | 'openai' | 'anthropic' | 'gemini'
  model: string
  nvidiaKeyEnc?: string
  cursorKeyEnc?: string
  openaiKeyEnc?: string
  anthropicKeyEnc?: string
  geminiKeyEnc?: string
  lastWorkspace?: string
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      provider: parsed.provider || 'nvidia',
      model: parsed.model || 'meta/llama-3.3-70b-instruct',
      nvidiaKeyEnc: parsed.nvidiaKeyEnc,
      cursorKeyEnc: parsed.cursorKeyEnc,
      openaiKeyEnc: parsed.openaiKeyEnc,
      anthropicKeyEnc: parsed.anthropicKeyEnc,
      geminiKeyEnc: parsed.geminiKeyEnc,
      lastWorkspace: parsed.lastWorkspace,
    }
  } catch {
    return {
      provider: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
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

async function listMarkdownTree(root: string) {
  type TreeNode = {
    name: string
    path: string
    relativePath: string
    type: 'file' | 'directory'
    children?: TreeNode[]
  }

  async function walk(dir: string): Promise<TreeNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const nodes: TreeNode[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const relativePath = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'release') {
          continue
        }
        nodes.push({
          name: entry.name,
          path: full,
          relativePath,
          type: 'directory',
          children: await walk(full),
        })
      } else if (entry.name.endsWith('.md')) {
        nodes.push({
          name: entry.name,
          path: full,
          relativePath,
          type: 'file',
        })
      }
    }
    return nodes
  }

  return walk(root)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1412',
    title: 'Resume Studio',
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
  return listMarkdownTree(root)
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
    hasCursor: Boolean(decryptSecret(s.cursorKeyEnc)),
    hasOpenAI: Boolean(decryptSecret(s.openaiKeyEnc)),
    hasAnthropic: Boolean(decryptSecret(s.anthropicKeyEnc)),
    hasGemini: Boolean(decryptSecret(s.geminiKeyEnc)),
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
      cursorKey?: string
      openaiKey?: string
      anthropicKey?: string
      geminiKey?: string
      lastWorkspace?: string | null
    },
  ) => {
    const s = await readSettings()
    if (patch.provider) s.provider = patch.provider
    if (patch.model) s.model = patch.model
    if (patch.lastWorkspace !== undefined) {
      s.lastWorkspace = patch.lastWorkspace || undefined
    }
    if (typeof patch.nvidiaKey === 'string' && patch.nvidiaKey.trim()) {
      s.nvidiaKeyEnc = encryptSecret(patch.nvidiaKey.trim())
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
    cursorKey: decryptSecret(s.cursorKeyEnc),
    openaiKey: decryptSecret(s.openaiKeyEnc),
    anthropicKey: decryptSecret(s.anthropicKeyEnc),
    geminiKey: decryptSecret(s.geminiKeyEnc),
  }
})

ipcMain.handle(
  'ai:complete',
  async (
    _e,
    payload: {
      provider?: ProviderId
      model?: string
      messages: ChatMessage[]
      workspace?: string | null
    },
  ) => {
    const s = await readSettings()
    const provider = (payload.provider || s.provider) as ProviderId
    const model = payload.model || s.model

    const keyFor = (p: ProviderId) => {
      if (p === 'nvidia') return decryptSecret(s.nvidiaKeyEnc)
      if (p === 'cursor') return decryptSecret(s.cursorKeyEnc)
      if (p === 'openai') return decryptSecret(s.openaiKeyEnc)
      if (p === 'anthropic') return decryptSecret(s.anthropicKeyEnc)
      return decryptSecret(s.geminiKeyEnc)
    }

    const apiKey = keyFor(provider)
    if (!apiKey.trim()) {
      throw new Error(`Missing API key for ${provider}. Open Settings to add one.`)
    }

    if (provider === 'cursor') {
      let Agent: typeof import('@cursor/sdk').Agent
      try {
        ;({ Agent } = await import('@cursor/sdk'))
      } catch {
        throw new Error(
          'Cursor SDK is not installed. Run: npm install @cursor/sdk — then restart Resume Studio.',
        )
      }

      const system = payload.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')
      const rest = payload.messages
        .filter((m) => m.role !== 'system')
        .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
        .join('\n\n')

      const prompt = `${system ? `${system}\n\n` : ''}${rest}

IMPORTANT:
- Return ONLY the final text response for the user (markdown/JSON as requested).
- Do not edit, create, or delete any files.
- Do not run shell commands.
- Do not explore the codebase.`

      const cwd =
        payload.workspace && fsSync.existsSync(payload.workspace)
          ? payload.workspace
          : app.getPath('temp')

      try {
        const result = await Agent.prompt(prompt, {
          apiKey,
          model: { id: model || 'composer-2.5' },
          local: { cwd },
        })
        if (result.status === 'error') {
          throw new Error(`Cursor agent run failed (${result.id || 'unknown'})`)
        }
        return String(result.result || '').trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Cursor SDK error: ${message}`)
      }
    }

    return completeHttpChat({
      provider,
      model,
      apiKey,
      messages: payload.messages,
    })
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
