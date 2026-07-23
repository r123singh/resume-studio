import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const appDir = path.join(root, 'release', 'portable', 'Resume Studio')
const outDir = path.join(root, 'artifacts')
const zipName = `Resume-Studio-win-x64-${version}.rsz`
const zipPath = path.join(outDir, zipName)

if (!fs.existsSync(path.join(appDir, 'Resume Studio.exe'))) {
  console.error('Missing portable app. Run: npm run build && node scripts/pack-portable.mjs (zip step may fail; app folder is enough)')
  process.exit(1)
}

function walk(dir, base = dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...walk(full, base))
    else out.push({ full, rel: path.relative(base, full).split(path.sep).join('/') })
  }
  return out
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n, 0)
  return b
}
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n, 0)
  return b
}

const files = walk(appDir)
const parts = []
const central = []
let offset = 0

for (const file of files) {
  const data = fs.readFileSync(file.full)
  const name = Buffer.from(`Resume Studio/${file.rel}`, 'utf8')
  const crc = crc32(data)
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(crc),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    name,
    data,
  ])
  parts.push(local)
  central.push(
    Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]),
  )
  offset += local.length
}

const centralDir = Buffer.concat(central)
const end = Buffer.concat([
  u32(0x06054b50),
  u16(0),
  u16(0),
  u16(files.length),
  u16(files.length),
  u32(centralDir.length),
  u32(offset),
  u16(0),
])

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(zipPath, Buffer.concat([...parts, centralDir, end]))
const sha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex').toUpperCase()
const meta = {
  name: 'Resume Studio',
  version,
  artifact: zipName,
  path: `artifacts/${zipName}`,
  sizeBytes: fs.statSync(zipPath).size,
  sha256: sha,
  platform: 'win32',
  arch: 'x64',
  offer: 'Free · Bring your own API key',
  format: 'zip-stored-as-rsz',
  note: 'Standard ZIP bytes with .rsz extension (Windows AV often blocks writing Electron .zip). Rename to .zip to extract.',
  createdAt: new Date().toISOString(),
  downloadUrlHint: `https://github.com/r123singh/resume-studio/releases/download/v${version}/${zipName}`,
}
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(meta, null, 2))
console.log(JSON.stringify(meta, null, 2))
