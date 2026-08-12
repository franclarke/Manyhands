[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$QualifiedCandidate,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9-]+$')]
  [string]$LogPrefix,

  [Parameter(Mandatory = $true)]
  [string]$PnpmPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'stage0-native-process.ps1')
$architectureBaseline = 'f8082e5f2adcf89adfb4a3d76f95bdc0c44e3265'

function Get-SingleReceiptValue([string]$Text, [string]$Key) {
  $matches = @($Text -split '\r?\n' | Where-Object { $_ -match "^$([regex]::Escape($Key))=" })
  if ($matches.Count -ne 1) {
    throw "Expected exactly one $Key field; observed $($matches.Count)."
  }
  return $matches[0].Substring($Key.Length + 1)
}

$expectedReceiptIds = @(
  'setup',
  'codex-strict-preflight',
  'source-api-routes',
  'source-pipeline-hosts',
  'source-legacy-route',
  'source-integration-validation',
  'source-benchmark-markers',
  'source-legacy-imports',
  'clean-install',
  'stage0-contracts',
  'focused-route',
  'full-tests',
  'package-typechecks',
  'package-build',
  'web-typecheck',
  'web-build',
  'lint',
  'final-identity'
)
$allowedExactPaths = @(
  'docs/audits/stage-0/README.md',
  'docs/audits/stage-0/commands.json',
  'docs/audits/stage-0/environment.json',
  'docs/audits/stage-0/evidence-index.json',
  'docs/audits/stage-0/logs.sha256',
  'docs/audits/stage-0/verification.md',
  'docs/plans/2026-08-12-correctness-first-system-redesign.md'
)

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$git = @(Get-Command git -CommandType Application -ErrorAction Stop)[0].Source
$head = Invoke-ExternalText $git @('-C', $repositoryRoot, 'rev-parse', 'HEAD') $repositoryRoot
$parentLine = Invoke-ExternalText $git @(
  '-C', $repositoryRoot, 'rev-list', '--parents', '-n', '1', 'HEAD'
) $repositoryRoot
$parentTokens = @($parentLine -split '\s+' | Where-Object { $_ })
if ($parentTokens.Count -ne 2 -or $parentTokens[0] -ne $head -or
    $parentTokens[1] -ne $QualifiedCandidate) {
  throw "Closure must have exactly one parent equal to qualified candidate $QualifiedCandidate; observed $parentLine."
}

$changedText = Invoke-ExternalText $git @(
  '-C', $repositoryRoot, 'diff', '--name-only', "$QualifiedCandidate..HEAD"
) $repositoryRoot
$changedPaths = @($changedText -split '\r?\n' | Where-Object { $_ })
$logPathPattern = "^docs/audits/stage-0/logs/$([regex]::Escape($LogPrefix))-(.+)\.log$"
$unexpectedPaths = @($changedPaths | Where-Object {
  $_ -notin $allowedExactPaths -and $_ -notmatch $logPathPattern
})
if ($unexpectedPaths.Count -ne 0) {
  throw "Closure changed paths outside the allowlist: $($unexpectedPaths -join ', ')"
}
$observedReceiptIds = @($changedPaths | ForEach-Object {
  if ($_ -match $logPathPattern) { $Matches[1] }
} | Where-Object { $_ } | Sort-Object)
if (($observedReceiptIds -join "`n") -ne (($expectedReceiptIds | Sort-Object) -join "`n")) {
  throw "Closure receipt set mismatch. Expected 18 receipts; observed: $($observedReceiptIds -join ', ')."
}
$observedLogFiles = @($changedPaths | Where-Object { $_ -match $logPathPattern } | ForEach-Object {
  Split-Path -Leaf $_
} | Sort-Object)

$indexPath = Join-Path $repositoryRoot 'docs/audits/stage-0/evidence-index.json'
$index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
$qualifiedDispositions = @($index.candidateDispositions | Where-Object {
  $_.candidateCommit -eq $QualifiedCandidate -and
  $_.status -in @('qualified_pending_review', 'accepted')
})
if ($qualifiedDispositions.Count -ne 1) {
  throw "Evidence index must contain exactly one pending-review or accepted disposition for $QualifiedCandidate."
}
$indexedLogFiles = @($qualifiedDispositions[0].qualificationLogFiles | Sort-Object)
if (($indexedLogFiles -join "`n") -ne ($observedLogFiles -join "`n")) {
  throw 'Evidence index qualificationLogFiles do not match the 18 logs added by the closure commit.'
}
$qualificationEntries = @($index.entries | Where-Object {
  $_.usedForGateClaim -eq $true -and $_.candidateCommit -eq $QualifiedCandidate
})
$foreignClaims = @($index.entries | Where-Object {
  $_.usedForGateClaim -eq $true -and $_.candidateCommit -ne $QualifiedCandidate
})
if ($foreignClaims.Count -ne 0) {
  throw 'Evidence index contains gate claims for a different candidate.'
}
$indexedReceiptIds = @($qualificationEntries | ForEach-Object { $_.receiptId } | Sort-Object)
if (($indexedReceiptIds -join "`n") -ne (($expectedReceiptIds | Sort-Object) -join "`n")) {
  throw 'Evidence index receipt IDs do not match the required 18 receipts.'
}

