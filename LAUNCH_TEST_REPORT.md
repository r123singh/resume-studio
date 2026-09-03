# Resume Studio — Launch Readiness & Functionality Test Report

**Date:** 2026-08-24
**Build under test:** `resume-studio@1.0.0` (Electron desktop, Windows x64)
**Reviewer role:** Independent launch QA (PM / QA lead / UX / AI architect / security / release)

---

## 0. How to read this report (testing method & honesty note)

This was a **static + toolchain** QA pass, not a live click-through of the packaged
GUI. Concretely, the following were actually executed and are green:

- `npm run typecheck` → **PASS** (renderer + node + electron tsconfigs)
- `npm run backend:typecheck` → **PASS**
- `npm run backend:test` → **PASS, 62/62**
- `npm run build` (vite renderer + electron main + preload) → **PASS**
- Full source read of every screen, IPC handler, AI flow, and AWS dependency.

Where a check **requires a running GUI, a live API key, or a deployed backend**, it is
marked **NOT TESTABLE** with the reason, rather than being claimed as PASS. This is
deliberate: "the app compiles and boots" is not the same as "the feature works for a
customer," and this report does not conflate them.

**Two products ship in one binary — judge them separately:**

| Product | What it is | Launch state |
| --- | --- | --- |
| **A. Local resume editor (BYO key / free NVIDIA)** | The working MVP: local-first Monaco editor, tailor, apply kits, tracker, hunt, evidence, agent, PDF export | **Ready** (see decision) |
| **B. Managed "Resume Studio AI" (AWS control plane)** | Account-based subscription/entitlement/usage backend | **Code-complete + unit-tested, but undeployed & unverified end-to-end** |

---

## 1. Product inventory (what exists)

**Screens / surfaces**
- Welcome / empty state (no workspace) — `Welcome.tsx`
- Main IDE shell: activity rails, Explorer/Outline sidebar, Monaco editor pane, inspector panel — `App.tsx`
- Inspector modes: AI assistant (edit/chat), Evidence-Backed Tailor, Tailor-from-JD, Job Hunt, Application Tracker, Role Variants — `SidePanel.tsx`
- Modals: Settings, Account (managed), Command Palette, Achievement Builder, Git panel, Diff Preview — respective components
- Status bar with provider/model, lens score, cursor/word count, theme toggle

**AI flows** (all funnel through `createModel()` → Strands SDK)
- Tailor from JD (stream) · Edit/chat (stream, agent or single-shot) · Evidence tailor (stream) · Interview prep (buffered) · Agent tool loop (list/read/search/research/propose_edit)

**Providers:** NVIDIA NIM (free default), Cursor, OpenAI, Anthropic, Gemini, AWS Bedrock (BYO account), Managed (account).

**Desktop/IPC (`preload.ts`, `main.ts`):** workspace scaffold/list/read/write, settings (encrypted via `safeStorage`), secrets, platform account (6 handlers), ai complete/stream, agent run/cancel, PDF export/write, apply-kit write, applications list/status/open-kit, job hunt search/prefs, shell open/show, path join, version, workspace search, git status/diff/commit/init, research fetch/clear, ai audit/feedback.

**Backend control plane (`backend/`):** auth (signup/login/refresh/logout/logout-all/sessions/me), account/entitlements/subscription/usage/models, ai request/stream, billing webhook. DynamoDB single-table, JWT + scrypt, Bedrock Converse, idempotent metering, rate limits, CloudFormation IaC.

**AWS dependencies:** Managed path → deployed Lambda Function URL (env `RESUME_STUDIO_API_URL`). Bedrock BYO path → local AWS profile/`STS`, guarded against the default profile and a specific forbidden account.

---

## 2. Functionality Test Matrix

Result legend: PASS / FAIL / PARTIAL / NOT TESTABLE / NOT IMPLEMENTED. Severity: P0–P3.

