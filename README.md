# Resume Studio

Cursor-like AI editor for **resume tailoring** on Windows. Open a workspace, edit markdown resumes, paste a job description to generate a tailored file, refine with chat, and export PDF.

The AI layer runs on the **AWS Strands Agents SDK** (`@strands-agents/sdk`), so every model call — single-shot or agentic — goes through one framework. **NVIDIA NIM** (free) or **Cursor SDK** remain the defaults; Amazon Bedrock, OpenAI, Anthropic, and Gemini are optional. Keys are stored encrypted locally via Electron `safeStorage`.

## Features (v1)

- Three-pane layout: file explorer | Monaco editor | AI chat
- Workspace with `base-resume.md` + `resumes/`
- **Tailor from JD** → writes `resumes/{company}--{role}.md`
- **Edit open file** chat (full rewrite or selection replace)
- **Export PDF** via Chromium print-to-PDF
- Free providers: NVIDIA NIM + Cursor SDK; paid providers optional
- **Apply kit** → `apply-kits/{company}--{role}/` with resume PDF, cover letter, form snippets, checklist + `applications.csv` log
- **Tracker** tab → filter applications, mark applied/skipped, open job URL or kit folder
- **Hunt** tab → search RemoteOK + Remotive, rank vs `job-preferences.md`, prepare selected → tailor + apply kit
- **Interview prep** → from open tailored resume or Tracker row → `interview-prep/{company}--{role}.md`
- **Recruiter Lens** → Edit / ATS / Recruiter scan modes + 6-second skim preview with keyword + hierarchy feedback
- **Command palette** → `Ctrl+Shift+P` commands, `Ctrl+P` go to file, section jump, `/` workspace search
- **Monaco diagnostics** → Recruiter Lens issues as editor markers in Edit mode
- **Role variants** → Roles tab: Frontend / Backend / Product variants under `variants/`
- **Achievement builder** → structured Action + Metric + Impact + Tool bullets (`Ctrl+Shift+A`)
- **Git lite** → status, diff preview, commit (`Ctrl+Shift+G`); no embedded terminal
- **AI safety** → streaming + live progress, diff confirm before large/tailor writes, context budget retrieval, provider/model attribution, privacy toggles, thumbs feedback (`.ai-feedback.jsonl`)
- **Evidence-Backed Tailor** → Evidence tab (`Ctrl+Shift+E`): research a job URL, cite the snippets behind every suggested bullet, accept per bullet, apply atomically with an optional commit
- **Agent mode (Strands)** → the model reads your files, searches the workspace, researches the job, and proposes edits with a visible tool trail

## Agent mode (AWS Strands)

