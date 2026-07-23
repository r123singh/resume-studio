# Resume Studio

Cursor-like AI editor for **resume tailoring** on Windows. Open a workspace, edit markdown resumes, paste a job description to generate a tailored file, refine with chat, and export PDF.

Uses **bring-your-own API keys** (OpenAI, Anthropic, or Gemini). Keys are stored encrypted locally via Electron `safeStorage`.

## Features (v1)

- Three-pane layout: file explorer | Monaco editor | AI chat
- Workspace with `base-resume.md` + `resumes/`
- **Tailor from JD** → writes `resumes/{company}--{role}.md`
- **Edit open file** chat (full rewrite or selection replace)
- **Export PDF** via Chromium print-to-PDF
- Windows installer (`Resume-Studio-Setup-*.exe`)

## Prerequisites (development)

- Node.js 20+
- Windows 10/11
- An API key from OpenAI, Anthropic, or Google Gemini

## Develop

```powershell
cd D:\MyProjects\resume-studio
npm install
npm run dev
```

> If `npm install` fails with DNS/`ENOTFOUND`, fix local DNS (e.g. use `8.8.8.8`) or retry on a stable network, then install again.

`npm run dev` starts Vite + Electron together (via `vite-plugin-electron`).

## First-run flow

1. Launch the app → **Add API key** in Settings (choose provider + model).
2. **Open workspace folder** (new or existing). The app creates `base-resume.md` and `resumes/` if missing.
3. Paste your master resume into `base-resume.md` and Save (`Ctrl+S`).
4. In **Tailor from JD**: company, role, paste JD → **Generate tailored resume**.
5. Optionally switch to **Edit open file** for refinements.
6. **Export PDF** and upload to the ATS yourself.

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
  base-resume.md          # facts source of truth
  resumes/
    simpplr--senior-pm-ai-products.md
    ...
```

You can point Resume Studio at your existing `job-automation` folder.

## Privacy

- No cloud account for Resume Studio itself.
- API keys leave your machine only when calling the selected LLM provider.
- Job applications are still **manual** — this app does not auto-submit to ATS forms.

## Out of scope (v1)

- Automated job search / ranking
- Browser form fill / auto-apply
- Interview prep
- Cloud sync

## License

MIT
