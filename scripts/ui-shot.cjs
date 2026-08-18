/**
 * Visual QA: load the production renderer against a mock workspace and capture
 * screenshots. Does not boot electron/main.ts, so it cannot hang on IPC.
 *
 *   npx electron scripts/ui-shot.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(os.tmpdir(), 'rs-ui-shot')
const WORKSPACE = path.join(ROOT, 'workspace')
const USER_DATA = path.join(ROOT, 'user-data')
const OUT = path.join(process.cwd(), '.ui-shots')
const PRELOAD = path.join(ROOT, 'preload.js')

const RESUME = `# Priya Raghunathan

Senior Product Manager · Bengaluru, India
priya.raghunathan@example.com · +91 98800 12345 · linkedin.com/in/priyar

## Summary

Product manager with 8 years building payments and marketplace platforms.
Led the team that took a B2B checkout product from pilot to 40% of company revenue.

## Experience

### Stripe — Senior Product Manager
2022 – Present

- Owned the roadmap for a payments orchestration layer serving 12,000 merchants.
- Cut checkout drop-off by 18% by rebuilding the retry and fallback logic.
- Led a team of 8 engineers and 2 designers across three time zones.

### Razorpay — Product Manager
2019 – 2022

- Launched recurring billing, reaching $4M ARR within four quarters.
- Shipped a merchant onboarding flow that reduced activation time from 6 days to 9 hours.

## Skills

Product strategy, payments, experimentation, SQL, Figma, roadmapping, pricing

## Education

### Indian Institute of Technology, Madras
B.Tech, Computer Science, 2015
`

function tree() {
  return [
    { name: 'base-resume.md', path: path.join(WORKSPACE, 'base-resume.md'), relativePath: 'base-resume.md', type: 'file' },
    { name: 'job-preferences.md', path: path.join(WORKSPACE, 'job-preferences.md'), relativePath: 'job-preferences.md', type: 'file' },
    {
      name: 'resumes',
      path: path.join(WORKSPACE, 'resumes'),
      relativePath: 'resumes',
      type: 'directory',
      children: [
        { name: 'stripe-senior-pm.md', path: path.join(WORKSPACE, 'resumes', 'stripe-senior-pm.md'), relativePath: 'resumes/stripe-senior-pm.md', type: 'file' },
        { name: 'figma-group-pm.md', path: path.join(WORKSPACE, 'resumes', 'figma-group-pm.md'), relativePath: 'resumes/figma-group-pm.md', type: 'file' },
      ],
    },
    { name: 'apply-kits', path: path.join(WORKSPACE, 'apply-kits'), relativePath: 'apply-kits', type: 'directory', children: [] },
  ]
}

function seed() {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(WORKSPACE, 'resumes'), { recursive: true })
  fs.mkdirSync(path.join(WORKSPACE, 'apply-kits'), { recursive: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(WORKSPACE, 'base-resume.md'), RESUME)
  fs.writeFileSync(path.join(WORKSPACE, 'job-preferences.md'), '# Job preferences\n\nRoles: Senior PM\n')
  fs.writeFileSync(path.join(WORKSPACE, 'resumes', 'stripe-senior-pm.md'), RESUME)
  fs.writeFileSync(path.join(WORKSPACE, 'resumes', 'figma-group-pm.md'), RESUME)

  fs.writeFileSync(
    PRELOAD,
    `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('resumeStudio', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  listWorkspace: (root) => ipcRenderer.invoke('workspace:list', root),
  readFile: (p) => ipcRenderer.invoke('workspace:readFile', p),
  writeFile: (p, c) => ipcRenderer.invoke('workspace:writeFile', p, c),
  ensureResumesDir: (root) => ipcRenderer.invoke('workspace:ensureResumesDir', root),
  ensureInterviewPrepDir: (root) => ipcRenderer.invoke('workspace:ensureInterviewPrepDir', root),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getSecrets: () => ipcRenderer.invoke('settings:getSecrets'),
  completeChat: async () => '',
  streamChat: async () => ({ text: '', provider: 'nvidia', model: '', approxInputTokens: 0, approxOutputTokens: 0 }),
  runAgent: async () => ({ text: '', provider: 'nvidia', model: '', inputTokens: 0, outputTokens: 0, turns: 0, toolCalls: [], stopReason: 'endTurn', proposals: [] }),
  cancelAgent: async () => true,
  listApplications: async () => [],
  setApplicationStatus: async () => [],
  huntJobs: async () => [],
  openExternal: async () => true,
  openApplicationKit: async () => true,
  gitStatus: async () => ({ isRepo: true, branch: 'main', summary: 'clean' }),
  gitCommit: async () => ({ ok: true }),
  gitDiff: async () => '',
  searchWorkspace: async () => [],
  fetchJobContext: async () => null,
  submitAiFeedback: async () => true,
  pathJoin: async (...parts) => parts.join('/'),
  ensureJobPreferences: async (root) => root + '/job-preferences.md',
})
`,
  )
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

seed()
app.setPath('userData', USER_DATA)

ipcMain.handle('settings:get', () => ({
  provider: 'nvidia',
  model: 'meta/llama-3.3-70b-instruct',
  lastWorkspace: WORKSPACE,
  hasNvidia: true,
  hasCursor: false,
  hasOpenAI: false,
  hasAnthropic: false,
  hasGemini: false,
  hasBedrock: false,
  awsRegion: 'us-east-1',
  agentMode: true,
  allowExternalAi: true,
  redactPii: false,
  confirmLargeEdits: true,
  allowWebResearch: false,
}))
ipcMain.handle('settings:set', () => true)
ipcMain.handle('settings:getSecrets', () => ({
  provider: 'nvidia',
  model: 'meta/llama-3.3-70b-instruct',
  nvidiaKey: '',
  cursorKey: '',
  openaiKey: '',
  anthropicKey: '',
  geminiKey: '',
  bedrockKey: '',
  awsRegion: 'us-east-1',
}))
ipcMain.handle('workspace:list', () => tree())
ipcMain.handle('workspace:readFile', (_e, filePath) => fs.readFileSync(filePath, 'utf8'))
ipcMain.handle('workspace:writeFile', () => true)
ipcMain.handle('workspace:ensureResumesDir', () => path.join(WORKSPACE, 'resumes'))
ipcMain.handle('workspace:ensureInterviewPrepDir', () => path.join(WORKSPACE, 'interview-prep'))
ipcMain.handle('dialog:openFolder', () => WORKSPACE)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: '#0d0e11',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await wait(2500)

  await win.webContents.executeJavaScript(`
    (function () {
      const rows = [...document.querySelectorAll('.tree-label.file')];
      const target = rows.find((r) => (r.textContent || '').includes('base-resume.md'));
      if (target) target.click();
    })();
  `)
  await wait(1800)

  const shoot = async (name) => {
    const image = await win.capturePage()
    const file = path.join(OUT, name + '.png')
    fs.writeFileSync(file, image.toPNG())
    console.log('captured', file)
  }

  await shoot('01-dark-workspace')

  await win.webContents.executeJavaScript(`document.querySelectorAll('.rail-btn')[1]?.click()`)
  await wait(600)
  await shoot('02-outline')

  await win.webContents.executeJavaScript(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  `)
  await wait(600)
  await shoot('03-palette')
  await win.webContents.executeJavaScript(`
    document.querySelector('.palette-backdrop')?.click();
  `)
  await wait(500)

  await win.webContents.executeJavaScript(`
    (function () {
      const segs = [...document.querySelectorAll('.segmented-item')];
      const scan = segs.find((s) => (s.textContent || '').trim() === 'Scan');
      if (scan) scan.click();
    })();
  `)
  await wait(1000)
  await shoot('04-scan-canvas')

  await win.webContents.executeJavaScript(`
    (function () {
      const segs = [...document.querySelectorAll('.segmented-item')];
      const edit = segs.find((s) => (s.textContent || '').trim() === 'Edit');
      if (edit) edit.click();
      const themeBtn = [...document.querySelectorAll('button.status-item')].find((b) =>
        /dark|light|system/i.test(b.textContent || ''),
      );
      if (themeBtn) themeBtn.click();
    })();
  `)
  await wait(1400)
  await shoot('05-light')

  app.exit(0)
})