The whole LLM layer runs on the [Strands Agents TypeScript SDK](https://strandsagents.com). Turn on
**Agent mode** in Settings and the Edit tab stops being a single prompt: the model plans, calls tools,
and reports what it did.

Tools available to the agent, all scoped to your workspace:

| Tool | What it does |
| --- | --- |
| `list_workspace_files` | Discover the base resume, variants, and apply kits |
| `read_resume_file` | Read a markdown file before changing it |
| `search_workspace` | Find where a skill or employer is already mentioned |
| `research_job` | Fetch a posting and rank evidence snippets (needs the research opt-in) |
| `propose_edit` | Queue a rewrite for review — **never writes to disk** |

Safety rails, which is why agent mode is safe to leave on:

- `propose_edit` records a proposal; the file only changes after you accept the diff.
- Tool paths are resolved against the workspace root, so path traversal is rejected.
- `research_job` refuses network access unless you enabled web research.
- Every run is capped at 12 turns and ~120k tokens, so a confused loop cannot burn your quota.
- The system prompt forbids inventing employers, titles, dates, or metrics.
- Runs are appended to `.resume-studio/ai-audit.jsonl` with the tools called and the stop reason.

Cursor is the one provider that cannot run agent mode: its SDK returns finished text with no
tool-call channel. Resume Studio AI, Bedrock, NVIDIA, OpenAI, Anthropic, and Gemini all work.

## AI providers

There are three shapes of provider, and picking one is the only decision:

| Provider | Credential | Who owns cost and limits |
| --- | --- | --- |
| **NVIDIA NIM** (default, free) | your free NIM key, stored locally | you |
| **Resume Studio AI** (`managed`) | sign in with an account | the backend |
| OpenAI / Anthropic / Gemini / Bedrock | your own key or AWS profile | you |

### Resume Studio AI (managed)

The account-based option. Sign in once and your plan, entitlements, usage, and
model access follow the account rather than the machine — install on a second
computer, sign in, and the same subscription is there.

The desktop app never receives AWS credentials. It sends a *capability*
(`resume_edit`, `resume_rewrite`, `agent`, …) to the
[AI Backend Control Layer](backend/README.md), which authenticates the user,
checks entitlement and quota, picks the model, calls Bedrock, and meters the
result. Because model choice lives in the backend, models can be upgraded
without shipping a new desktop build.

Streaming and agent mode work exactly as they do on every other provider: the
backend forwards Bedrock Converse events end to end.

To enable it, deploy the control plane and point the build at it:

```bash
node scripts/deploy-backend.mjs --env dev
# then set RESUME_STUDIO_API_URL to the printed Function URL
```

Architecture, API contract, data model, security model, and migration plan:
[`docs/ai-platform.md`](docs/ai-platform.md).

### Amazon Bedrock (bring your own AWS account)

The self-hosting path, kept for users who want to run Bedrock on their own
infrastructure. Unlike the managed option, this one *does* use local AWS
credentials, so it must run in a **Resume Studio–owned AWS account**.
The app will not use your machine default AWS profile (on this workstation that is a Flytxt
IAM user) and will refuse account `493447423170`.

1. Create a product AWS account and `aws configure --profile resume-studio`.
2. `npm run aws:bootstrap -- you@email.com` deploys least-privilege IAM, a $20 budget alarm, and a private artifacts bucket.
3. Enable model access in `us-east-1`, then paste a Bedrock API key in Settings **or** leave the key blank to use profile `resume-studio`.
4. Set **Expected AWS account ID** to the product account.

Full cutover: [`aws/README.md`](aws/README.md).

Verify without spending tokens:

```bash
npm run smoke:agent
npm run aws:verify
npm run backend:test   # control plane suite, fully in-memory, no AWS calls
```

## Evidence-Backed Tailor

Open the **Evidence** tab (or `Ctrl+Shift+E`), paste a job URL, and click **Research job**. Resume
Studio fetches the posting plus a few company pages in the Electron main process (no CORS, no
browser extension), strips navigation chrome, and splits the result into numbered snippets
`S1…Sn`. Snippets are ranked against the job text with local TF-IDF cosine similarity, so retrieval
costs nothing and never leaves the machine.

**Tailor with Evidence** then asks the model to rewrite bullets and cite which snippets justify each
one. Suggestions arrive as streaming ghost text in Monaco (Accept / Ignore in the editor header) and
as a checklist in the panel, where each bullet shows its evidence badges, the source link, and the
model's rationale. Bullets with no citation are flagged. **Preview diff** applies only the checked
suggestions, shows the annotated diff, and can commit the result in one step.

Notes and limits:

- Web research is **opt-in** — enable it in Settings or from the panel. Nothing is fetched until you do.
- Sites with bot protection return HTTP 403. Use **Paste job text instead**; pasted text is processed
  locally and needs no opt-in.
- Fetched pages are cached for 24h in `.resume-studio/evidence-cache.json`; **Refresh** bypasses it.
- Every run appends provider, model, job URL, evidence citations, and a prompt snapshot to
  `.resume-studio/ai-audit.jsonl`.
- The model may only re-word facts already in your resume; evidence describes what the employer wants,
  it is never a source of new claims about you.

## Prerequisites (development)

- Node.js 20+
- Windows 10/11
- An API key from [build.nvidia.com](https://build.nvidia.com) (recommended) and/or a Cursor API key
- Optional: OpenAI / Anthropic / Gemini keys

## Develop

```powershell
cd D:\MyProjects\resume-studio
npm install
npm run dev
```

> If `npm install` fails with DNS/`ENOTFOUND`, fix local DNS (e.g. use `8.8.8.8`) or retry on a stable network, then install again.

`npm run dev` starts Vite + Electron together (via `vite-plugin-electron`).

## First-run flow

1. Launch the app → **Settings**:
   - Default: **NVIDIA NIM** — get a free key at [build.nvidia.com](https://build.nvidia.com)
   - Or **Cursor SDK** — paste your `CURSOR_API_KEY` / service account key
   - Optional: expand paid providers (OpenAI / Anthropic / Gemini)
2. **Open workspace folder** (new or existing). The app creates `base-resume.md` and `resumes/` if missing.
3. Paste your master resume into `base-resume.md` and Save (`Ctrl+S`).
4. In **Tailor from JD**: company, role, paste JD → **Generate tailored resume** (also builds Apply kit).
5. Or open any tailored resume and click **Apply kit**.
6. Use the kit folder to apply manually in the ATS; update `applications.csv` when submitted.

## Run without installer (recommended for now)

Dev mode:

```powershell
npm run dev
```

Or use the already-built unpacked app:

```powershell
.\release\win-unpacked\Resume Studio.exe
```

Rebuild unpacked folder only (no NSIS installer):

```powershell
npm run pack:dir
```

## Public download (company launch)

Portable Windows build:

```powershell
npm run pack:release
```

Artifact: `artifacts/Resume-Studio-win-x64-<version>.rsz` (ZIP bytes; rename to `.zip` to extract).

Publish + website deploy steps: see [LAUNCH.md](LAUNCH.md).
Marketing site: `D:\MyProjects\resume-studio-web`
LinkedIn kit: `D:\MyProjects\resume-studio-web\LINKEDIN.md`

## Workspace layout

```
your-job-folder/
  base-resume.md
  job-preferences.md
  applications.csv
  resumes/
    simpplr--senior-pm-ai-products.md
  apply-kits/
    simpplr--senior-pm-ai-products/
      resume.md
      resume.pdf
      cover-letter.md
      form-snippets.md
      CHECKLIST.md
  interview-prep/
    simpplr--senior-pm-ai-products.md
```

You can point Resume Studio at your existing `job-automation` folder.

## Privacy

- No cloud account for Resume Studio itself. The Strands agent loop runs locally in the Electron main
  process — only the model call leaves your machine.
- API keys leave your machine only when calling the selected LLM provider.
- On the managed provider the app holds only an account token: a short-lived
  access token in memory and a `safeStorage`-encrypted refresh token on disk.
  No AWS credentials are ever sent to the desktop app.
- Agent tools read your workspace locally; file contents reach a provider only as prompt context.
- Job applications are still **manual** — this app does not auto-submit to ATS forms.

## Out of scope (v1)

- Automated job search / ranking
- Browser form fill / auto-apply
- Interview prep
- Cloud sync

## License

MIT
