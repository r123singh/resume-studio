# Resume Studio AI Platform — Architecture

This document covers deliverables A–G of the AI Backend Control Layer work: the
architecture that existed before the change, the target architecture, the API
contract, the data model, the security model, the billing model, and the
migration plan.

---

## A. Current architecture (before this change)

### Desktop application

Resume Studio is an Electron desktop app. There is no server component.

```
Renderer (React + Vite + Monaco)
    │  window.resumeStudio.*   (contextBridge, electron/preload.ts)
    ▼
Main process (electron/main.ts)
    │
    ├── Workspace file I/O, git, PDF export, job research
    └── AI: electron/agent/runner.ts
              │
              ├── runCompletion()  — single-shot + streaming
              └── runAgent()       — tool loop with resume-domain tools
                        │
                        ▼
              electron/agent/models.ts :: createModel(spec) → Strands `Model`
```

Every AI feature — tailoring, inline edit, interview prep, evidence-backed
rewrite, recruiter lens, agent mode — reaches the model through
`createModel()`. That single function is the seam this project builds on.

### Current AI layer

`createModel()` returns a `@strands-agents/sdk` `Model` per provider:

| Provider    | Implementation                                    | Tool loop |
| ----------- | ------------------------------------------------- | --------- |
| `nvidia`    | `OpenAIModel` with `baseURL` = NVIDIA NIM         | yes       |
| `openai`    | `OpenAIModel`                                      | yes       |
| `anthropic` | `AnthropicModel`                                   | yes       |
| `gemini`    | `GoogleModel`                                      | yes       |
| `bedrock`   | `BedrockModel`, local credentials                  | yes       |
| `cursor`    | custom `Model` wrapping `@cursor/sdk`              | no        |

`runner.ts` consumes the Strands stream event union
(`modelMessageStartEvent`, `modelContentBlockDeltaEvent`, …), which is a
near-exact mirror of the Bedrock Converse stream shape.

### Current AWS integration (the problem)

`bedrock` ran entirely on the user's machine:

- Model ID, region, temperature, and max tokens were chosen client-side.
- Credentials came from a Bedrock API key in local settings, or from a local
  AWS profile via `fromIni`.
- A prior hardening pass added `electron/aws/product.ts` and
  `electron/aws/guard.ts` to force a named profile and refuse known-forbidden
  accounts. That reduced blast radius but did not change the shape: **the
  desktop client still held AWS credentials and still decided what to call.**

There was no notion of a user, a plan, an entitlement, a quota, or usage.

### Current NVIDIA integration

NVIDIA NIM is OpenAI wire-compatible, so it rides `OpenAIModel` with a custom
base URL and the user's own free NIM key. This is the default free path and is
explicitly **out of scope** for the control plane.

### Current authentication

None. There are no accounts, sessions, or tokens anywhere in the product.

### Current storage

`settings.json` in Electron `userData`. Secrets are encrypted with Electron
`safeStorage`; everything else is plaintext JSON. This is per-machine, which is
precisely why subscription and usage cannot live here.

### Assessment

| Concern             | Before                            | Risk                             |
| ------------------- | --------------------------------- | -------------------------------- |
| AWS credentials     | on the client                     | key exfiltration, unbounded spend |
| Model selection     | client-side                       | needs an app release to change   |
| Identity            | none                              | no account, no multi-device      |
| Entitlement         | none                              | cannot gate or monetize          |
| Usage               | none                              | no cost attribution              |
| Billing             | none                              | no revenue path                  |

---

## B. Target architecture

