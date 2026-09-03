/**
 * Product-owned AWS environment. Bedrock must never fall through to the
 * machine default credential chain — that is how the app ended up calling a
 * third-party (work) account.
 */
export const PRODUCT_AWS = {
  profile: 'resume-studio',
  region: 'us-east-1',
  /**
   * Flytxt IAM user discovered on this machine (`ramandeep.singh@flytxt.com`).
   * Any Bedrock call that resolves to this account is rejected.
   */
  forbiddenAccountIds: ['493447423170'] as readonly string[],
} as const

export type ProductAwsSettings = {
  region?: string
  profile?: string
  /** When set, credential-chain calls must land in this account. */
  expectedAccountId?: string
}
