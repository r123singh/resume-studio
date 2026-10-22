import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = path.join(root, 'release', 'portable', 'Resume Studio', 'resources', 'app')
const require = createRequire(path.join(app, 'package.json'))
const names = [
  'zod',
  '@strands-agents/sdk',
  '@strands-agents/sdk/models/openai',
  '@strands-agents/sdk/models/anthropic',
  '@strands-agents/sdk/models/google',
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
