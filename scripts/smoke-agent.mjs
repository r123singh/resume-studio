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

async function bundle(entry, name) {
  const outfile = path.join(outDir, name)
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    external: ['@strands-agents/sdk', '@strands-agents/sdk/*', '@cursor/sdk', 'electron', 'zod'],
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
for (const provider of ['nvidia', 'groq', 'openai', 'anthropic', 'gemini', 'bedrock']) {
  const model = await createModel({
    provider,
    model: 'test-model',
    apiKey: 'test-key',
    region: 'us-east-1',
  })
  assert.ok(model, `${provider} model should construct`)
  assert.equal(supportsToolLoop(provider), true, `${provider} should support the tool loop`)
}
assert.equal(supportsToolLoop('cursor'), false, 'cursor cannot drive a tool loop')

console.log('OK — agent tools, safety rails, and model factory all behave.')
console.log(`  tools: ${Object.keys(byName).join(', ')}`)
console.log(`  tool events recorded: ${events.length}`)
console.log(`  proposals queued: ${proposals.length} (files written: 0)`)
