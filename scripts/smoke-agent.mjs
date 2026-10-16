// Manual smoke test: node scripts/smoke-agent.mjs
// Exercises the Strands agent tool layer and model factory without any network
// calls or API keys. Verifies tool schemas, workspace path safety, and that
// propose_edit records a proposal instead of writing to disk.
import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// Must live inside the project so externalized packages resolve from node_modules.
const outDir = path.join(process.cwd(), 'node_modules', '.cache', 'rs-smoke-agent')
mkdirSync(outDir, { recursive: true })

const electronStub = path.join(outDir, 'electron-stub.mjs')
writeFileSync(
  electronStub,
  `export const app = { getPath: () => ${JSON.stringify(path.join(tmpdir(), 'rs-electron'))}, isPackaged: true }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(String(s)),
  decryptString: (b) => Buffer.from(b).toString('utf8'),
}
`,
  'utf8',
)

async function bundle(entry, name) {
  const outfile = path.join(outDir, name)
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    alias: { electron: electronStub },
    external: ['@strands-agents/sdk', '@strands-agents/sdk/*', 'zod'],
  })
  return import(pathToFileURL(outfile).href)
}

// A workspace that looks like a real resume project.
const ws = mkdtempSync(path.join(tmpdir(), 'rs-ws-'))
writeFileSync(
  path.join(ws, 'base-resume.md'),
  `# Jane Doe

## Experience
### Product Manager, Acme
- Shipped a billing revamp that cut churn 12%.

## Skills
- SQL, Figma
`,
  'utf8',
)
writeFileSync(path.join(ws, 'notes.txt'), 'Interviewed at Globex about payments.\n', 'utf8')

const { buildResumeTools } = await bundle('electron/agent/tools.ts', 'tools.mjs')

const events = []
const proposals = []
const tools = await buildResumeTools({
  workspace: ws,
  activeRelativePath: 'base-resume.md',
  allowWebResearch: false,
  proposals,
  onToolEvent: (e) => events.push(e),
})

const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
assert.deepEqual(
  Object.keys(byName).sort(),
  ['list_workspace_files', 'propose_edit', 'read_resume_file', 'research_job', 'search_workspace'],
  'expected the five resume-domain tools',
)

// list_workspace_files finds markdown and text, skips dotfiles.
const files = await byName.list_workspace_files.invoke({ subdirectory: '' })
assert.ok(files.includes('base-resume.md'), 'should list the base resume')
assert.ok(files.includes('notes.txt'), 'should list text notes')

// read_resume_file returns content.
const read = await byName.read_resume_file.invoke({ relativePath: 'base-resume.md' })
assert.match(read.content, /billing revamp/, 'should read resume content')

// Path traversal is rejected.
await assert.rejects(
  () => byName.read_resume_file.invoke({ relativePath: '../../../etc/passwd' }),
  /escapes the workspace/,
  'path traversal must be rejected',
)

// search_workspace finds a term across files.
const hits = await byName.search_workspace.invoke({ query: 'Globex' })
assert.ok(hits.length >= 1, 'should find the term in notes.txt')

// research_job refuses network access when the user has not opted in.
await assert.rejects(
  () => byName.research_job.invoke({ url: 'https://example.com/job', pastedText: '' }),
  /Web research is disabled/,
  'must respect the research opt-in',
)

// propose_edit records a proposal and does NOT write the file.
const before = readFileSync(path.join(ws, 'base-resume.md'), 'utf8')
const proposed = before.replace('SQL, Figma', 'SQL, Figma, Payments')
const result = await byName.propose_edit.invoke({
  relativePath: 'base-resume.md',
  newContent: proposed,
  rationale: 'Surface payments experience for the Globex role.',
  evidence: ['S1'],
})
assert.equal(result.accepted, true, 'proposal should be accepted')
assert.equal(proposals.length, 1, 'one proposal should be queued')
assert.equal(proposals[0].relativePath, 'base-resume.md')
assert.deepEqual(proposals[0].evidence, ['S1'])
assert.equal(
  readFileSync(path.join(ws, 'base-resume.md'), 'utf8'),
  before,
  'propose_edit must NOT write to disk — the user reviews a diff first',
)

// A no-op edit is rejected rather than queued.
const noop = await byName.propose_edit.invoke({
  relativePath: 'base-resume.md',
  newContent: before,
  rationale: 'no change',
  evidence: [],
})
assert.equal(noop.accepted, false, 'identical content should not queue a proposal')
assert.equal(proposals.length, 1, 'no extra proposal for a no-op')

// Tool activity was reported for the UI trail.
assert.ok(
  events.some((e) => e.name === 'read_resume_file' && e.status === 'ok'),
  'should emit tool events',
)
assert.ok(
  events.some((e) => e.status === 'error'),
  'should emit an error event for the rejected calls',
)

// Model factory builds providers without network or real keys.
const { createModel, supportsToolLoop } = await bundle('electron/agent/models.ts', 'models.mjs')
for (const provider of ['nvidia', 'ollama', 'openai', 'anthropic', 'gemini', 'bedrock']) {
  const model = await createModel({
    provider,
    model: 'test-model',
    apiKey: 'test-key',
    region: 'us-east-1',
    ...(provider === 'ollama' ? { baseURL: 'http://127.0.0.1:11434/v1' } : {}),
  })
  assert.ok(model, `${provider} model should construct`)
  assert.equal(supportsToolLoop(provider), true, `${provider} should support the tool loop`)
}

// Managed provider setting: no client model list, no API key, capability stands in for a model ID.
const {
  isManagedProvider,
  MODEL_OPTIONS,
  FREE_PROVIDERS,
  PAID_PROVIDERS,
  AGENT_CAPABLE_PROVIDERS,
} = await bundle('src/lib/ai/providers.ts', 'providers.mjs')
assert.equal(isManagedProvider('managed'), true)
assert.equal(isManagedProvider('nvidia'), false)
assert.deepEqual(MODEL_OPTIONS.managed, [], 'Settings must not offer a client-side model picker')
assert.equal(FREE_PROVIDERS.includes('managed'), false, 'managed is account-billed, not a free key')
assert.equal(PAID_PROVIDERS.includes('managed'), false, 'managed account is hidden from Settings')
assert.equal(AGENT_CAPABLE_PROVIDERS.includes('managed'), true)
assert.equal(supportsToolLoop('managed'), true)

const managed = await createModel({
  provider: 'managed',
  model: '',
  apiKey: '',
  capability: 'chat',
})
assert.ok(managed, 'managed model should construct without an API key')
assert.equal(
  managed.getConfig().modelId,
  'chat',
  'capability is what Settings sends instead of a model ID',
)

await assert.rejects(
  async () => {
    for await (const _ of managed.stream([{ role: 'user', content: [{ text: 'hello' }] }])) {
      // The constructor must not talk to the network; streaming is what requires a session.
    }
  },
  (err) => {
    assert.equal(err.name, 'PlatformError', 'managed failures stay in the platform error envelope')
    assert.ok(
      err.code === 'INVALID_REQUEST' || err.code === 'AUTHENTICATION_REQUIRED',
      `expected a configuration or sign-in error, got ${err.code}: ${err.message}`,
    )
    return true
  },
  'streaming without a signed-in account must fail closed',
)

console.log('OK — agent tools, safety rails, and model factory all behave.')
console.log(`  tools: ${Object.keys(byName).join(', ')}`)
console.log(`  tool events recorded: ${events.length}`)
console.log(`  proposals queued: ${proposals.length} (files written: 0)`)
console.log('  managed provider: constructs without API key, capability-routed, fails closed unsigned')
