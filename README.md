# Resume Studio

Cursor-like AI editor for **resume tailoring** on Windows. Open a workspace, edit markdown resumes, paste a job description to generate a tailored file, refine with chat, and export PDF.

The AI layer runs on the **AWS Strands Agents SDK** (`@strands-agents/sdk`), so every model call — single-shot or agentic — goes through one framework. **NVIDIA NIM** is included (no key to paste) and Ollama is the local alternative. Amazon Bedrock, OpenAI, Anthropic, and Gemini are optional. Paid keys are stored encrypted locally via Electron `safeStorage`.

## Features (v1)

- Three-pane layout: file explorer | Monaco editor | AI chat
- Workspace with `base-resume.md` + `resumes/`
- **Tailor from JD** → writes `resumes/{company}--{role}.md`
- **Edit open file** chat (full rewrite or selection replace)
- **Export PDF** via Chromium print-to-PDF
- Free providers: NVIDIA NIM and Ollama (local); paid providers optional
- **Apply kit** → `apply-kits/{company}--{role}/` with resume PDF, cover letter, form snippets, checklist + `applications.csv` log
- **Tracker** tab → filter applications, mark applied/skipped, open job URL or kit folder
- **Hunt** tab → search RemoteOK + Remotive, rank vs `job-preferences.md`, prepare selected → tailor + apply kit
- **Mail Inbox** → fetch Gmail/IMAP (or paste / import `.eml`), extract recruiter JDs and job alerts, **send the reply over SMTP** (optional `resume.pdf` attach), tailor + kit as source `Email`
- **WhatsApp Recruiter Desk** → paste a recruiter thread, get a phone-skim ping (not a cover letter), open WhatsApp with the tailored PDF ready to attach
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

Bedrock, NVIDIA, Ollama, OpenAI, Anthropic, and Gemini can all run agent mode.

## AI providers

There are two shapes of provider, and picking one is the only decision:

| Provider | Credential | Who owns cost and limits |
| --- | --- | --- |
| **NVIDIA NIM** (default) | none | NVIDIA |
| **Ollama** (local, free) | none — runs on localhost | you (hardware) |
| OpenAI / Anthropic / Gemini / Bedrock | your own key or AWS profile | you |

### Ollama (local)