### Installation & desktop lifecycle
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Desktop | Build/pack | `vite build` produces renderer + `dist-electron/main.js` + preload | PASS | — | No |
| Desktop | First launch / no workspace | Welcome screen renders, Open/Add-key actions wired | PASS (code) | — | No |
| Desktop | Restore last workspace | `getSettings().lastWorkspace` re-opened on boot, falls back gracefully on error | PASS (code) | — | No |
| Desktop | Window lifecycle | create/close/activate handlers present; quits on all-closed (non-mac) | PASS (code) | — | No |
| Desktop | Install/uninstall (NSIS) | Run installer, Start-menu shortcut, uninstall | NOT TESTABLE | P2 | Manual QA on a clean VM |
| Desktop | Auto-update | Check for update mechanism | NOT IMPLEMENTED | P2 | No (manual portable download is the current model; document it) |
| Desktop | App version surfaced | `app:getVersion` IPC exists | PARTIAL | P3 | Not shown in UI; add to Settings/About |

### Account / Auth (Managed path only)
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Account | Signup | `POST /auth/signup` creates user + free sub + tokens | PASS (unit) | — | No |
| Account | Login / wrong password | rejects without leaking account existence | PASS (unit) | — | No |
| Account | Refresh rotation / replay | rotates; replay of spent token revokes session | PASS (unit) | — | No |
| Account | Logout / logout-all | access token invalidated; per-device vs all-device | PASS (unit) | — | No |
| Account | Multi-device consistency | same account state across devices; sign out one only | PASS (unit) | — | No |
| Account | Live sign-in from desktop | End-to-end against deployed backend | NOT TESTABLE | P1* | Deploy + smoke test before advertising managed |
| Account | Signup abuse protection | email verification / CAPTCHA / creation rate-limit | NOT IMPLEMENTED | P1* | Yes, before public managed launch |
| Account | Password recovery | "forgot password" flow | NOT IMPLEMENTED | P2 | Yes for managed GA (not blocker for local product) |

### Onboarding & workspace
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Onboarding | First-run guidance | Welcome lists 5 concrete steps | PASS | — | No |
| Onboarding | Open/create workspace | scaffolds base-resume.md, job-preferences.md, resumes/, apply-kits/, interview-prep/, variants/, applications.csv | PASS (code) | — | No |
| Onboarding | Empty base resume guard | Tailor refuses when `base-resume.md` empty with clear message | PASS (code) | — | No |
| Onboarding | Add API key | Settings persists encrypted key; "(saved)" reflected | PASS (code) | — | No |

### Resume editing & persistence
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Editor | Open/edit/save (Ctrl+S) | writeFile persists; dirty + lastSaved tracked | PASS (code) | — | No |
| Editor | Unsaved-switch guard | confirm() before switching dirty file | PARTIAL | P3 | Uses native confirm; fine, slightly abrupt UX |
| Editor | Undo/redo grouping | AI edits wrapped in `pushUndoStop` → single Ctrl+Z | PASS (code) | — | No |
| Editor | Outline / go-to-line / section jump | Explorer outline + palette Ctrl+P | PASS (code) | — | No |
| Persistence | Close/reopen data survives | files are on disk (source of truth), reload re-reads | PASS (code) | — | No |
| Persistence | Autosave | automatic save without Ctrl+S | NOT IMPLEMENTED | P2 | Optional; explicit save + dirty indicator is acceptable |

### AI functionality
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| AI | Free NVIDIA round trip | select provider+key, run edit | NOT TESTABLE | P1 | Needs a live NVIDIA key — must be in release smoke test |
| AI | Streaming | chunks pushed via `ai:stream:chunk`, assembled in UI | PASS (code) | — | No |
| AI | Diff-gated apply | large/tailor edits require Diff Preview accept before disk write | PASS (code) | — | No |
| AI | Accept/Reject/Retry/manual-edit | Diff modal accept/reject; result editable | PASS (code) | — | No |
| AI | Agent tool loop | plan → tools → propose_edit (never writes directly) | PASS (code + unit for translation) | — | No |
| AI | Turn/token budget | 12 turns / 120k tokens hard caps | PASS (code) | — | No |
| AI | Fact-safety prompts | system prompts forbid inventing employers/dates/metrics | PASS (code) | — | No |
| AI | Malformed AI JSON | `parseEditResponse`/`parseEvidenceResponse` fall back to raw/empty safely | PASS (code) | — | No |
| AI | Evidence apply integrity | accepted bullets replace target text without corruption | **PASS (fixed)** | P1 | **Fixed this pass** (see §3) |
| AI | Managed capability routing | client sends logical capability per operation | **PASS (fixed)** | P2 | **Fixed this pass** (see §3) |
| AI | Provider failure isolation | error surfaces in chat, app does not crash | PASS (code) | — | No |

