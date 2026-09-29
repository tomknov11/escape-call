$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Escape Call setup ===" -ForegroundColor Cyan
Write-Host "このスクリプトは Cloudflare Worker をデプロイします。"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js が必要です。https://nodejs.org/ から LTS を入れてください。"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm が見つかりません。"
}

$owner = Read-Host "GitHubユーザー名"
$repo = Read-Host "GitHubリポジトリ名（例 escape-call）"
$pin = Read-Host "アプリ用PIN（4〜10桁程度）"
$tokenSecure = Read-Host "GitHub Fine-grained PAT（Actions: Read and write）" -AsSecureString
$token = [System.Net.NetworkCredential]::new("", $tokenSecure).Password

Push-Location (Join-Path $PSScriptRoot "..\worker")
try {
  npm install
  npx wrangler login

  Write-Host "Cloudflare secrets を登録します..." -ForegroundColor Yellow
  $pin | npx wrangler secret put APP_PIN
  $token | npx wrangler secret put GITHUB_TOKEN
  $owner | npx wrangler secret put GITHUB_OWNER
  $repo | npx wrangler secret put GITHUB_REPO

  Write-Host "デプロイします..." -ForegroundColor Yellow
  npx wrangler deploy
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "完了。表示された workers.dev URL を iPhone のSafariで開いてください。" -ForegroundColor Green
