# Resume Studio release notes

## v1.0.0

First public Windows build.

### Artifact

- File: `artifacts/Resume-Studio-win-x64-1.0.0.rsz` (~277 MB)
- Format: standard ZIP stored as `.rsz` (local AV often blocks writing Electron `.zip`)
- SHA256: `15AFEC4A34521E602956FFE973464935E96DD1C674E193889D1805EF3C430CA9`

### Publish to GitHub Releases

```powershell
cd D:\MyProjects\resume-studio

# After gh is installed and authenticated:
gh repo create r123singh/resume-studio --public --source=. --remote=origin --push
gh release create v1.0.0 `
  "D:\MyProjects\resume-studio\artifacts\Resume-Studio-win-x64-1.0.0.rsz" `
  --title "Resume Studio v1.0.0" `
  --notes-file RELEASE_NOTES.md
```

Download URL expected by the website:

`https://github.com/r123singh/resume-studio/releases/download/v1.0.0/Resume-Studio-win-x64-1.0.0.rsz`

### Install for users

1. Download `.rsz`
2. Rename to `.zip` if needed
3. Extract and run `Resume Studio.exe`
4. More info → Run anyway if SmartScreen appears
5. Settings → add API key