$setupEntry = @($qualificationEntries | Where-Object { $_.receiptId -eq 'setup' })
if ($setupEntry.Count -ne 1) {
  throw 'Evidence index must identify exactly one setup receipt.'
}
$setupReceipt = Get-Content -LiteralPath (
  Join-Path $repositoryRoot "docs/audits/stage-0/logs/$($setupEntry[0].logFile)"
) -Raw
$recordedPnpmPath = Get-SingleReceiptValue $setupReceipt 'PNPM_PATH'
$recordedPnpmHash = Get-SingleReceiptValue $setupReceipt 'PNPM_SHA256'
$recordedNodePath = Get-SingleReceiptValue $setupReceipt 'PNPM_NODE_PATH'
$recordedNodeHash = Get-SingleReceiptValue $setupReceipt 'PNPM_NODE_SHA256'
$recordedCorepackHome = Get-SingleReceiptValue $setupReceipt 'COREPACK_HOME'
if (-not [System.IO.Path]::GetFullPath($PnpmPath).Equals(
  [System.IO.Path]::GetFullPath($recordedPnpmPath),
  [System.StringComparison]::OrdinalIgnoreCase
)) {
  throw "PnpmPath differs from the qualified setup receipt: $PnpmPath ; $recordedPnpmPath"
}
foreach ($tool in @(
  @{ Path = $PnpmPath; Hash = $recordedPnpmHash; Label = 'pnpm shim' },
  @{ Path = $recordedNodePath; Hash = $recordedNodeHash; Label = 'pinned Node' }
)) {
  if (-not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) {
    throw "$($tool.Label) is unavailable: $($tool.Path)"
  }
  $actualHash = (Get-FileHash -LiteralPath $tool.Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $tool.Hash) {
    throw "$($tool.Label) hash differs from the qualified setup receipt."
  }
}
$env:COREPACK_HOME = $recordedCorepackHome
$env:PATH = "$(Split-Path -Parent $recordedNodePath);$env:PATH"
$env:NO_COLOR = '1'
$env:CI = '1'
$env:NEXT_TELEMETRY_DISABLED = '1'
$pnpmVersionOutput = Invoke-ExternalText $PnpmPath @('--version') $repositoryRoot
$pnpmVersions = @($pnpmVersionOutput -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object {
  $_ -match '^\d+\.\d+\.\d+$'
})
if ($pnpmVersions.Count -ne 1 -or $pnpmVersions[0] -ne '11.21.0') {
  throw "Closure requires pnpm 11.21.0; observed: $pnpmVersionOutput"
}

$initialStatus = Invoke-ExternalText $git @('-C', $repositoryRoot, 'status', '--porcelain') $repositoryRoot
if ($initialStatus) {
  throw 'Closure verification requires a clean worktree.'
}
[void](Invoke-ExternalText $PnpmPath @(
  'exec', 'vitest', 'run', '--retry=0',
  'tests/architecture-baseline.test.ts',
  'tests/documentation-current.test.ts',
  'tests/stage0-evidence-integrity.test.ts',
  'tests/stage0-native-process.windows.test.ts'
) $repositoryRoot)
[void](Invoke-ExternalText $git @(
  '-C', $repositoryRoot, 'diff', '--check', "$architectureBaseline..HEAD"
) $repositoryRoot)

$finalHead = Invoke-ExternalText $git @('-C', $repositoryRoot, 'rev-parse', 'HEAD') $repositoryRoot
$finalParentLine = Invoke-ExternalText $git @(
  '-C', $repositoryRoot, 'rev-list', '--parents', '-n', '1', 'HEAD'
) $repositoryRoot
$finalStatus = Invoke-ExternalText $git @('-C', $repositoryRoot, 'status', '--porcelain') $repositoryRoot
if ($finalHead -ne $head -or $finalParentLine -ne $parentLine -or $finalStatus) {
  throw 'Closure identity or worktree changed during verification.'
}

Write-Output "Stage 0 evidence commit $head is a clean, direct child of qualified candidate $QualifiedCandidate with all 18 receipts."
