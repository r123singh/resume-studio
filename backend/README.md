# Resume Studio AI Backend Control Layer

The server-side control plane for the managed AWS AI option. It owns identity,
entitlements, usage metering, billing state, and model routing, and it is the
only component that holds AWS credentials.

The desktop app is a client. It never sees an AWS key, a model ID, or a price.

Architecture, API contract, data model, and migration plan are in
[`../docs/ai-platform.md`](../docs/ai-platform.md).

## Layout

```
src/
  lib/        errors, config, JWT, scrypt, logging, HTTP primitives
  data/       DynamoDB single-table repositories
  domain/     entitlements, model routing, authorization, billing, Bedrock
  handlers/   auth, account, ai, billing
  router.ts   route table + error envelope
  index.ts    Lambda entry (Function URL, response streaming)
test/         node:test suites, run against an in-memory store
```

## Local development

```bash
npm install
npm test          # compiles, then runs the full suite in-memory
npm run typecheck
```

Tests never touch AWS. `NODE_ENV=test` swaps the DynamoDB store for
`MemoryStore`, and `setBedrockInvoker()` injects a stub model, so the suite
exercises the real router, authorization pipeline, and metering logic.

## Deploy

From the repository root:

```bash
node scripts/deploy-backend.mjs --env dev
```

The script refuses to run against any account in `aws/config.json`'s
`forbiddenAccountIds` before it touches anything, then bundles with esbuild,
deploys `aws/cloudformation/platform.yaml`, and uploads the function code. It
prints the Function URL to set as `RESUME_STUDIO_API_URL` in the desktop build.

Each environment (`dev`, `staging`, `prod`) is a separate stack with its own
table, secret, function, and budget.

## Configuration

Non-sensitive settings are Lambda environment variables, set by the template:

| Variable                   | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `ENVIRONMENT`              | `dev` / `staging` / `prod`                 |
| `TABLE_NAME`               | DynamoDB single table                      |
| `PLATFORM_SECRET_ID`       | Secrets Manager ARN for signing keys        |
| `BEDROCK_REGION`           | Region for Converse calls                  |
| `BILLING_PROVIDER`         | `manual` by default                        |
| `RATE_LIMIT_PER_MINUTE`    | Global ceiling above the per-plan limit    |
| `MAX_REQUEST_BYTES`        | Payload cap for AI requests                |

Secrets — the JWT signing key and the billing webhook secret — live only in
Secrets Manager. The JWT key is generated in place by CloudFormation, so no
human ever handles it and it never passes through a parameter or shell history.

## Changing models without shipping the desktop app

Model choice is data. Write a `CONFIG#ROUTING` / `CURRENT` item with a
`routing` map of capability to an ordered list of model keys from
`MODEL_CATALOG`, and the change takes effect within a minute:

```json
{
  "pk": "CONFIG#ROUTING",
  "sk": "CURRENT",
  "routing": { "resume_rewrite": ["claude-sonnet", "claude-haiku"] }
}
```

Plan limits work the same way via `CONFIG#PLANS` items. Both fall back to the
code defaults when absent, so an empty table is a working system.

## Billing

`BillingProvider` has two methods: verify a webhook signature, and normalise the
payload. The shipped `manual` provider is HMAC-signed and takes an
already-normalised body, which is enough to run the platform end to end without
a payment account. Adding Stripe means one new implementation of that interface;
nothing in the AI path changes.
