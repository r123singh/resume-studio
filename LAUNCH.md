# Launch runbook — Resume Studio

Public download is the GitHub Release asset. The marketing site reads that URL from `download-meta.json`.

## This release

| Item | Path |
|------|------|
| Version | 1.1.1 |
| Portable app folder | `D:\MyProjects\resume-studio\release\portable\Resume Studio\` |
| Download artifact | `D:\MyProjects\resume-studio\artifacts\Resume-Studio-win-x64-1.1.1.rsz` |
| SHA256 | `4D2B604AEB74E760CA7243914A202779A6FAB708EB92D5FD75A63596369A939C` |
| Marketing site | https://resume-studio-web-seven.vercel.app/ |
| LinkedIn kit | `D:\MyProjects\resume-studio-web\LINKEDIN.md` |

Download URL:

`https://github.com/r123singh/resume-studio/releases/download/v1.1.1/Resume-Studio-win-x64-1.1.1.rsz`

## 1) Publish GitHub Release

From `D:\MyProjects\resume-studio`, with `gh` authenticated:

```powershell
git push -u origin HEAD
powershell -File .\scripts\publish-release.ps1
```

## 2) Deploy website

`download-meta.json` and `public/download-meta.json` must match the release (version, SHA256, size, download URL).

```powershell
cd D:\MyProjects\resume-studio-web
vercel --prod --yes
```

Paste the production URL into `LINKEDIN.md`.

## 3) Smoke test

1. Incognito → open the site → Download
2. Rename `.rsz` → `.zip` if needed → extract → run `Resume Studio.exe`
3. Leave NVIDIA selected, or add a key → tailor one JD
