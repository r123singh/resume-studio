// Manual smoke test: node scripts/smoke-research.mjs <job-url>
// Compiles the research module on the fly and prints ranked evidence.
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const url = process.argv[2]
if (!url) {
  console.error('usage: node scripts/smoke-research.mjs <job-url>')
  process.exit(1)
}

const outDir = mkdtempSync(path.join(tmpdir(), 'rs-smoke-'))
const outFile = path.join(outDir, 'job-research.mjs')
await build({
  entryPoints: ['electron/job-research.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outFile,
  external: ['node:*'],
})

const mod = await import(pathToFileURL(outFile).href)
const ctx =
  url === '--paste'
    ? mod.contextFromPastedText(
        [
          'Senior Product Manager, AI Platform',
          'We are hiring a senior PM to own our AI platform roadmap.',
          '',
          'Responsibilities',
          '- Define the roadmap for LLM inference infrastructure used by 200+ internal teams.',
          '- Partner with ML engineering to ship evaluation tooling and guardrails.',
          '- Drive adoption metrics: latency, cost per request, and developer satisfaction.',
          '',
          'Requirements',
          '- 6+ years product management, 2+ in developer platforms or ML infrastructure.',
          '- Experience defining SLOs and running experiments at scale.',
          '- Strong written communication and stakeholder management.',
        ].join('\n'),
        6,
      )
    : await mod.fetchJobContext({ workspace: null, url, topK: 6 })

console.log('title  :', ctx.title)
console.log('company:', ctx.company)
console.log('pages  :', ctx.fetchedPages.map((p) => `${p.url} ${p.ok ? 'ok' : p.error}`).join('\n         '))
console.log('jobText chars:', ctx.jobText.length)
console.log('\n--- top evidence ---')
for (const s of ctx.snippets) {
  console.log(`\n${s.id} [${s.kind}] score=${s.score} ${s.sourceUrl}`)
  console.log(s.text.slice(0, 220).replace(/\n/g, ' '))
}

writeFileSync(path.join(outDir, 'context.json'), JSON.stringify(ctx, null, 2))
console.log('\nfull context written to', path.join(outDir, 'context.json'))
