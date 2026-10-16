/**
 * Headless check for WhatsApp Recruiter Desk: open the panel, load the sample
 * thread, assert parsed fields and a phone-length ping. Logs JSON to stdout.
 *
 *   npx electron scripts/verify-whatsapp.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(os.tmpdir(), 'rs-verify-whatsapp')
const WORKSPACE = path.join(ROOT, 'workspace')
const USER_DATA = path.join(ROOT, 'user-data')
const PRELOAD = path.join(ROOT, 'preload.js')

const RESUME = `# Priya Raghunathan

Senior Product Manager · Bengaluru, India
priya.raghunathan@example.com · +91 98800 12345

## Summary

Product manager with 8 years building payments and marketplace platforms.
`

function seed() {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(WORKSPACE, 'resumes'), { recursive: true })
  fs.mkdirSync(path.join(WORKSPACE, 'apply-kits'), { recursive: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.writeFileSync(path.join(WORKSPACE, 'base-resume.md'), RESUME)
  fs.writeFileSync(
    PRELOAD,
    `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('resumeStudio', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  listWorkspace: (root) => ipcRenderer.invoke('workspace:list', root),
  readFile: (p) => ipcRenderer.invoke('workspace:readFile', p),
  writeFile: () => true,
  ensureResumesDir: (root) => ipcRenderer.invoke('workspace:ensureResumesDir', root),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: () => true,
  getSecrets: () => ipcRenderer.invoke('settings:getSecrets'),
  completeChat: async () => '',
  streamChat: async () => ({ text: '', provider: 'nvidia', model: '', approxInputTokens: 0, approxOutputTokens: 0 }),
  listApplications: async () => [],
  setApplicationStatus: async () => [],
  searchJobs: async () => [],
  openExternal: async (url) => ipcRenderer.invoke('shell:openExternal', url),
  gitStatus: async () => ({ isRepo: false, branch: null, staged: [], modified: [], not_added: [], deleted: [], conflicted: [], ahead: 0, behind: 0, summary: '' }),
  gitDiff: async () => ({ staged: '', unstaged: '' }),
  searchWorkspace: async () => [],
  pathJoin: async (...parts) => parts.join('/'),
  ensureJobPreferences: async () => '',
  getVersion: async () => '1.0.0',
  showItemInFolder: async () => true,
  openPath: async () => '',
  recordAiAudit: async () => true,
  submitAiFeedback: async () => true,
})
`,
  )
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
seed()
app.setPath('userData', USER_DATA)

ipcMain.handle('settings:get', () => ({
  provider: 'nvidia',
  model: 'openai/gpt-oss-20b',
  lastWorkspace: WORKSPACE,
  ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
  hasOpenAI: false,
  hasAnthropic: false,
  hasGemini: false,
  hasBedrock: false,
  hasBedrockAccessKeyId: false,
  hasBedrockSecretAccessKey: false,
  awsRegion: 'us-east-1',
  awsProfile: 'resume-studio',
  awsAccountId: '',
  agentMode: true,
  allowExternalAi: true,
  redactPii: false,
  confirmLargeEdits: true,
  allowWebResearch: false,
}))
ipcMain.handle('settings:getSecrets', () => ({
  provider: 'nvidia',
  model: 'openai/gpt-oss-20b',
  ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
  openaiKey: '',
  anthropicKey: '',
  geminiKey: '',
  bedrockKey: '',
  bedrockAccessKeyId: '',
  bedrockSecretAccessKey: '',
  awsRegion: 'us-east-1',
  awsProfile: 'resume-studio',
  awsAccountId: '',
}))
ipcMain.handle('workspace:list', () => [
  {
    name: 'base-resume.md',
    path: path.join(WORKSPACE, 'base-resume.md'),
    relativePath: 'base-resume.md',
    type: 'file',
  },
])
ipcMain.handle('workspace:readFile', (_e, filePath) => fs.readFileSync(filePath, 'utf8'))
ipcMain.handle('workspace:ensureResumesDir', () => path.join(WORKSPACE, 'resumes'))
ipcMain.handle('dialog:openFolder', () => WORKSPACE)
ipcMain.handle('shell:openExternal', (_e, url) => {
  globalThis.__opened = url
  return true
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await wait(2500)

  const labels = await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('.rail.right .rail-btn')].map((b) => b.getAttribute('aria-label'))
  `)
  const pingIndex = (labels || []).findIndex((l) => /whatsapp/i.test(l || ''))
  if (pingIndex < 0) {
    console.error(JSON.stringify({ ok: false, error: 'WhatsApp rail button missing', labels }))
    app.exit(1)
    return
  }

  await win.webContents.executeJavaScript(
    `document.querySelectorAll('.rail.right .rail-btn')[${pingIndex}]?.click()`,
  )
  await wait(400)

  const emptyTitle = await win.webContents.executeJavaScript(`
    document.querySelector('.ping-panel .empty-state-title')?.textContent || ''
  `)

  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('button')].find((b) => /Load sample/i.test(b.textContent || ''))?.click()
  `)
  await wait(600)

  const snapshot = await win.webContents.executeJavaScript(`
    (function () {
      const panel = document.querySelector('.ping-panel')
      const inputs = [...(panel?.querySelectorAll('input') || [])].map((i) => i.value)
      const areas = [...(panel?.querySelectorAll('textarea') || [])].map((t) => t.value)
      const buttons = [...(panel?.querySelectorAll('button') || [])].map((b) => b.textContent.trim())
      const skim = panel?.querySelector('.ping-skim-top strong')?.textContent || ''
      const header = document.querySelector('.chat-panel .pane-header span')?.textContent || ''
      return { header, emptyTitle: ${JSON.stringify(emptyTitle)}, inputs, ping: areas[1] || '', buttons, skim, body: (panel?.innerText || '').slice(0, 1500) }
    })()
  `)

  const ping = snapshot.ping || ''
  const ok =
    /whatsapp/i.test(snapshot.header) &&
    snapshot.inputs.some((v) => /ananya/i.test(v)) &&
    snapshot.inputs.some((v) => /simpplr/i.test(v)) &&
    snapshot.inputs.some((v) => /98100|9198100/i.test(v)) &&
    /cv|resume/i.test(ping) &&
    snapshot.buttons.includes('Open WhatsApp') &&
    Number(snapshot.skim) >= 50

  console.log(
    JSON.stringify(
      {
        ok,
        railLabels: labels,
        pingIndex,
        header: snapshot.header,
        emptyBeforeSample: emptyTitle,
        recruiter: snapshot.inputs[0],
        phone: snapshot.inputs[1],
        company: snapshot.inputs[2],
        role: snapshot.inputs[3],
        skim: snapshot.skim,
        pingPreview: ping.slice(0, 280),
        buttons: snapshot.buttons,
      },
      null,
      2,
    ),
  )
  app.exit(ok ? 0 : 1)
})
