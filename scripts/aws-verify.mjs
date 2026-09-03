#!/usr/bin/env node
/**
 * Prove that Bedrock will NOT hit the third-party account, and that the
 * product profile (or a saved API key path) is what the app would use.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(readFileSync(join(root, 'aws', 'config.json'), 'utf8'))
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

let failed = 0
const say = (ok, msg) => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${msg}`)
  if (!ok) failed += 1
}

console.log('Default profile (must NOT be used by the app):')
try {
  const def = identity(undefined)
  const banned = cfg.forbiddenAccountIds.includes(def.Account)
  say(
    true,
    `default → ${def.Account} ${def.Arn}${banned ? '  [third-party — app will refuse this]' : ''}`,
  )
} catch (err) {
  say(true, `default profile not configured (${err instanceof Error ? err.message : err})`)
}

console.log(`\nProduct profile "${cfg.profile}":`)
try {
  const id = identity(cfg.profile)
  const banned = cfg.forbiddenAccountIds.includes(id.Account)
  say(!banned, `${id.Account} ${id.Arn}`)
  if (banned) {
    say(false, `profile "${cfg.profile}" still points at the forbidden work account`)
  }
  if (existsSync(localPath)) {
    const local = JSON.parse(readFileSync(localPath, 'utf8'))
    say(
      !local.accountId || local.accountId === id.Account,
      `matches aws/local.json account ${local.accountId || '(empty)'}`,
    )
  } else {
    console.log('info  aws/local.json missing — run npm run aws:bootstrap after creating the product account')
  }

  try {
    awsJson(
      ['bedrock', 'list-foundation-models', '--region', cfg.region],
      cfg.profile,
    )
    say(true, `bedrock list-foundation-models in ${cfg.region}`)
  } catch (err) {
    say(
      false,
      `Bedrock not reachable in ${cfg.region}. Enable model access in the product account. (${
        err instanceof Error ? err.message.split('\n')[0] : err
      })`,
    )
  }
} catch (err) {
  say(
    false,
    `profile "${cfg.profile}" is not configured. aws configure --profile ${cfg.profile} against the product account. (${
      err instanceof Error ? err.message.split('\n')[0] : err
    })`,
  )
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAWS environment looks ready for Resume Studio Bedrock.')
