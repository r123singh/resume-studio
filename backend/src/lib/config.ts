/**
 * Environment configuration.
 *
 * Secrets are resolved from Secrets Manager at cold start and cached for the
 * life of the execution environment. Plain environment variables carry only
 * non-sensitive configuration, so nothing here is safe-to-log by accident.
 */
import { internal } from './errors.js'

export type Environment = 'dev' | 'staging' | 'prod'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw internal(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  environment: (process.env.ENVIRONMENT || 'dev') as Environment,
  get tableName() {
    return required('TABLE_NAME')
  },
  get bedrockRegion() {
    return process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1'
  },
  /** Secrets Manager ARN/name holding `{ jwtSecret, billingWebhookSecret }`. */
  secretId: process.env.PLATFORM_SECRET_ID || '',
  billingProvider: (process.env.BILLING_PROVIDER || 'manual') as 'manual' | 'stripe',
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900),
  refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 30),
  /** Requests per minute per user across all AI endpoints. */
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 20),
  /** Simultaneous in-flight AI requests per user. */
  maxConcurrentRequests: Number(process.env.MAX_CONCURRENT_REQUESTS || 4),
  /** Hard ceiling on a single AI request payload. */
  maxRequestBytes: Number(process.env.MAX_REQUEST_BYTES || 512 * 1024),
  maxMessages: Number(process.env.MAX_MESSAGES || 80),
  usageRecordTtlDays: Number(process.env.USAGE_RECORD_TTL_DAYS || 90),
  isTest: process.env.NODE_ENV === 'test',
}

type PlatformSecrets = { jwtSecret: string; billingWebhookSecret: string }

let cached: Promise<PlatformSecrets> | null = null

/**
 * Loads signing secrets once per execution environment.
 *
 * Falls back to environment variables when no secret ID is configured, which is
 * what local development and the test suite use. Production always sets
 * `PLATFORM_SECRET_ID`.
 */
export function loadSecrets(): Promise<PlatformSecrets> {
  if (cached) return cached
  cached = (async () => {
    if (!config.secretId) {
      const jwtSecret = process.env.JWT_SECRET
      if (!jwtSecret) throw internal('Missing JWT_SECRET and PLATFORM_SECRET_ID.')
      return {
        jwtSecret,
        billingWebhookSecret: process.env.BILLING_WEBHOOK_SECRET || '',
      }
    }
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    )
    const client = new SecretsManagerClient({})
    const result = await client.send(new GetSecretValueCommand({ SecretId: config.secretId }))
    if (!result.SecretString) throw internal('Platform secret is empty.')
    const parsed = JSON.parse(result.SecretString) as Partial<PlatformSecrets>
    if (!parsed.jwtSecret) throw internal('Platform secret is missing jwtSecret.')
    return {
      jwtSecret: parsed.jwtSecret,
      billingWebhookSecret: parsed.billingWebhookSecret || '',
    }
  })()
  return cached
}

/** Test hook: drops the cached secret so a suite can swap credentials. */
export function resetSecretsCache(): void {
  cached = null
}
