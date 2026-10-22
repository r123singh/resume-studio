# Resume Studio release notes

## v1.1.2

Fixes agent mode in the portable Windows build. v1.1.1 launched, then failed on `agent:run` because `@modelcontextprotocol/sdk` was not shipped with `@strands-agents/sdk`.

The pack now copies installed peer dependencies and imports the Strands Node entry before the zip is built.

### Artifact

- File: `artifacts/Resume-Studio-win-x64-1.1.2.rsz` (~354 MB)
- Format: standard ZIP stored as `.rsz` (rename to `.zip` to extract)
- SHA256: `CA634144BB317E4C0AA16A65A7BE40AD4FC1AF4FB8E0EB90981E82B9E36344EE`

### Install

1. Download `.rsz`
2. Rename to `.zip` if needed
3. Extract and run `Resume Studio.exe`
4. More info → Run anyway if SmartScreen appears
5. Settings → NVIDIA is ready, or choose Ollama / your own key
