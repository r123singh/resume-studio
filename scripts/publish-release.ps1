# Publish GitHub release for Resume Studio v1.0.0
# Requires: gh auth login, working DNS to github.com

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$asset = Join-Path $root "artifacts\Resume-Studio-win-x64-1.0.0.rsz"
if (-not (Test-Path $asset)) {
  throw "Missing $asset — run npm run pack:release / node scripts/make-zip.mjs first"
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "Install GitHub CLI: winget install GitHub.cli"
}

$remotes = git remote 2>$null
if ($remotes -notcontains "origin") {
  gh repo create r123singh/resume-studio --public --source=. --remote=origin --push
} else {
  git push -u origin HEAD
}

gh release create v1.0.0 $asset `
  --title "Resume Studio v1.0.0" `
  --notes-file (Join-Path $root "RELEASE_NOTES.md") `
  --clobber

Write-Host "Release URL: https://github.com/r123singh/resume-studio/releases/tag/v1.0.0"
Write-Host "Download: https://github.com/r123singh/resume-studio/releases/download/v1.0.0/Resume-Studio-win-x64-1.0.0.rsz"
