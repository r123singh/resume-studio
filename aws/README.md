# Resume Studio AWS environment

The desktop app is local-first. NVIDIA NIM stays the default. Amazon Bedrock is optional, but when it is used it must run in an **AWS account this product owns**.

It must not use the machine default AWS profile. On this workstation that profile is a Flytxt IAM user (`arn:aws:iam::493447423170:user/ramandeep.singh@flytxt.com`). The app and these scripts refuse that account.

## Architecture (now)

```
Resume Studio (Electron, user's PC)
        │
        ├─ NVIDIA / OpenAI / Anthropic / Gemini  → vendor APIs (BYOK)
        │
        └─ Amazon Bedrock
               ├─ Bedrock long-term API key  (Settings)     → product account
               └─ AWS profile `resume-studio` (never default) → product account
                      IAM user resume-studio-dev-desktop
                      policy: InvokeModel + InvokeModelWithResponseStream only
```

Website hosting stays on Vercel. Traffic is near zero; moving the marketing site to CloudFront would add cost without changing the AI dependency. A private S3 artifacts bucket is created so releases can move off GitHub later without a new IAM design.

## Architecture (later, no rewrite)

When there are enough users to justify a backend:

1. Put API Gateway + Lambda in front of Bedrock.
2. Attach the already-created role `resume-studio-<env>-api` (same Bedrock policy).
3. The desktop app calls that API instead of Bedrock directly. IAM does not change.

Until then, do not run ECS, RDS, or a NAT gateway.

## Cost

| Resource | Typical idle cost |
| --- | --- |
| IAM user / role / policy | $0 |
| S3 bucket (empty, versioned) | $0 |
| AWS Budget | $0 |
| Bedrock | pay-per-token, only when you run a model |
| Monthly alarm | email at 80% and 100% of $20 (parameter) |

## Cutover

### 1. Create a product AWS account

Use your own email, not the Flytxt one. Enable MFA on the root user. Create an admin IAM user for yourself in **that** account.

### 2. Point a dedicated profile at it

```powershell
aws configure --profile resume-studio
# AWS Access Key ID / Secret from the product account admin (or SSO)
# Default region: us-east-1
```

Confirm you left the work account:

```powershell
aws sts get-caller-identity --profile resume-studio
# Account must NOT be 493447423170
```

### 3. Deploy the stack

```powershell
cd D:\MyProjects\resume-studio
npm run aws:bootstrap -- your@email.com
```

This deploys `aws/cloudformation/core.yaml` as `resume-studio-core-dev` and writes `aws/local.json` (gitignored). Confirm the budget email.

### 4. Enable models

Amazon Bedrock console (region `us-east-1`) → **Model access** → enable at least:

- Anthropic Claude Haiku 4.5 / Sonnet 4.6 (global inference profiles)
- Amazon Nova Lite / Pro
- Meta Llama 3.3 70B instruct

### 5. Give the desktop credentials

Preferred: Bedrock console → **API keys** → long-term key for IAM user `resume-studio-dev-desktop`. Paste it into Resume Studio **Settings → Bedrock API key**.

Alternative: create access keys for that IAM user and put them in `~/.aws/credentials` under `[resume-studio]`. Leave the Bedrock API key blank in Settings.

### 6. Pin the account in the app

Settings:

- Provider: Amazon Bedrock
- AWS region: `us-east-1`
- AWS profile: `resume-studio`
- Expected AWS account ID: the 12-digit id printed by bootstrap

### 7. Verify

```powershell
npm run aws:verify
```

Then in the app, run one short Edit-tab prompt. If the profile still points at Flytxt, the app throws instead of billing that account.

## Environments

| Stack | Parameter `Environment` | IAM user |
| --- | --- | --- |
| `resume-studio-core-dev` | `dev` | `resume-studio-dev-desktop` |
| `resume-studio-core-prod` | `prod` | `resume-studio-prod-desktop` |

Use `RS_ENV=prod npm run aws:bootstrap -- you@email.com` for prod. One AWS account is enough until there is real traffic; the names keep IAM tidy.

## What this repo will not do

- Deploy into account `493447423170`
- Use AWS profile `default`
- Embed AWS keys in the packaged desktop app
- Create a Bedrock key for you (console-only / IAM-only)
