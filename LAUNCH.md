# Launch runbook — Resume Studio

Public download is the GitHub Release asset. The marketing site reads that URL from `download-meta.json`.

## This release

| Item | Path |
|------|------|
| Version | 1.1.0 |
| Portable app folder | `D:\MyProjects\resume-studio\release\portable\Resume Studio\` |
| Download artifact | `D:\MyProjects\resume-studio\artifacts\Resume-Studio-win-x64-1.1.0.rsz` |
| SHA256 | `DA60DECE93F8D7BE939E3F6E0345C595B120B6AB5C7A6A56A040C09FC7D6C5F8` |
| Marketing site | `D:\MyProjects\resume-studio-web\` |
| LinkedIn kit | `D:\MyProjects\resume-studio-web\LINKEDIN.md` |

Download URL:

`https://github.com/r123singh/resume-studio/releases/download/v1.1.0/Resume-Studio-win-x64-1.1.0.rsz`

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
