# Publish the GitHub release for the version in package.json.
# Requires: gh auth login, and DNS that can resolve github.com.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $pkg.version
$assetName = "Resume-Studio-win-x64-$version.rsz"
$asset = Join-Path $root "artifacts\$assetName"
if (-not (Test-Path $asset)) {
  throw "Missing $asset - run npm run pack:release first"
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

gh release create "v$version" $asset `
  --title "Resume Studio v$version" `
  --notes-file (Join-Path $root "RELEASE_NOTES.md") `
  --clobber

Write-Host "Release URL: https://github.com/r123singh/resume-studio/releases/tag/v$version"
Write-Host "Download: https://github.com/r123singh/resume-studio/releases/download/v$version/$assetName"
