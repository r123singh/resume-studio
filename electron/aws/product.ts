/**
 * Defaults for the Bedrock provider. Calls use the access key and secret
 * saved in Settings, so any AWS account those keys belong to is allowed.
 */
export const PRODUCT_AWS = {
  profile: 'resume-studio',
  region: 'us-east-1',
} as const

export type ProductAwsSettings = {
  region?: string
  profile?: string
  /** When set, credential-chain calls must land in this account. */
  expectedAccountId?: string
}
