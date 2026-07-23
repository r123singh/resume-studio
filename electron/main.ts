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
const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

type AppSettings = {
  provider: 'openai' | 'anthropic' | 'gemini'
  model: string
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
    return JSON.parse(raw) as AppSettings
  } catch {
    return {
      provider: 'openai',
      model: 'gpt-4o-mini',
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
  const baseResume = path.join(root, 'base-resume.md')
  await fs.mkdir(resumesDir, { recursive: true })
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

ipcMain.handle('settings:get', async () => {
  const s = await readSettings()
  return {
    provider: s.provider,
    model: s.model,
    lastWorkspace: s.lastWorkspace ?? null,
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
    openaiKey: decryptSecret(s.openaiKeyEnc),
    anthropicKey: decryptSecret(s.anthropicKeyEnc),
    geminiKey: decryptSecret(s.geminiKeyEnc),
  }
})

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

ipcMain.handle('shell:showItem', async (_e, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('path:join', async (_e, ...parts: string[]) => path.join(...parts))

ipcMain.handle('app:getVersion', async () => app.getVersion())