```
                          ┌──────────────────────────────┐
                          │  Desktop App (Electron)      │
                          │  UI · editor · local state   │
                          └──────────────┬───────────────┘
                                         │
              ┌──────────────────────────┴──────────────────────────┐
              │                                                     │
     provider = nvidia/openai/…                          provider = managed
              │                                                     │
              ▼                                                     ▼
   ┌────────────────────┐                        ┌──────────────────────────────┐
   │ Direct vendor SDK  │                        │ ManagedModel (Strands Model) │
   │ UNCHANGED PATH     │                        │ electron/platform/*          │
   └────────────────────┘                        └───────────────┬──────────────┘
                                                                 │ HTTPS + Bearer JWT
                                                                 ▼
                                                ┌────────────────────────────────┐
                                                │  AI Backend Control Layer      │
                                                │  Lambda Function URL (stream)  │
                                                ├────────────────────────────────┤
                                                │ Authentication (JWT + refresh) │
                                                │            ▼                   │
                                                │ Authorization pipeline         │
                                                │  ├── account status            │
                                                │  ├── subscription state        │
                                                │  ├── entitlement / capability  │
                                                │  ├── usage quota               │
                                                │  └── rate limit                │
                                                │            ▼                   │
                                                │ Model Router (capability→model)│
                                                │            ▼                   │
                                                │ Bedrock Converse / ConverseStream
                                                │            ▼                   │
                                                │ Usage metering + cost estimate │
                                                └───────────────┬────────────────┘
                                                                ▼
                                                   ┌────────────────────────┐
                                                   │ DynamoDB single table  │
                                                   │ users · sessions ·     │
                                                   │ subscriptions · usage ·│
                                                   │ idempotency · billing  │
                                                   └────────────────────────┘
```

### The key decision

The desktop gains a new provider, `managed`, implemented as a Strands `Model`
that streams from the backend. Because the backend forwards Bedrock Converse
stream events and `ManagedModel` maps them 1:1 onto Strands events, the entire
existing product works through the control plane unchanged — including the
agent tool loop, streaming, prompts, and diff review.

`bedrock` is **kept** and relabelled "bring your own AWS account". It is the
self-host/developer path. Nothing that worked before stops working.

### Why Lambda Function URL instead of API Gateway

- Function URLs support **response streaming**; HTTP API does not. Streaming is
  an existing product behaviour and the brief requires preserving it.
- Function URLs have **no fixed cost**, which matters for an MVP with near-zero
  traffic. API Gateway is the documented scale-up path once WAF, custom
  domains, or usage plans are needed; nothing else in the design changes.

---

## C. API specification

Base URL: the Lambda Function URL, injected as `RESUME_STUDIO_API_URL`.
All responses are JSON. Errors use the envelope in section E.

| Method | Path                    | Auth    | Purpose                                  |
| ------ | ----------------------- | ------- | ---------------------------------------- |
| GET    | `/health`               | none    | Liveness                                 |
| POST   | `/auth/signup`          | none    | Create account, returns token pair       |
| POST   | `/auth/login`           | none    | Sign in on a device, returns token pair  |
| POST   | `/auth/refresh`         | refresh | Rotate refresh token, new access token   |
| POST   | `/auth/logout`          | access  | Revoke the current device session        |
| POST   | `/auth/logout-all`      | access  | Revoke every session for the account     |
| GET    | `/auth/sessions`        | access  | List active devices                      |
| GET    | `/account`              | access  | Identity + subscription + entitlements + usage |
| GET    | `/account/entitlements` | access  | Entitlements only                        |
| GET    | `/subscription`         | access  | Subscription only                        |
| GET    | `/usage`                | access  | Current period usage + recent requests   |
| GET    | `/models`               | access  | Logical capabilities available to the plan |
| POST   | `/ai/request`           | access  | Buffered AI request                      |
| POST   | `/ai/stream`            | access  | Streaming AI request (SSE)               |
| POST   | `/billing/webhook`      | signature | Billing provider events                |

### `POST /ai/request` and `/ai/stream`

```jsonc
{
  "request_id": "0d7c…",          // client-generated UUID, idempotency key
  "conversation_id": "conv_…",     // optional, groups turns
  "capability": "resume_edit",     // logical capability, NOT an AWS model id
  "system": "You are …",           // optional system prompt
  "messages": [ { "role": "user", "content": [ { "text": "…" } ] } ],
  "tools": [ { "name": "…", "description": "…", "inputSchema": { } } ],
  "params": { "temperature": 0.3, "maxTokens": 4096 },
  "metadata": { "client": "desktop", "clientVersion": "0.1.0" }
}
```

Buffered response:

