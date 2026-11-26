$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$envPath = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envPath)) {
  throw 'Missing .env.local. Copy .env.example to .env.local first.'
}

Set-Location -LiteralPath $projectRoot
pnpm dev