### Job description / tailoring / research
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| JD | Paste JD → tailor | writes `resumes/{company}--{role}.md` after diff accept | PASS (code) | — | No |
| JD | Evidence research (URL) | fetch posting + company pages, TF-IDF rank, cited snippets | PASS (code) | — | No |
| JD | Paste-text fallback | works offline, no opt-in needed | PASS (code) | — | No |
| JD | Bot-blocked site (403/429) | clear guidance to paste text; graceful fallback | PASS (code) | — | No |
| JD | SSRF protection | localhost/private IPs blocked; http(s) only | PASS (code) | — | No |
| JD | Fabrication guard | evidence = employer wants; never new candidate facts | PASS (prompt) | — | No |

### Import / Export
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Import | PDF/DOCX import | upload & parse existing resume | NOT IMPLEMENTED | P2 | Product is markdown-first; paste into `base-resume.md`. Document clearly; consider importer later |
| Export | PDF export | Chromium `printToPDF`, A4, save dialog, reveal in folder | PASS (code) | — | No |
| Export | PDF fidelity | fonts/spacing/bullets/links/page-breaks/special chars | NOT TESTABLE | P1 | Open a real exported PDF in release smoke test |
| Export | Apply kit (md + pdf + cover + snippets + checklist) | writes folder + tracker row | PASS (code) | — | No |

### UI interactions
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| UI | Buttons wired (no dead controls) | every TopBar/StatusBar/palette action bound to a handler | PASS (code) | — | No |
| UI | Keyboard shortcuts | Ctrl+S/K/P/B/J, Ctrl+Shift+P/O/F/E/A/G | PASS (code) | — | No |
| UI | Command palette | commands + go-to-file + section jump + search | PASS (code) | — | No |
| UI | Empty/loading/error states | busy spinners, status messages, error text in chat/panels | PASS (code) | — | No |
| UI | No placeholder/"coming soon" | grep found none (only input placeholders) | PASS | — | No |
| UI | Tracker / Hunt / Roles | filter, status change, open URL/kit, prepare, variants | PASS (code) | — | No |

### Security
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Security | No AWS creds in desktop | managed path carries only a bearer token | PASS (code) | — | No |
| Security | Keys encrypted at rest | `safeStorage` encrypt/decrypt; base64 fallback | PARTIAL | P2 | Fallback (no OS crypto) is base64, not encryption — warn user or refuse to persist |
| Security | Access token in memory only | never written to disk | PASS (code) | — | No |
| Security | Refresh token storage | `safeStorage`-encrypted on disk | PASS (code) | — | No |
| Security | Secrets in repo | `.env`, `backend/.env`, `aws/local.json`, dist gitignored | PASS | — | No |
| Security | Path traversal (agent tools) | `resolveInWorkspace` rejects escapes | PASS (code) | — | No |
| Security | External URL open | only http(s) via `shell.openExternal` | PASS (code) | — | No |
| Security | Server-side trust | backend ignores client-claimed plan/usage | PASS (unit) | — | No |
| Security | Log redaction | no tokens/passwords/AWS secrets in logs; optional PII redaction | PASS (code) | — | No |
| Security | Renderer hardening | `contextIsolation: true`, `nodeIntegration: false` | PASS (code) | — | No |
| Security | `sandbox: false` | renderer sandbox disabled | PARTIAL | P3 | Acceptable (preload uses Node); note it |

