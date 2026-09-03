#!/usr/bin/env node
/**
 * Deploys the AI control plane.
 *
 * Refuses to run against any account on the forbidden list before touching
 * anything, so a stray AWS profile cannot bill a third party.
 *
 *   node scripts/deploy-backend.mjs --env dev
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const awsConfig = JSON.parse(readFileSync(join(root, 'aws/config.json'), 'utf8'))

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const environment = flag('env', 'dev')
const profile = flag('profile', awsConfig.profile)
const region = flag('region', awsConfig.region)
const stackName = `resume-studio-${environment}-platform`

const aws = (...cliArgs) =>
  execFileSync('aws', [...cliArgs, '--profile', profile, '--region', region], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

console.log(`Deploying ${stackName} (profile=${profile}, region=${region})`)

let accountId
try {
  accountId = JSON.parse(aws('sts', 'get-caller-identity', '--output', 'json')).Account
} catch {
  fail(`Could not resolve AWS identity for profile "${profile}". Run: aws configure --profile ${profile}`)
}

const forbidden = awsConfig.forbiddenAccountIds ?? []
if (forbidden.includes(accountId)) {
  fail(
    `Refusing to deploy into account ${accountId}, which is on the forbidden list.\n` +
      `  This guard exists so Resume Studio never bills a third-party AWS account.`,
  )
}
console.log(`Target account: ${accountId}`)

console.log('\nBundling backend…')
execFileSync('npm', ['run', 'bundle'], {
  cwd: join(root, 'backend'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log('\nDeploying CloudFormation stack…')
execFileSync(
  'aws',
  [
    'cloudformation', 'deploy',
    '--template-file', join(root, 'aws/cloudformation/platform.yaml'),
    '--stack-name', stackName,
    '--capabilities', 'CAPABILITY_NAMED_IAM',
    '--parameter-overrides', `Environment=${environment}`, `BedrockRegion=${region}`,
    '--no-fail-on-empty-changeset',
    '--profile', profile,
    '--region', region,
  ],
  { stdio: 'inherit' },
)

const outputs = JSON.parse(
  aws(
    'cloudformation', 'describe-stacks',
    '--stack-name', stackName,
    '--query', 'Stacks[0].Outputs',
    '--output', 'json',
  ),
)
const output = (key) => outputs.find((entry) => entry.OutputKey === key)?.OutputValue

console.log('\nUploading function code…')
execFileSync(
  'aws',
  [
    'lambda', 'update-function-code',
    '--function-name', output('FunctionName'),
    '--zip-file', `fileb://${join(root, 'backend/dist-bundle/function.zip')}`,
    '--profile', profile,
    '--region', region,
  ],
  { stdio: 'inherit' },
)

console.log(`
Deployed.

  API URL   ${output('ApiUrl')}
  Table     ${output('TableName')}
  Secret    ${output('SecretArn')}

Point the desktop app at it:

  RESUME_STUDIO_API_URL=${output('ApiUrl')}
`)
