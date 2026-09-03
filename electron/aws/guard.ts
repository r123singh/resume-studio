import { PRODUCT_AWS } from './product'

export type AwsIdentity = {
  account: string
  arn: string
  userId: string
}

function fail(message: string): never {
  throw new Error(message)
}

/**
 * Resolves the caller and refuses blocked accounts. Used before constructing
 * a Bedrock model so a work login cannot be billed by accident.
 *
 * Preferred path: Access Key ID + Secret Access Key from Settings (same as
 * Cursor's Bedrock panel). Named profiles remain a fallback only.
 */
export async function assertProductAwsIdentity(args: {
  region: string
  accessKeyId?: string
  secretAccessKey?: string
  profile?: string
  expectedAccountId?: string
}): Promise<AwsIdentity> {
  const region = args.region || PRODUCT_AWS.region
  const accessKeyId = args.accessKeyId?.trim()
  const secretAccessKey = args.secretAccessKey?.trim()

  let credentials: { accessKeyId: string; secretAccessKey: string }

  if (accessKeyId && secretAccessKey) {
    credentials = { accessKeyId, secretAccessKey }
  } else {
    const profile = (args.profile || '').trim()
    if (!profile || profile === 'default') {
      fail(
        'Missing AWS Access Key ID or Secret Access Key. Open Settings → Bedrock to add them.',
      )
    }
    const { fromIni } = await import('@aws-sdk/credential-provider-ini')
    const resolved = await fromIni({ profile })()
    if (!resolved?.accessKeyId || !resolved.secretAccessKey) {
      fail(
        'Missing AWS Access Key ID or Secret Access Key. Open Settings → Bedrock to add them.',
      )
    }
    credentials = {
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
    }
  }

  const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts')
  const client = new STSClient({ region, credentials })

  let identity: AwsIdentity
  try {
    const out = await client.send(new GetCallerIdentityCommand({}))
    identity = {
      account: String(out.Account || ''),
      arn: String(out.Arn || ''),
      userId: String(out.UserId || ''),
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    fail(
      `Could not verify those AWS keys. Check the Access Key ID, Secret Access Key, and region. (${detail})`,
    )
  }

  if (!identity.account) {
    fail('Those AWS keys did not return an account id.')
  }

  if (PRODUCT_AWS.forbiddenAccountIds.includes(identity.account)) {
    fail(
      `Refusing to call AWS account ${identity.account}. Use keys from your own Bedrock account.`,
    )
  }

  const expected = args.expectedAccountId?.trim()
  if (expected && identity.account !== expected) {
    fail(
      `Those AWS keys belong to account ${identity.account}, but Settings expects ${expected}.`,
    )
  }

  return identity
}
