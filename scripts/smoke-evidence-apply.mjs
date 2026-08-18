// Manual smoke test: node scripts/smoke-evidence-apply.mjs
// Verifies parsing a model response and deterministically applying suggestions.
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(path.join(tmpdir(), 'rs-ev-'))
const outFile = path.join(outDir, 'evidence.mjs')
await build({
  entryPoints: ['src/lib/ai/evidence.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outFile,
})
const ev = await import(pathToFileURL(outFile).href)

const resume = `# Jane Doe

## Experience

### Product Manager, Acme
- Shipped a billing revamp that cut churn 12%.
- Ran weekly syncs with engineering.

## Skills
- SQL, Figma
`

const modelResponse = '```json\n' + JSON.stringify({
  note: 'Lead with platform + measurable adoption.',
  atsFit: 78,
  suggestions: [
    {
      id: 'b1',
      section: 'Experience',
      target: '- Ran weekly syncs with engineering.',
      text: '- Partnered with ML engineering to ship evaluation tooling used by 200+ teams.',
      evidence: ['S1', 'S2'],
      rationale: 'S1 asks for partnership with ML engineering; S2 lists platform scale.',
    },
    {
      id: 'b2',
      section: 'Skills',
      target: '',
      text: '- Experimentation, SLOs',
      evidence: ['S2'],
      rationale: 'S2 requires SLO definition.',
    },
    {
      id: 'b3',
      section: 'Experience',
      target: '- This line does not exist in the resume.',
      text: '- Should be skipped.',
      evidence: ['S1'],
      rationale: 'stale target',
    },
    {
      id: 'b4',
      section: 'Experience',
      target: '',
      text: '- Uncited claim that should default to unchecked.',
      evidence: [],
      rationale: '',
    },
  ],
}, null, 2) + '\n```'

const parsed = ev.parseEvidenceResponse(modelResponse)
assert.equal(parsed.atsFit, 78)
assert.equal(parsed.suggestions.length, 4)
assert.equal(parsed.suggestions[3].accepted, false, 'uncited suggestion must default to unchecked')
assert.equal(parsed.suggestions[0].accepted, true)

const result = ev.applyEvidenceSuggestions(resume, parsed.suggestions)
assert.equal(result.applied, 2, `expected 2 applied, got ${result.applied}`)
assert.equal(result.skipped.length, 1, 'stale target must be skipped, not silently dropped')
assert.ok(result.content.includes('Partnered with ML engineering'), 'replacement missing')
assert.ok(!result.content.includes('Ran weekly syncs'), 'old bullet still present')
assert.ok(result.content.includes('- Experimentation, SLOs'), 'skills insert missing')
assert.ok(!result.content.includes('Should be skipped'), 'stale suggestion was applied')
assert.ok(!result.content.includes('Uncited claim'), 'unchecked suggestion was applied')

const partial = ev.extractPartialBullets('{"suggestions":[{"text":"- Led platform work","evi')
assert.deepEqual(partial, ['- Led platform work'])

const malformed = ev.parseEvidenceResponse('Sorry, I cannot do that.')
assert.equal(malformed.suggestions.length, 0)

console.log('parse + apply OK')
console.log('\n--- resulting resume ---\n')
console.log(result.content)