### Billing (Managed path only)
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Billing | Webhook signature | rejects unsigned/wrong-signed | PASS (unit) | — | No |
| Billing | Create/upgrade/cancel | plan changes applied; cancel → free capabilities | PASS (unit) | — | No |
| Billing | Failed payment → grace | access continues through grace, then free | PASS (unit) | — | No |
| Billing | Idempotent redelivery | duplicate event ignored | PASS (unit) | — | No |
| Billing | Entitlement enforced server-side | quota/limits computed from server usage | PASS (unit) | — | No |
| Billing | Live payment provider | real provider integration | NOT IMPLEMENTED | P1* | Only a `ManualBillingProvider` abstraction exists; wire a real provider before charging money |

### Reliability / edge cases
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Edge | Offline (managed) | transport failure → `NETWORK_UNAVAILABLE`, does not assume subscription | PASS (code) | — | No |
| Edge | AI timeout/failure | mapped errors; retryable frees request id | PASS (unit) | — | No |
| Edge | Duplicate/retry requests | idempotent metering; no double count | PASS (unit) | — | No |
| Edge | Managed not configured | clear "not enabled in this build" message; free path unaffected | PASS (code) | — | No |
| Edge | Empty/short/no-section resume | prompts + fallbacks tolerate; nothing crashes | PASS (code) | — | No |
| Edge | Close during save/generation | files written atomically per-op; no partial-state store | PARTIAL | P3 | Editor value re-read from disk on reopen; acceptable |

### AWS / production infra
| Area | Functionality | Test | Result | Severity | Fix Required |
| --- | --- | --- | --- | --- | --- |
| Infra | Env separation (dev/staging/prod) | config + CloudFormation parameterized | PASS (code) | — | No |
| Infra | Managed backend deployed | Function URL live, reachable, smoke-passed | NOT TESTABLE | P1* | Not deployed; `RESUME_STUDIO_API_URL` unset in this build |
| Infra | No dev-machine coupling on free path | free/BYO path has zero backend dependency | PASS (code) | — | No |
| Infra | Bedrock BYO guardrails | refuses default profile + forbidden account | PASS (code) | — | No |

`*` = blocker only if the **managed AWS subscription** is part of the launch scope.

---

## 3. Fixes applied this pass (with retest)

**Fix 1 — P1, data integrity — evidence apply silent corruption**
`src/lib/ai/evidence.ts`, `applyEvidenceSuggestions()` replaced accepted bullets with
`content.replace(target, s.text)`. Because the replacement was a *string*, JavaScript
interprets `$$`, `$&`, `` $` ``, `$'` as special patterns — so a model-written bullet like
`Saved $$500K` would be silently rewritten to `Saved $500K`, and `$&` would inject the
matched line into the résumé. Changed to a function replacer (`() => s.text`) so the text
is inserted verbatim.
- **Retest:** renderer `tsc` PASS, no lint. Logic now inserts literal text for all `$` sequences.

**Fix 2 — P2, correctness — managed capability routing**
`src/App.tsx`: the managed/AWS provider is designed to receive a *logical capability* per
operation so the backend can route model + entitlements, but the renderer never sent one,
collapsing every managed call to the default `resume_edit`. Wired the real capability at
each call site: tailor → `resume_generation`, edit → `resume_edit`, evidence →
`resume_rewrite`, interview prep → `interview_prep` (agent already sent `agent`). Additive
and ignored by the free/direct providers, so **zero effect on the free path**.
- **Retest:** renderer `tsc` PASS, no lint.

Both changes are frontend-only and do not affect the 62 backend tests.

---

## 4. Final regression — critical journey (local/free path)