```jsonc
{
  "request_id": "0d7c…",
  "capability": "resume_edit",
  "model": "anthropic.claude-3-5-sonnet",  // display label, not routing input
  "stop_reason": "end_turn",
  "content": [ { "text": "…" } ],
  "usage": { "input_tokens": 812, "output_tokens": 240 },
  "entitlement": { "requests_remaining": 1942, "period_end": "2026-09-01T00:00:00Z" }
}
```

`/ai/stream` returns `text/event-stream`. Each `data:` line is one JSON object:

- `{"type":"messageStart","role":"assistant"}`
- `{"type":"contentBlockStart","contentBlockIndex":0,"start":{"toolUse":{…}}}`
- `{"type":"contentBlockDelta","contentBlockIndex":0,"delta":{"text":"…"}}`
- `{"type":"contentBlockStop","contentBlockIndex":0}`
- `{"type":"messageStop","stopReason":"end_turn"}`
- `{"type":"metadata","usage":{…}}`
- `{"type":"platformDone","requestId":"…","model":"…","usage":{…},"entitlement":{…}}`
- `{"type":"platformError","code":"USAGE_LIMIT_REACHED","message":"…"}`

The first six are Bedrock Converse events passed through verbatim. The last two
are control-plane framing. `platformError` can arrive mid-stream, which is why
errors are also delivered in-band rather than only as HTTP status codes.

**The client never sends an AWS model identifier.** It sends a capability; the
backend decides the model. That is what makes model changes a backend
configuration change rather than a desktop release.

---

## D. Data model

One DynamoDB table, `pk`/`sk`, with `gsi1pk`/`gsi1sk` for billing lookups and
`ttl` for automatic expiry.

| Entity        | pk                  | sk                    | Notes                                   |
| ------------- | ------------------- | --------------------- | --------------------------------------- |
| User          | `USER#<userId>`     | `PROFILE`             | email, scrypt hash, status, timestamps  |
| Email index   | `EMAIL#<email>`     | `USER`                | conditional put enforces uniqueness     |
| Session       | `USER#<userId>`     | `SESSION#<sessionId>` | refresh hash, device, TTL, revokedAt    |
| Subscription  | `USER#<userId>`     | `SUBSCRIPTION`        | plan, status, period, billing refs; GSI1 by customer |
| Usage counter | `USER#<userId>`     | `USAGE#<period>`      | atomic `ADD` on requests/tokens/cost    |
| Usage record  | `USER#<userId>`     | `REQ#<requestId>`     | one per AI request, 90-day TTL          |
| Idempotency   | `USER#<userId>`     | `IDEM#<requestId>`    | 24-hour TTL, prevents double-charging   |
| Rate window   | `USER#<userId>`     | `RATE#<window>`       | atomic counter, short TTL               |
| Plan          | `PLAN#<planId>`     | `CONFIG`              | overrides the code-default catalog      |
| Routing       | `CONFIG#ROUTING`    | `CURRENT`             | capability→model policy, hot-swappable  |
| Feature flag  | `CONFIG#FLAGS`      | `CURRENT`             | server-controlled flags                 |
| Billing event | `BILLING#<eventId>` | `EVENT`               | webhook audit log, idempotent by id     |

Relationships:

```
User ─1:1─ Subscription ─N:1─ Plan ─1:1─ Entitlement (derived)
  │
  ├─1:N─ Session (device)
  ├─1:N─ UsageRecord ──rolls up──▶ UsageCounter (per period)
  └─1:N─ BillingEvent
```

Entitlements are **derived**, never stored: `plan + subscription status` is
evaluated on every request. That means a downgrade or a failed payment takes
effect immediately without a migration job.

---

## E. Security model

### Trust boundary

The desktop app is untrusted. It may be modified, decompiled, or replayed. The
backend re-derives every decision from server state and never accepts a
client-asserted plan, price, quota, model, or role.

### Credentials

- The desktop **never receives AWS credentials.** It holds only a short-lived
  access JWT and a refresh token.
- The Lambda execution role calls Bedrock via IAM, scoped by
  `bedrock:InvokeModel` / `InvokeModelWithResponseStream` on an explicit model
  allow-list. No long-lived keys exist anywhere in the system.
- The JWT signing secret and billing webhook secret live in Secrets Manager and
  are read once per cold start.

### Tokens

