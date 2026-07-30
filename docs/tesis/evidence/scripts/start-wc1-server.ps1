param(
  [Parameter(Mandatory = $true)]
  [string]$SessionToken,
  [int]$Port = 3114
)

$ErrorActionPreference = "Stop"
$repository = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$env:MANYHANDS_SESSION_TOKEN = $SessionToken
Set-Location $repository

& pnpm.cmd --filter @manyhands/web exec next dev -H 127.0.0.1 -p $Port
exit $LASTEXITCODE
