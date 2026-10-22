import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const portableRoot = path.join(root, 'artifacts', 'staging')
const appDir = path.join(portableRoot, 'Resume Studio')
fs.rmSync(portableRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(appDir, 'resources', 'app'), { recursive: true })

const SKIP_DIR = new Set([
  '.bin',
  '.github',
  '.git',
  'docs',
  'doc',
  'example',
  'examples',
  'test',
  'tests',
  '__tests__',
])

function copyRecursive(src, dest, skipNestedNodeModules = false) {
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      if (SKIP_DIR.has(name)) continue
      if (skipNestedNodeModules && name === 'node_modules') continue
      copyRecursive(path.join(src, name), path.join(dest, name), skipNestedNodeModules)
    }
  } else {
    let lastErr
    for (let i = 0; i < 8; i++) {
      try {
        fs.copyFileSync(src, dest)
        return
      } catch (err) {
        lastErr = err
        if (!err || (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'EBUSY')) throw err
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
      }
    }
    if (path.basename(src) === 'electron.exe') throw lastErr
    console.warn(`skip unreadable ${src}`)
  }
}

// Copy Electron runtime
const destExe = path.join(appDir, 'Resume Studio.exe')
for (const name of fs.readdirSync(electronDist)) {
  if (name === 'resources') continue
  const src = path.join(electronDist, name)
  const destName = name === 'electron.exe' ? 'Resume Studio.exe' : name
  try {
    if (name === 'electron.exe') {
      const tmpExe = path.join(root, 'artifacts', 'electron-runtime.exe')
      fs.mkdirSync(path.dirname(tmpExe), { recursive: true })
      if (!exeLooksComplete(tmpExe)) copyRecursive(src, tmpExe)
      copyRecursive(tmpExe, path.join(appDir, destName))
    } else {
      copyRecursive(src, path.join(appDir, destName))
    }
  } catch (err) {
    if (name !== 'electron.exe') throw err
    console.warn(`electron.exe copy failed (${err.code}); using previous portable exe`)
  }
}
function exeLooksComplete(file) {
  try {
    return fs.statSync(file).size > 1_000_000
  } catch {
    return false
  }
}
if (!exeLooksComplete(destExe)) {
  const fallbacks = [
    path.join(root, 'artifacts', 'electron-runtime.exe'),
    path.join(root, 'release', 'electron-runtime.exe'),
    path.join(root, 'release', 'portable.bak', 'Resume Studio', 'Resume Studio.exe'),
  ]
  const bakExe = fallbacks.find((p) => exeLooksComplete(p))
  if (!bakExe) throw new Error('Failed to copy electron.exe into the portable app.')
  copyRecursive(bakExe, destExe)
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

// Vite leaves these packages external in the CJS main bundle. Copy them (and
// their transitive deps) so the portable app can resolve require('zod') etc.
const RUNTIME_PACKAGES = [
  'zod',
  '@strands-agents/sdk',
  '@modelcontextprotocol/sdk',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-provider-ini',
  '@aws-sdk/client-bedrock-runtime',
  '@anthropic-ai/sdk',
  '@google/genai',
  'openai',
]

function resolvePackageDir(name, fromDir) {
  let dir = fromDir
  while (true) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'), 'package.json')
    if (fs.existsSync(candidate)) return path.dirname(candidate)
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function copyRuntimePackage(name, destNodeModules, fromDir, seen) {
  if (name === 'electron') return
  const src = resolvePackageDir(name, fromDir)
  if (!src) {
    console.warn(`skip missing runtime package ${name}`)
    return
  }
  if (seen.has(src)) return
  seen.add(src)
  const dest = path.join(destNodeModules, ...name.split('/'))
  copyRecursive(src, dest, true)
  const pkgJson = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'))
  const next = {
    ...pkgJson.dependencies,
    ...pkgJson.peerDependencies,
  }
  for (const dep of Object.keys(next)) {
    copyRuntimePackage(dep, destNodeModules, src, seen)
  }
}

const destNodeModules = path.join(appPayload, 'node_modules')
const copied = new Set()
for (const name of RUNTIME_PACKAGES) {
  copyRuntimePackage(name, destNodeModules, root, copied)
}
console.log(`Copied ${copied.size} runtime packages into portable node_modules`)

const { createRequire } = await import('node:module')
const { pathToFileURL } = await import('node:url')
const packedRequire = createRequire(path.join(appPayload, 'package.json'))
for (const name of ['zod', '@strands-agents/sdk', '@aws-sdk/client-sts']) {
  packedRequire.resolve(name)
}
packedRequire.resolve('@modelcontextprotocol/sdk/package.json')

function missingPackageName(err) {
  const text = String(err?.message || err)
  return text.match(/Cannot find package '([^']+)'/)?.[1] ?? null
}

const strandsEntry = path.join(
  destNodeModules,
  '@strands-agents',
  'sdk',
  'dist',
  'src',
  'index.node.js',
)
for (let attempt = 0; attempt < 15; attempt++) {
  try {
    await import(pathToFileURL(strandsEntry).href)
    break
  } catch (err) {
    const missing = missingPackageName(err)
    if (!missing) throw err
    console.warn(`packed import missing ${missing}; copying`)
    const before = copied.size
    copyRuntimePackage(missing, destNodeModules, root, copied)
    if (copied.size === before) throw err
  }
}

fs.writeFileSync(
  path.join(appDir, 'README.txt'),
  `Resume Studio ${version}
Free · NVIDIA included

1. Unzip this folder anywhere.
2. Run "Resume Studio.exe".
3. Open Settings. NVIDIA NIM is ready with no key. Or choose Ollama, or paste your own OpenAI, Anthropic, Gemini, or Bedrock key.
4. Open a workspace folder and start tailoring. Mail and WhatsApp desks are in the side panel.

Windows may warn about an unsigned app — choose More info → Run anyway.
`,
)

console.log(`Portable app ready: ${appDir}`)
console.log('Next: node scripts/make-zip.mjs')
