import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const unpacked = path.join(root, 'release', 'win-unpacked')
const outDir = path.join(root, 'release', 'dist')
const zipName = `Resume-Studio-win-x64-${version}.zip`
const zipPath = path.join(outDir, zipName)

if (!fs.existsSync(unpacked)) {
  console.error('Missing release/win-unpacked. Run npm run pack:dir first.')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

const ps = `
$ErrorActionPreference = 'Stop'
Compress-Archive -Path '${unpacked.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force
`

execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })

const stat = fs.statSync(zipPath)
const sha = execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `(Get-FileHash -Algorithm SHA256 '${zipPath.replace(/'/g, "''")}').Hash`,
], { encoding: 'utf8' }).trim()

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
}

fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(meta, null, 2))
console.log(`Wrote ${zipPath}`)
console.log(`SHA256 ${sha}`)
console.log(`Meta release/dist/latest.json`)