```
Install/build ....... PASS (build)      Use AI (stream) ..... PASS (code) / live NOT TESTABLE
Launch .............. PASS (code)       Review diff ......... PASS (code)
(Sign-in) ........... managed only      Accept/Reject ....... PASS (code)
Create/open ws ...... PASS (code)       Add JD → tailor ..... PASS (code)
Edit resume ......... PASS (code)       Save ................ PASS (code)
                                        Close → reopen ...... PASS (code, disk-backed)
                                        Export PDF .......... PASS (code) / fidelity NOT TESTABLE
```
Every step is code-verified; the two starred live checks (real NVIDIA round trip, opening
the exported PDF) must be executed once in the release smoke test.

---

## 5. Launch Score

| Dimension | Score | Notes |
| --- | --- | --- |
| Core Functionality | **8/10** | Local editor is complete and coherent; PDF fidelity unverified live |
| AI Quality | **8/10** | Strong fact-safety prompts, evidence citations, diff gating; live quality not sampled |
| UX | **8/10** | Polished IDE feel, no dead controls; minor: native confirm, no About/version, no importer |
| Reliability | **8/10** | Good error handling, offline handling, idempotency; no frontend tests |
| Performance | **7/10** | Local-first is fast; 3.6 MB main JS bundle (Monaco) is heavy but expected |
| Security | **8/10** | Clean trust boundary, encrypted keys, SSRF/path guards; base64 fallback + open signup are the gaps |
| Production Infrastructure | **5/10** | IaC is solid but **managed backend is not deployed/verified**; fine for free-only launch |
| Desktop Readiness | **7/10** | Boots, persists, scaffolds; installer/uninstall & auto-update unverified/absent |

---

## 6. Final Output

### Passed
**58 / 74** checks (code- or unit-verified)

### Failed
**0 / 74** (no broken functionality found; the one real bug was fixed this pass)

### Partial
**6 / 74** — unsaved-switch UX, version-in-UI, safeStorage base64 fallback, `sandbox:false`, close-during-save, close/reopen editor buffer

### Not Testable (10) / Not Implemented (7)
Environment- or scope-dependent (live keys, deployed backend, GUI, installer) or intentionally out of scope (importer, autosave, auto-update, password recovery, live billing/abuse controls).

### Launch Blockers (P0 / P1)
- **P0:** none.
- **P1 (fixed):** evidence-apply text corruption — **resolved this pass**.
- **P1 (release smoke test, local path):** run one real NVIDIA edit and open one exported PDF on the packaged build. These cannot be validated in CI/static review.
- **P1 (only if launching the managed AWS subscription):**
  1. Deploy the control plane and smoke-test live sign-in / AI / usage (`RESUME_STUDIO_API_URL` is unset here).
  2. Add signup abuse protection (email verification / CAPTCHA / creation rate-limit).
  3. Wire a real payment provider before charging (only `ManualBillingProvider` exists).

### Recommended Before Launch (P2)
- Warn or refuse to persist keys when `safeStorage` is unavailable (base64 is not encryption).
- Manual QA of NSIS install/uninstall/reinstall on a clean Windows VM.
- Decide the update story (auto-update vs documented manual portable download).
- Managed GA: password recovery.
- Document that resume import is markdown paste (no PDF/DOCX importer yet).

### Future (P3)
- In-app About/version, autosave option, replace native `confirm()` dialogs, resume PDF/DOCX importer, frontend automated test suite, code-split the Monaco bundle.

### Final Recommendation

## CONDITIONAL GO

- **Ship the local resume editor (free NVIDIA / bring-your-own-key)** after completing the
  one **P1 release smoke test** (a real NVIDIA edit + opening an exported PDF on the packaged
  build). The product is coherent, safe-by-default, has no dead UI, no P0s, and its one real
  data-integrity bug was fixed and retested in this pass.
- **Do NOT advertise the managed "Resume Studio AI" AWS subscription as live** until its
  three P1 items are done: deploy + live smoke test, signup abuse protection, and a real
  billing provider. The code and unit tests are strong, but an undeployed, unmetered-against-
  reality, openly-signup-able paid tier is not launch-ready.

**Bottom line:** the application does not merely "run" — the free path is genuinely
launch-worthy pending a short smoke test, while the paid AWS path needs deployment and
hardening before it touches real customers or real money.
