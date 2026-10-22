# Resume Studio release notes

## v1.1.1

Fixes the portable Windows build that crashed on launch with `Cannot find module 'zod'`. The app now ships the Electron main-process packages it needs (`zod`, Strands, and the AWS / model SDKs).

Everything from v1.1.0 is included: tailor, apply kit, tracker, hunt, mail, WhatsApp, evidence, and agent mode. NVIDIA NIM is included.

### Artifact

- File: `artifacts/Resume-Studio-win-x64-1.1.1.rsz` (~344 MB)
- Format: standard ZIP stored as `.rsz` (rename to `.zip` to extract)
- SHA256: `4D2B604AEB74E760CA7243914A202779A6FAB708EB92D5FD75A63596369A939C`

### Install

1. Download `.rsz`
2. Rename to `.zip` if needed
3. Extract and run `Resume Studio.exe`
4. More info → Run anyway if SmartScreen appears
5. Settings → NVIDIA is ready, or choose Ollama / your own key