| Token   | Lifetime | Storage (desktop)             | Revocable |
| ------- | -------- | ----------------------------- | --------- |
| Access  | 15 min   | memory only                   | by expiry |
| Refresh | 30 days  | `safeStorage`-encrypted on disk | yes, immediately |

Refresh tokens are opaque 32-byte random values. Only a SHA-256 hash is stored
server-side, so a database leak cannot be replayed. Refresh **rotates** on every
use; presenting an already-rotated token revokes the whole session chain, which
is the standard reuse-detection response to token theft.

### Logging

Structured JSON with a redaction pass. Passwords, tokens, secrets, and resume
content are never logged. Message payloads are reduced to counts and lengths.
Every request carries a correlation ID returned to the client.

---

## F. Billing model

```
User ──▶ Subscription ──▶ Plan ──▶ { AI access, capabilities, quota, features }
```

Default catalog (code defaults, overridable per-plan in DynamoDB):

| Plan       | Requests / month | Capabilities                | Tier     |
| ---------- | ---------------- | --------------------------- | -------- |
| free       | 50               | edit, analysis              | standard |
| pro        | 2 000            | all except agent-heavy      | standard |
| premium    | 10 000           | all                         | advanced |
| enterprise | 100 000          | all                         | advanced |

Subscription states: `active`, `trialing`, `past_due` (grace period, access
retained), `canceled`, `expired`, `paused`. Access is granted for `active`,
`trialing`, and `past_due` within grace; everything else falls back to the free
plan rather than hard-failing, so a lapsed subscriber keeps a working product.

Billing provider integration sits behind a `BillingProvider` interface with
`verifyWebhook` and `parseEvent`. A `manual` implementation ships by default so
the platform runs end-to-end with no payment provider; Stripe or any other
provider becomes one file implementing the interface, with no change to the AI
layer.

Handled events: `subscription.created`, `subscription.updated`,
`subscription.canceled`, `payment.succeeded`, `payment.failed`. Every event is
recorded and de-duplicated by provider event ID.

Pricing lives in the backend model catalog only. The desktop never computes cost.

---

## G. Migration plan

The brief's ten phases, mapped to what actually shipped and what remains.

| Phase | Scope                              | Status |
| ----- | ---------------------------------- | ------ |
| 1 Understand | Map the existing AI architecture | done — section A |
| 2 Abstract   | Provider interface                | already existed as `createModel()`; reused rather than rebuilt |
| 3 Backend    | Control plane service             | done — `backend/` |
| 4 AWS        | Bedrock behind the backend        | done — `managed` provider |
| 5 Identity   | Authentication                    | done — JWT + rotating refresh + device sessions |
| 6 Entitlement| Plans and AI access control       | done — derived entitlements |
| 7 Usage      | Server-side metering              | done — idempotent, Bedrock-authoritative tokens |
| 8 Billing    | Provider integration              | interface + manual provider + webhook; concrete provider is a drop-in |
| 9 Desktop    | Account/usage/subscription UI     | done — Account panel in Settings |
| 10 Hardening | Security, limits, observability   | done — rate limits, redaction, correlation IDs, metrics |

### Why nothing breaks

1. `managed` is **additive**. Existing providers are untouched; the default
   provider is still NVIDIA.
2. `bedrock` is retained as the bring-your-own-AWS path.
3. Existing `settings.json` files load unchanged — the new fields are optional
   and default to empty.
4. The control plane is engaged only when a user explicitly selects the managed
   provider and signs in.

### Rollout

1. Deploy `aws/cloudformation/core.yaml` (IAM, budget), then
   `aws/cloudformation/platform.yaml` (table, Lambda, Function URL) to `dev`.
2. Set `RESUME_STUDIO_API_URL` in the desktop build for `dev`.
3. Dogfood the managed provider against the dev stack.
4. Deploy `prod` with separate table, secrets, and budget.
5. Ship the desktop build pointing at `prod`.

Rollback is selecting a different provider in Settings. No data migration is
involved in either direction.

---

## Environments

`dev`, `staging`, and `prod` are separate CloudFormation stacks with separate
tables, secrets, Lambda functions, and budgets. The environment name is part of
every resource name. No secret is ever committed; `.env` files are gitignored
and the deploy scripts read from Secrets Manager.
