# Launch runbook — Resume Studio

Local packaging and website are ready. GitHub Release + Vercel need your login when DNS/network works.

## Already done locally

| Item | Path |
|------|------|
| Portable app folder | `D:\MyProjects\resume-studio\release\portable\Resume Studio\` |
| Download artifact | `D:\MyProjects\resume-studio\artifacts\Resume-Studio-win-x64-1.0.0.rsz` (~277 MB) |
| SHA256 | `15AFEC4A34521E602956FFE973464935E96DD1C674E193889D1805EF3C430CA9` |
| Marketing site | `D:\MyProjects\resume-studio-web\` |
| LinkedIn kit | `D:\MyProjects\resume-studio-web\LINKEDIN.md` |

## 1) Publish GitHub Release

```powershell
# Fix DNS if needed (Settings → Network → DNS → 8.8.8.8), then:
winget install GitHub.cli
gh auth login

cd D:\MyProjects\resume-studio
git add -A
git commit -m "Initial commit: Resume Studio v1.0.0"
gh repo create r123singh/resume-studio --public --source=. --remote=origin --push
gh release create v1.0.0 `
  ".\artifacts\Resume-Studio-win-x64-1.0.0.rsz" `
  --title "Resume Studio v1.0.0" `
  --notes-file RELEASE_NOTES.md
```

Website expects:

`https://github.com/r123singh/resume-studio/releases/download/v1.0.0/Resume-Studio-win-x64-1.0.0.rsz`

## 2) Deploy website

```powershell
cd D:\MyProjects\resume-studio-web
vercel login
vercel --prod
```

Paste the production URL into:
- `LINKEDIN.md` website field
- LinkedIn company page
- Optional: custom domain in Vercel

## 3) LinkedIn

Follow `LINKEDIN.md` checklist after the site URL is live.

## 4) Smoke test

1. Incognito → open site → Download
2. Rename `.rsz` → `.zip` if needed → extract → run exe
3. Add API key → tailor one JD
