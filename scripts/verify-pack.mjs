import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = [
  path.join(root, 'artifacts', 'staging', 'Resume Studio', 'resources', 'app'),
  path.join(root, 'release', 'portable', 'Resume Studio', 'resources', 'app'),
].find((dir) => fs.existsSync(dir))
if (!app) throw new Error('Packed app not found. Run node scripts/pack-portable.mjs')
const require = createRequire(path.join(app, 'package.json'))
const names = [
  'zod',
  '@strands-agents/sdk',
  '@strands-agents/sdk/models/openai',
  '@strands-agents/sdk/models/anthropic',
  '@strands-agents/sdk/models/google',
  '@modelcontextprotocol/sdk/package.json',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-provider-ini',
  'openai',
  '@anthropic-ai/sdk',
  '@google/genai',
]
for (const name of names) {
  require.resolve(name)
  console.log('ok', name)
}

const strandsEntry = path.join(
  app,
  'node_modules',
  '@strands-agents',
  'sdk',
  'dist',
  'src',
  'index.node.js',
)
await import(pathToFileURL(strandsEntry).href)
console.log('ok import @strands-agents/sdk (node entry)')
