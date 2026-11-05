# Creates .env from .env.example (if missing) and fills every empty secret with a random value (Windows PowerShell 5.1+).
# Safe to re-run: existing non-empty values are kept. Usage: .\scripts\gen-secrets.ps1 [-EnvFile .env]
param([string]$EnvFile = ".env")

$example = Join-Path $PSScriptRoot "..\.env.example"
if (-not (Test-Path $EnvFile)) {
  Copy-Item $example $EnvFile
  Write-Host "created $EnvFile from .env.example"
}

function Rand-Hex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString("x2") }) -join "")
}

$lines = Get-Content $EnvFile
function Set-IfEmpty([string]$name, [string]$value) {
  $idx = -1
  for ($i = 0; $i -lt $script:lines.Count; $i++) { if ($script:lines[$i] -match "^$name=") { $idx = $i; break } }
  $current = if ($idx -ge 0) { $script:lines[$idx].Substring($name.Length + 1) } else { "" }
  if ($current -eq "" -or $current -eq "change-me" -or $current -eq "change-me-root") {
    if ($idx -ge 0) { $script:lines[$idx] = "$name=$value" } else { $script:lines += "$name=$value" }
    Write-Host "set $name"
  } else {
    Write-Host "kept $name"
  }
}

Set-IfEmpty "OFFICE_JWT_SECRET" (Rand-Hex 32)
Set-IfEmpty "MYSQL_ROOT_PASSWORD" (Rand-Hex 24)
Set-IfEmpty "MYSQL_PASSWORD" (Rand-Hex 24)
Set-IfEmpty "LIVEKIT_API_KEY" ("API" + (Rand-Hex 6))
Set-IfEmpty "LIVEKIT_API_SECRET" (Rand-Hex 24)
Set-IfEmpty "METRICS_TOKEN" (Rand-Hex 24)

$pw = ($lines | Where-Object { $_ -match "^MYSQL_PASSWORD=" } | Select-Object -First 1).Substring("MYSQL_PASSWORD=".Length)
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^DATABASE_URL=") { $lines[$i] = "DATABASE_URL=mysql://oficio:$pw@mysql:3306/oficio" } }

[System.IO.File]::WriteAllLines((Resolve-Path $EnvFile), $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "Done. Now edit $EnvFile and set: OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, OFFICE_PUBLIC_URL, OFFICE_ALLOWED_HOSTS, LIVEKIT_URL (and LIVEKIT_NODE_IP if you know the public IP)."
