#!/usr/bin/env node
/**
 * Probes Bedrock runtime invoke (Converse) with the product profile.
 *
 * When the console Playground also returns ValidationException:
 * "Operation not allowed", the block is account-level (model access / billing
 * hold), not Resume Studio code or IAM policy shape.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fromIni } from '@aws-sdk/credential-provider-ini'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(readFileSync(join(root, 'aws', 'config.json'), 'utf8'))
const region = cfg.region || 'us-east-1'
const profile = cfg.profile || 'resume-studio'

const backendSdk = join(root, 'backend', 'node_modules', '@aws-sdk', 'client-bedrock-runtime', 'dist-cjs', 'index.js')
const { BedrockRuntimeClient, ConverseCommand } = await import(pathToFileURL(backendSdk).href)

const credentials = fromIni({ profile })

const say = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log(`Profile: ${profile}  Region: ${region}\n`)

let accountHint = ''
try {
  const stsPath = join(root, 'backend', 'node_modules', '@aws-sdk', 'client-sts', 'dist-cjs', 'index.js')
  const { STSClient, GetCallerIdentityCommand } = await import(pathToFileURL(stsPath).href)
  const sts = new STSClient({ region, credentials })
  const id = await sts.send(new GetCallerIdentityCommand({}))
  accountHint = id.Account || ''
  const banned = cfg.forbiddenAccountIds?.includes(id.Account)
  say('Caller identity', !banned, `${id.Account} ${id.Arn}`)
  if (banned) {
    console.error('\nThis is the forbidden work account. Use the product account from aws/README.md.')
    process.exit(1)
  }
} catch {
  console.log('info  Could not load STS client; run: aws sts get-caller-identity --profile', profile)
}

const models = [
  { label: 'Nova Lite (foundation)', modelId: 'amazon.nova-lite-v1:0' },
  { label: 'Nova Lite (US profile)', modelId: 'us.amazon.nova-lite-v1:0' },
]

const client = new BedrockRuntimeClient({ region, credentials })
let blocked = 0

for (const { label, modelId } of models) {
  try {
    const out = await client.send(
      new ConverseCommand({
        modelId,
        messages: [{ role: 'user', content: [{ text: 'Reply with exactly: nova-ok' }] }],
        inferenceConfig: { maxTokens: 16, temperature: 0 },
      }),
    )
    const text = (out.output?.message?.content ?? [])
      .map((b) => b.text)
      .filter(Boolean)
      .join('')
    say(`Converse ${label}`, true, `${modelId} → ${JSON.stringify(text.slice(0, 60))}`)
  } catch (err) {
    blocked += 1
    const name = err?.name || 'Error'
    const msg = err?.message || String(err)
    say(`Converse ${label}`, false, `${modelId} → ${name}: ${msg.split('\n')[0]}`)
  }
}

if (blocked === models.length) {
  console.log(`
Diagnosis (Playground + CLI both fail the same way):
  • IAM on raman-admin is not the usual cause when EVERY model fails in Playground.
  • Bedrock control plane (list models) may work while runtime invoke is blocked.
  • Fix is in AWS Console / Support for account ${accountHint || '(your product account)'}:

  1. Billing → Payment methods: valid card on file (credits alone often are not enough).
  2. Bedrock (us-east-1) → Model access / catalog: enable Nova Lite; complete Anthropic use case if needed.
  3. If still blocked: Support Center → Create case → Account and billing (Basic plan OK).
     Subject: "Bedrock ValidationException Operation not allowed on all models"
     Paste this script output and note Playground fails in us-east-1.

See aws/bedrock-unblock-support-case.md for a full case template.
`)
  process.exit(1)
}

console.log('\nBedrock runtime invoke works for at least one Nova Lite id.')
