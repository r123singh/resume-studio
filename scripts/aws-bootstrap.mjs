#!/usr/bin/env node
/**
 * Deploy Resume Studio's product AWS stack.
 *
 * Hard rule: abort if the current credentials belong to a forbidden
 * (third-party/work) account. You must `aws configure --profile resume-studio`
 * against a product-owned account first.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(readFileSync(join(root, 'aws', 'config.json'), 'utf8'))
const template = join(root, 'aws', 'cloudformation', 'core.yaml')
const localPath = join(root, 'aws', 'local.json')

function awsJson(args, profile) {
  const extra = profile ? ['--profile', profile] : []
  const out = execFileSync('aws', [...args, ...extra, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out)
}

function identity(profile) {
  return awsJson(['sts', 'get-caller-identity'], profile)
}

function die(msg) {
  console.error(`\nERROR: ${msg}\n`)
  process.exit(1)
}

const profile = process.env.AWS_PROFILE || cfg.profile
const region = process.env.AWS_REGION || cfg.region
const envName = process.env.RS_ENV || cfg.environment
const email = process.env.RS_ALERT_EMAIL || process.argv[2]
const budget = process.env.RS_BUDGET_USD || '20'

if (!email || !email.includes('@')) {
  die(
    'Pass a budget alert email: node scripts/aws-bootstrap.mjs you@example.com\n' +
      'Or set RS_ALERT_EMAIL. This deploys into whatever account profile "' +
      profile +
      '" points at.',
  )
}

let id
try {
  id = identity(profile)
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err)
  die(
    `AWS profile "${profile}" is not configured.\n` +
      `1. Create a Resume Studio AWS account (do NOT use Flytxt/work).\n` +
      `2. aws configure --profile ${profile}\n` +
      `3. Enable Bedrock model access in ${region}.\n` +
      `(${detail})`,
  )
}

if (cfg.forbiddenAccountIds.includes(id.Account)) {
  die(
    `Refusing to deploy into AWS account ${id.Account} (${id.Arn}).\n` +
      `That is the third-party/work environment (${cfg.forbiddenAccountNote}).\n` +
      `Create a product-owned account, then:\n` +
      `  aws configure --profile ${profile}\n` +
      `  npm run aws:bootstrap -- you@example.com`,
  )
}

if (!profile || profile === 'default') {
  die(`Refusing to use the default AWS profile. Use "${cfg.profile}".`)
}

const stack = `${cfg.stackName}-${envName}`
console.log(`Deploying ${stack} to account ${id.Account} (${region}) as ${id.Arn}`)

execFileSync(
  'aws',
  [
    'cloudformation',
    'deploy',
    '--stack-name',
    stack,
    '--template-file',
    template,
    '--capabilities',
    'CAPABILITY_NAMED_IAM',
    '--region',
    region,
    '--profile',
    profile,
    '--parameter-overrides',
    `Environment=${envName}`,
    `AlertEmail=${email}`,
    `MonthlyBudgetUsd=${budget}`,
  ],
  { stdio: 'inherit' },
)

const outputs = awsJson(
  ['cloudformation', 'describe-stacks', '--stack-name', stack, '--region', region],
  profile,
)
const stackOut = Object.fromEntries(
  (outputs.Stacks?.[0]?.Outputs || []).map((o) => [o.OutputKey, o.OutputValue]),
)

writeFileSync(
  localPath,
  `${JSON.stringify(
    {
      accountId: id.Account,
      region,
      profile,
      environment: envName,
      stack,
      outputs: stackOut,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)

console.log(`
Done.

Account:     ${id.Account}
Desktop user: ${stackOut.DesktopUserName || '(see stack outputs)'}
Artifacts:    ${stackOut.ArtifactsBucketName || ''}

Next:
1. Confirm the budget email subscription.
2. Bedrock console → Model access → enable Claude Haiku/Sonnet, Nova, Llama (region ${region}).
3. Bedrock console → API keys → create a long-term key for ${stackOut.DesktopUserName}.
   Paste it into Resume Studio Settings (Bedrock API key).
   Or create IAM access keys for that user and put them in ~/.aws/credentials under [${profile}].
4. Settings → Expected AWS account ID → ${id.Account}
5. npm run aws:verify
`)
