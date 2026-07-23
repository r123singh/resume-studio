import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version

const electronDist = path.join(root, 'node_modules', 'electron', 'dist')
const dist = path.join(root, 'dist')
const distElectron = path.join(root, 'dist-electron')

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('Missing node_modules/electron/dist/electron.exe. Run npm install.')
  process.exit(1)
}
if (!fs.existsSync(dist) || !fs.existsSync(distElectron)) {
  console.error('Missing dist/ or dist-electron/. Run npm run build first.')
  process.exit(1)
}

const portableRoot = path.join(root, 'release', 'portable')
const appDir = path.join(portableRoot, 'Resume Studio')
fs.rmSync(portableRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(appDir, 'resources', 'app'), { recursive: true })

function copyRecursive(src, dest) {
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

// Copy Electron runtime
for (const name of fs.readdirSync(electronDist)) {
  if (name === 'resources') continue
  const src = path.join(electronDist, name)
  const destName = name === 'electron.exe' ? 'Resume Studio.exe' : name
  copyRecursive(src, path.join(appDir, destName))
}

// Default Electron resources (icudtl, locales, etc. under resources)
const electronResources = path.join(electronDist, 'resources')
if (fs.existsSync(electronResources)) {
  for (const name of fs.readdirSync(electronResources)) {
    if (name === 'default_app.asar') continue
    copyRecursive(path.join(electronResources, name), path.join(appDir, 'resources', name))
  }
}

// App payload
const appPayload = path.join(appDir, 'resources', 'app')
const appPkg = {
  name: 'resume-studio',
  version,
  main: 'dist-electron/main.js',
  description: pkg.description,
  author: pkg.author,
  license: pkg.license,
}
fs.writeFileSync(path.join(appPayload, 'package.json'), JSON.stringify(appPkg, null, 2))
copyRecursive(dist, path.join(appPayload, 'dist'))
copyRecursive(distElectron, path.join(appPayload, 'dist-electron'))

fs.writeFileSync(
  path.join(appDir, 'README.txt'),
  `Resume Studio ${version}
Free · Bring your own API key

1. Unzip this folder anywhere.
2. Run "Resume Studio.exe".
3. Open Settings and add your OpenAI, Anthropic, or Gemini API key.
4. Open a workspace folder and start tailoring.

Windows may warn about an unsigned app — choose More info → Run anyway.
`,
)

const outDir = path.join(root, 'release', 'dist')
fs.mkdirSync(outDir, { recursive: true })
const zipName = `Resume-Studio-win-x64-${version}.zip`
const zipPath = path.join(outDir, zipName)
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

const ps = `
$ErrorActionPreference = 'Stop'
Compress-Archive -Path '${appDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force
`
execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })

const stat = fs.statSync(zipPath)
const sha = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `(Get-FileHash -Algorithm SHA256 '${zipPath.replace(/'/g, "''")}').Hash`],
  { encoding: 'utf8' },
).trim()

const meta = {
  name: 'Resume Studio',
  version,
  artifact: zipName,
  path: `release/dist/${zipName}`,
  sizeBytes: stat.size,
  sha256: sha,
  platform: 'win32',
  arch: 'x64',
  offer: 'Free · Bring your own API key',
  createdAt: new Date().toISOString(),
  downloadUrlHint: `https://github.com/r123singh/resume-studio/releases/download/v${version}/${zipName}`,
}

fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(meta, null, 2))
console.log(`Portable app: ${appDir}`)
console.log(`Zip: ${zipPath} (${stat.size} bytes)`)
console.log(`SHA256: ${sha}`)