Run models entirely on your machine — no API key, no cloud. Resume Studio talks to Ollama's
OpenAI-compatible API at `http://127.0.0.1:11434/v1` by default.

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3.2`
2. In **Settings**, choose **Ollama (local)** — models load automatically from `ollama list`
3. Optional: change **Base URL** if Ollama runs on another host or port

Ollama works even when **Allow external AI** is turned off — prompts stay on localhost.
For agent mode, use a tool-capable model (e.g. Llama 3.1+, Qwen 2.5).

### Amazon Bedrock (bring your own AWS account)

The self-hosting path. It uses the AWS access key and secret you paste in Settings,
and it will call whichever Bedrock account those keys belong to.

1. Create a product AWS account and `aws configure --profile resume-studio`.
2. `npm run aws:bootstrap -- you@email.com` deploys least-privilege IAM, a $20 budget alarm, and a private artifacts bucket.
3. Enable model access in `us-east-1`, then paste a Bedrock API key in Settings **or** leave the key blank to use profile `resume-studio`.
4. Set **Expected AWS account ID** to the product account.

Full cutover: [`aws/README.md`](aws/README.md).

Verify without spending tokens:

```bash
npm run smoke:agent
npm run smoke:whatsapp
npm run smoke:mail
npm run aws:verify
npm run backend:test   # control plane suite, fully in-memory, no AWS calls
```

## WhatsApp Recruiter Desk

In India, SEA, and MENA a large share of recruiting never reaches an ATS — the JD arrives as a
WhatsApp forward. Resume Studio treats that thread as a first-class apply channel.

Open the **WhatsApp desk** (`Ctrl+Shift+M`) and paste the chat. Parse runs **locally** (no model):

- Recruiter name, phone, company, role, location, job URL
- A phone-length ping (4–8 lines, not a cover letter), a 3-bullet why-fit, and a 48h bump
- A **phone skim** score: first line names the role, under 700 characters, no “Dear / I am writing to apply”

**Open WhatsApp** launches `wa.me` with the ping prefilled. Attach `resume.pdf` from the apply kit —
the link cannot attach files. **Send kit to my phone** opens WhatsApp without a number so you can
drop the packet into your own chat and apply from mobile. **Polish with AI** is optional. **Tailor +
kit** writes `apply-kits/{company}--{role}/whatsapp-ping.md` and logs the tracker row as source
`WhatsApp`.

The paste never leaves the machine unless you polish with AI. Resume Studio does not auto-send
messages; you confirm in WhatsApp.

## Mail Inbox

Recruiter forwards, LinkedIn job alerts, and Naukri dumps never show up on RemoteOK. The **Mail
inbox** desk (`Ctrl+Shift+L`) treats those messages as a hunt source.

Three ways in, all ranked against `job-preferences.md`:

1. **Fetch inbox** — IMAP (Gmail / Outlook / Yahoo / Zoho / iCloud / custom). Save host + address +
   **app password** in Settings. Fetch uses `BODY.PEEK` so messages stay unread. The password is
   encrypted with OS `safeStorage` and never sent to a model.
2. **Import .eml** — drop exported messages from any client.
3. **Paste** — Gmail “Show original”, a forwarded JD, or raw RFC822. Parse runs locally (no model).

LinkedIn alerts that list several roles are split into separate cards. Pick one, edit company/role if
the parser missed them, then **Send reply** or **Tailor + kit**. The kit writes
`apply-kits/{company}--{role}/reply-email.md` and logs the tracker row as source `Email`.

**Send reply** uses SMTP with the same app password as IMAP (Gmail: `smtp.gmail.com:587`). You
confirm the recipient first — nothing is auto-sent. **New mail** opens a blank To / Subject / Body
composer for a standalone message (follow-up, thank-you, networking) that is not tied to an inbox
job. Check **Attach resume.pdf** after you have built an apply kit. **Open in mail app** remains as a
mailto fallback. One address per send; lists are rejected.

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
- NVIDIA NIM is included. Optional: a local [Ollama](https://ollama.com) install, or your own OpenAI / Anthropic / Gemini key

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
   - Default: **NVIDIA NIM** — no API key
   - Or **Ollama (local)** — install [ollama.com](https://ollama.com), pull a model, no key needed
   - Optional: expand paid providers (OpenAI / Anthropic / Gemini)
2. **Open workspace folder** (new or existing). The app creates `base-resume.md` and `resumes/` if missing.
3. Paste your master resume into `base-resume.md` and Save (`Ctrl+S`).
4. In **Tailor from JD**: company, role, paste JD → **Generate tailored resume** (also builds Apply kit).
5. Or paste a recruiter WhatsApp thread into **WhatsApp desk** (`Ctrl+Shift+M`) → Parse → Open WhatsApp.
6. Or open **Mail inbox** (`Ctrl+Shift+L`) → Fetch / paste a job email → Send reply, or click **New mail** for a standalone message.
7. Or open any tailored resume and click **Apply kit**.
8. Use the kit folder, WhatsApp, or email to apply; update `applications.csv` when submitted.

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
      whatsapp-ping.md
      reply-email.md
      CHECKLIST.md
  interview-prep/
    simpplr--senior-pm-ai-products.md
```

You can point Resume Studio at your existing `job-automation` folder.

## Privacy

- No cloud account for Resume Studio itself. The Strands agent loop runs locally in the Electron main
  process — only the model call leaves your machine (or stays on localhost with Ollama).
  - API keys leave your machine only when calling the selected LLM provider. Ollama traffic never leaves your machine.
  - IMAP app passwords stay encrypted in OS `safeStorage`. Fetch runs in the Electron main process; message bodies are not sent to a model unless you click Polish with AI.
- Agent tools read your workspace locally; file contents reach a provider only as prompt context.
- Job applications are still **manual** — this app does not auto-submit to ATS forms.

## Out of scope (v1)

- Automated job search / ranking
- Browser form fill / auto-apply
- Interview prep
- Cloud sync

## License

MIT
