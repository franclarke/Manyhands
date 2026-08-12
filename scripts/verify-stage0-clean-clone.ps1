[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$Candidate,

  [Parameter(Mandatory = $true)]
  [string]$SourceRepository,

  [Parameter(Mandatory = $true)]
  [string]$ClonePath,

  [Parameter(Mandatory = $true)]
  [string]$StorePath,

  [Parameter(Mandatory = $true)]
  [string]$ShimPath,

  [Parameter(Mandatory = $true)]
  [string]$RuntimePath,

  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9-]+$')]
  [string]$LogPrefix
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:NodeVersion = 'v22.22.0'
$script:PnpmVersion = '11.21.0'
$script:NodeArchiveName = 'node-v22.22.0-win-x64.zip'
$script:NodeArchiveSha256 = 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a'
$script:NodeArchiveUrl = "https://nodejs.org/dist/v22.22.0/$script:NodeArchiveName"

function Resolve-ExistingDirectory([string]$Path, [string]$Label) {
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
    throw "$Label is not a directory: $Path"
  }
  return $resolved.Path
}

function Assert-NewAbsoluteDirectory([string]$Path, [string]$Label) {
  if (-not [System.IO.Path]::IsPathRooted($Path)) {
    throw "$Label must be an absolute path: $Path"
  }
  if (Test-Path -LiteralPath $Path) {
    throw "$Label must not exist before qualification: $Path"
  }
  $parent = Split-Path -Parent $Path
  if (-not $parent -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "$Label parent directory does not exist: $parent"
  }
}

function Normalize-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Test-PathContains([string]$Parent, [string]$Child) {
  $normalizedParent = Normalize-FullPath $Parent
  $normalizedChild = Normalize-FullPath $Child
  return $normalizedChild.Equals(
    $normalizedParent,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or $normalizedChild.StartsWith(
    $normalizedParent + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase
  )
}

function Assert-DisjointPaths([hashtable]$Paths) {
  $names = @($Paths.Keys)
  for ($left = 0; $left -lt $names.Count; $left++) {
    for ($right = $left + 1; $right -lt $names.Count; $right++) {
      $leftName = $names[$left]
      $rightName = $names[$right]
      $leftPath = $Paths[$leftName]
      $rightPath = $Paths[$rightName]
      if ((Test-PathContains $leftPath $rightPath) -or (Test-PathContains $rightPath $leftPath)) {
        throw "$leftName and $rightName must be disjoint: $leftPath ; $rightPath"
      }
    }
  }
}

function Resolve-Executable([string]$Name) {
  $matches = @(Get-Command $Name -CommandType Application -ErrorAction Stop)
  if ($matches.Count -eq 0) {
    throw "Required executable is unavailable: $Name"
  }
  $resolved = $matches[0].Source
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "Resolved executable is not a file: $Name -> $resolved"
  }
  return $resolved
}

function Write-ReceiptLine([string]$LogPath, [string]$Line) {
  [System.IO.File]::AppendAllText(
    $LogPath,
    $Line + [Environment]::NewLine,
    $script:Utf8NoBom
  )
}

function New-Receipt([string]$Id, [string]$WorkingDirectory, [string]$Command) {
  $path = Join-Path $script:EvidenceRoot "$LogPrefix-$Id.log"
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite existing evidence: $path"
  }
  Write-ReceiptLine $path "RECEIPT_ID=$Id"
  Write-ReceiptLine $path "CANDIDATE=$Candidate"
  Write-ReceiptLine $path "WORKING_DIRECTORY=$WorkingDirectory"
  Write-ReceiptLine $path "COMMAND=$Command"
  return $path
}

function Format-Command([string]$Executable, [string[]]$Arguments) {
  $rendered = @()
  foreach ($argument in @($Executable) + $Arguments) {
    $rendered += if ($argument -match '[\s"]') {
      '"' + $argument.Replace('"', '\"') + '"'
    } else {
      $argument
    }
  }
  return $rendered -join ' '
}

function Invoke-LoggedExternal(
  [string]$LogPath,
  [string]$Executable,
  [string[]]$Arguments,
  [string]$WorkingDirectory,
  [int[]]$AllowedExitCodes = @(0)
) {
  Push-Location -LiteralPath $WorkingDirectory
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 surfaces ordinary native stderr as a
    # NativeCommandError when the surrounding preference is Stop. Preserve the
    # stream in the receipt and decide success solely from the native exit code.
    $ErrorActionPreference = 'Continue'
    $LASTEXITCODE = $null
    & $Executable @Arguments 2>&1 | ForEach-Object {
      $line = $_.ToString()
      Write-Host $line
      Write-ReceiptLine $LogPath $line
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
  if ($null -eq $exitCode) {
    throw "Native command did not establish an exit code: $(Format-Command $Executable $Arguments)"
  }
  Write-ReceiptLine $LogPath "EXIT_CODE=$exitCode"
  if ($AllowedExitCodes -notcontains $exitCode) {
    throw "Command failed with exit $exitCode; see $LogPath"
  }
  return $exitCode
}

function Invoke-Receipt(
  [string]$Id,
  [string]$Executable,
  [string[]]$Arguments,
  [string]$WorkingDirectory,
  [int[]]$AllowedExitCodes = @(0)
) {
  $command = Format-Command $Executable $Arguments
  $log = New-Receipt $Id $WorkingDirectory $command
  [void](Invoke-LoggedExternal $log $Executable $Arguments $WorkingDirectory $AllowedExitCodes)
  Write-ReceiptLine $log 'COMMAND_STATUS=accepted_exit'
  return $log
}

function Invoke-ExternalText(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$WorkingDirectory
) {
  Push-Location -LiteralPath $WorkingDirectory
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $LASTEXITCODE = $null
    $lines = @(& $Executable @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
  if ($null -eq $exitCode) {
    throw "Native command did not establish an exit code: $(Format-Command $Executable $Arguments)"
  }
  if ($exitCode -ne 0) {
    throw "Command failed with exit ${exitCode}: $(Format-Command $Executable $Arguments)"
  }
  return ($lines -join [Environment]::NewLine).Trim()
}

$sourceRoot = Resolve-ExistingDirectory $SourceRepository 'SourceRepository'
$script:EvidenceRoot = Resolve-ExistingDirectory $EvidenceDirectory 'EvidenceDirectory'
$git = Resolve-Executable 'git'
$codex = Resolve-Executable 'codex'
$rg = Resolve-Executable 'rg'
Assert-NewAbsoluteDirectory $ClonePath 'ClonePath'
Assert-NewAbsoluteDirectory $StorePath 'StorePath'
Assert-NewAbsoluteDirectory $ShimPath 'ShimPath'
Assert-NewAbsoluteDirectory $RuntimePath 'RuntimePath'
Assert-DisjointPaths @{
  ClonePath = $ClonePath
  StorePath = $StorePath
  ShimPath = $ShimPath
  RuntimePath = $RuntimePath
}
foreach ($scratch in @{
  ClonePath = $ClonePath
  StorePath = $StorePath
  ShimPath = $ShimPath
  RuntimePath = $RuntimePath
}.GetEnumerator()) {
  foreach ($protected in @{
    SourceRepository = $sourceRoot
    EvidenceDirectory = $script:EvidenceRoot
  }.GetEnumerator()) {
    if ((Test-PathContains $scratch.Value $protected.Value) -or
        (Test-PathContains $protected.Value $scratch.Value)) {
      throw "$($scratch.Key) and $($protected.Key) must be disjoint: $($scratch.Value) ; $($protected.Value)"
    }
  }
}

$setupArguments = @(
  'clone', '-c', 'core.autocrlf=false', '--no-local', '--no-hardlinks', '--',
  $sourceRoot, $ClonePath
)
$setupLog = New-Receipt 'setup' $sourceRoot (Format-Command $git $setupArguments)
foreach ($entry in @(
  "CLONE_EXISTS_BEFORE=False",
  "STORE_EXISTS_BEFORE=False",
  "SHIM_EXISTS_BEFORE=False",
  "RUNTIME_EXISTS_BEFORE=False"
)) {
  Write-ReceiptLine $setupLog $entry
}

[void](Invoke-LoggedExternal $setupLog $git $setupArguments $sourceRoot)
Write-ReceiptLine $setupLog "COMMAND_2=$(Format-Command $git @('-C', $ClonePath, 'checkout', '--detach', $Candidate))"
[void](Invoke-LoggedExternal $setupLog $git @(
  '-C', $ClonePath, 'checkout', '--detach', $Candidate
) $sourceRoot)

New-Item -ItemType Directory -Path $StorePath | Out-Null
New-Item -ItemType Directory -Path $ShimPath | Out-Null
$storeFilesBeforeInstall = (Get-ChildItem -Force -Recurse -File -LiteralPath $StorePath | Measure-Object).Count
Write-ReceiptLine $setupLog "STORE_FILES_BEFORE_INSTALL=$storeFilesBeforeInstall"
if ($storeFilesBeforeInstall -ne 0) {
  throw "StorePath was not empty after creation: $StorePath"
}

New-Item -ItemType Directory -Path $RuntimePath | Out-Null
$nodeArchive = Join-Path $RuntimePath $script:NodeArchiveName
Write-ReceiptLine $setupLog "NODE_RUNTIME_URL=$script:NodeArchiveUrl"
Write-ReceiptLine $setupLog "NODE_RUNTIME_EXPECTED_SHA256=$script:NodeArchiveSha256"
Write-ReceiptLine $setupLog "COMMAND_3=Invoke-WebRequest -UseBasicParsing -Uri `"$script:NodeArchiveUrl`" -OutFile `"$nodeArchive`""
Invoke-WebRequest -UseBasicParsing -Uri $script:NodeArchiveUrl -OutFile $nodeArchive
$nodeArchiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $nodeArchive).Hash.ToLowerInvariant()
Write-ReceiptLine $setupLog "NODE_RUNTIME_ACTUAL_SHA256=$nodeArchiveHash"
if ($nodeArchiveHash -ne $script:NodeArchiveSha256) {
  throw "Node archive checksum mismatch: expected $script:NodeArchiveSha256, observed $nodeArchiveHash"
}
Write-ReceiptLine $setupLog "COMMAND_4=Expand-Archive -LiteralPath `"$nodeArchive`" -DestinationPath `"$RuntimePath`""
Expand-Archive -LiteralPath $nodeArchive -DestinationPath $RuntimePath
$nodeDistribution = Join-Path $RuntimePath 'node-v22.22.0-win-x64'
$node = Join-Path $nodeDistribution 'node.exe'
$corepack = Join-Path $nodeDistribution 'corepack.cmd'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $corepack -PathType Leaf)) {
  throw "Verified Node archive did not contain node.exe and corepack.cmd under $nodeDistribution"
}
$env:COREPACK_HOME = Join-Path $RuntimePath 'corepack-home'
$env:PATH = "$ShimPath;$nodeDistribution;$env:PATH"
Write-ReceiptLine $setupLog "COMMAND_5=`"$corepack`" enable --install-directory `"$ShimPath`" pnpm"
[void](Invoke-LoggedExternal $setupLog $corepack @(
  'enable', '--install-directory', $ShimPath, 'pnpm'
) $sourceRoot)

$pnpm = Join-Path $ShimPath 'pnpm.cmd'
if (-not (Test-Path -LiteralPath $pnpm -PathType Leaf)) {
  throw "Corepack did not create the expected pnpm.cmd shim: $pnpm"
}
$pnpmShim = Get-Content -LiteralPath $pnpm -Raw
if ($pnpmShim -notmatch [regex]::Escape('%~dp0\node.exe')) {
  throw "Corepack pnpm shim does not support a colocated pinned node.exe: $pnpm"
}
$shimNode = Join-Path $ShimPath 'node.exe'
Copy-Item -LiteralPath $node -Destination $shimNode
$runtimeNodeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $node).Hash.ToLowerInvariant()
$shimNodeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $shimNode).Hash.ToLowerInvariant()
if ($shimNodeHash -ne $runtimeNodeHash) {
  throw "Pinned Node copy mismatch: runtime=$runtimeNodeHash shim=$shimNodeHash"
}
$node = $shimNode
$env:NO_COLOR = '1'
$env:CI = '1'
$env:NEXT_TELEMETRY_DISABLED = '1'
Write-ReceiptLine $setupLog "PATH_PREFIX=$ShimPath;$nodeDistribution"
Write-ReceiptLine $setupLog "COREPACK_HOME=$env:COREPACK_HOME"
Write-ReceiptLine $setupLog "PNPM_NODE_PATH=$node"
Write-ReceiptLine $setupLog "PNPM_NODE_SHA256=$shimNodeHash"

$observedCandidate = Invoke-ExternalText $git @('-C', $ClonePath, 'rev-parse', 'HEAD') $sourceRoot
if ($observedCandidate -ne $Candidate) {
  throw "Detached clone identity mismatch: expected $Candidate, observed $observedCandidate"
}
$initialTree = Invoke-ExternalText $git @('-C', $ClonePath, 'show', '-s', '--format=%T', 'HEAD') $sourceRoot
$initialStatusText = Invoke-ExternalText $git @('-C', $ClonePath, 'status', '--porcelain') $sourceRoot
$initialStatus = @($initialStatusText -split '\r?\n' | Where-Object { $_ })
Write-ReceiptLine $setupLog "INITIAL_STATUS_COUNT=$($initialStatus.Count)"
if ($initialStatus.Count -ne 0) {
  throw "Detached clone was dirty before qualification; see $setupLog"
}
$nodeVersion = Invoke-ExternalText $node @('--version') $ClonePath
$pnpmVersion = Invoke-ExternalText $pnpm @('--version') $ClonePath
$rgVersion = Invoke-ExternalText $rg @('--version') $ClonePath
$gitVersion = Invoke-ExternalText $git @('--version') $ClonePath
$codexVersion = Invoke-ExternalText $codex @('--version') $ClonePath
Write-ReceiptLine $setupLog "NODE=$nodeVersion"
Write-ReceiptLine $setupLog "PNPM=$pnpmVersion"
Write-ReceiptLine $setupLog "PNPM_NODE=$nodeVersion"
Write-ReceiptLine $setupLog "RG_PATH=$rg"
Write-ReceiptLine $setupLog "RG_VERSION=$($rgVersion -split '\r?\n' | Select-Object -First 1)"
Write-ReceiptLine $setupLog "GIT_PATH=$git"
Write-ReceiptLine $setupLog "GIT_VERSION=$gitVersion"
Write-ReceiptLine $setupLog "CODEX_PATH=$codex"
Write-ReceiptLine $setupLog "CODEX_VERSION=$codexVersion"
if ($nodeVersion -ne $script:NodeVersion) {
  throw "Node runtime mismatch: expected $script:NodeVersion, observed $nodeVersion"
}
if ($pnpmVersion -ne $script:PnpmVersion) {
  throw "pnpm runtime mismatch: expected $script:PnpmVersion, observed $pnpmVersion"
}
Write-ReceiptLine $setupLog 'RECEIPT_STATUS=pass'

[void](Invoke-Receipt 'codex-strict-preflight' $codex @(
  '--strict-config', 'doctor', '--summary', '--ascii'
) $ClonePath)

[void](Invoke-Receipt 'source-api-routes' $rg @(
  '-n', 'export async function (GET|POST)', 'apps/web/src/app/api/runs'
) $ClonePath)
[void](Invoke-Receipt 'source-pipeline-hosts' $rg @(
  '-n', 'runPlanningV2Pipeline|startExecutionV2Pipeline|deliverRunV2|reconcileRunLiveness',
  'apps/web/src'
) $ClonePath)
[void](Invoke-Receipt 'source-legacy-route' $rg @(
  '-n', 'projectSemanticPlanForLegacyCompiler|V2ExecutionDriver|selectReadyWaveV2',
  'apps/web/src', 'packages'
) $ClonePath)
[void](Invoke-Receipt 'source-integration-validation' $rg @(
  '-n', 'IntegrationManifestExecutor|ExactCandidateValidatorV2|final_candidate.verified',
  'apps/web/src', 'packages'
) $ClonePath)
[void](Invoke-Receipt 'source-benchmark-markers' $rg @(
  '-n', '-i', '--glob', '!**/*.test.*', '--glob', '!**/tests/**',
  'backorders|currentBackorders|warehouse|SP2|G5|G6|G7',
  'apps/web/src', 'packages'
) $ClonePath)
[void](Invoke-Receipt 'source-legacy-imports' $rg @(
  '-n', '--glob', '!**/*.test.*',
  '@manyhands/(orchestrator-graph|conflict-risk)|projectSemanticPlanForLegacyCompiler',
  'apps/web/src', 'packages'
) $ClonePath)

[void](Invoke-Receipt 'clean-install' $pnpm @(
  'install', '--frozen-lockfile', '--store-dir', $StorePath
) $ClonePath)

[void](Invoke-Receipt 'stage0-contracts' $pnpm @(
  'exec', 'vitest', 'run',
  'tests/architecture-baseline.test.ts',
  'tests/documentation-current.test.ts',
  'tests/stage0-evidence-integrity.test.ts'
) $ClonePath)

$focusedTests = @(
  'tests/run-create-canonical-seed.test.ts',
  'tests/planning-v2-pipeline.test.ts',
  'tests/planning-v2-approval.test.ts',
  'tests/scheduler-readiness-v2.test.ts',
  'tests/run-v2-execution-driver.test.ts',
  'tests/run-v2-execution-host.test.ts',
  'tests/execution-core-v2-node-executor.test.ts',
  'tests/integration-manifest.test.ts',
  'tests/integration-operation-recovery.test.ts',
  'tests/exact-candidate-validation.test.ts',
  'tests/final-candidate.test.ts',
  'tests/delivery-state-machine.test.ts',
  'tests/run-store-event-source.test.ts',
  'tests/run-v2-record-cache-reconciliation.test.ts',
  'tests/run-liveness-supervisor.test.ts',
  'tests/run-v2-e2e.test.ts',
  'tests/run-v2-crash-recovery.test.ts',
  'tests/local-boundary.test.ts'
)
[void](Invoke-Receipt 'focused-route' $pnpm (@('exec', 'vitest', 'run') + $focusedTests) $ClonePath)
[void](Invoke-Receipt 'full-tests' $pnpm @('test') $ClonePath)
[void](Invoke-Receipt 'package-typechecks' $pnpm @(
  '-r', '--filter', './packages/*', 'typecheck'
) $ClonePath)
[void](Invoke-Receipt 'package-build' $pnpm @('build') $ClonePath)
[void](Invoke-Receipt 'web-typecheck' $pnpm @(
  '--filter', '@manyhands/web', 'exec', 'tsc', '--noEmit'
) $ClonePath)
[void](Invoke-Receipt 'web-build' $pnpm @('web:build') $ClonePath)

$lintLog = Invoke-Receipt 'lint' $pnpm @('lint') $ClonePath @(1)
$lintText = Get-Content -LiteralPath $lintLog -Raw
if ($lintText -notmatch '78 problems \(78 errors, 0 warnings\)') {
  throw "Lint failed differently from the frozen G0 baseline; see $lintLog"
}
Write-ReceiptLine $lintLog 'LINT_BASELINE_STATUS=pass'

$identityLog = New-Receipt 'final-identity' $ClonePath 'git rev-parse HEAD; git show -s --format=%T HEAD; git status --porcelain; pnpm --version; node --version'
$finalCandidate = Invoke-ExternalText $git @('-C', $ClonePath, 'rev-parse', 'HEAD') $sourceRoot
$finalTree = Invoke-ExternalText $git @('-C', $ClonePath, 'show', '-s', '--format=%T', 'HEAD') $sourceRoot
$finalStatusText = Invoke-ExternalText $git @('-C', $ClonePath, 'status', '--porcelain') $sourceRoot
$finalStatus = @($finalStatusText -split '\r?\n' | Where-Object { $_ })
$finalPnpmVersion = Invoke-ExternalText $pnpm @('--version') $ClonePath
$finalNodeVersion = Invoke-ExternalText $node @('--version') $ClonePath
foreach ($entry in @(
  "FINAL_CANDIDATE=$finalCandidate",
  "FINAL_TREE=$finalTree",
  "FINAL_STATUS_COUNT=$($finalStatus.Count)",
  "PNPM=$finalPnpmVersion",
  "NODE=$finalNodeVersion",
  "CLONE_EXISTS_AFTER=$(Test-Path -LiteralPath $ClonePath -PathType Container)",
  "STORE_EXISTS_AFTER=$(Test-Path -LiteralPath $StorePath -PathType Container)",
  "SHIM_EXISTS_AFTER=$(Test-Path -LiteralPath $ShimPath -PathType Container)",
  "RUNTIME_EXISTS_AFTER=$(Test-Path -LiteralPath $RuntimePath -PathType Container)"
)) {
  Write-ReceiptLine $identityLog $entry
}
if ($finalCandidate -ne $Candidate) {
  throw "Detached clone identity changed during qualification: expected $Candidate, observed $finalCandidate"
}
if ($finalTree -ne $initialTree) {
  throw "Detached clone tree changed during qualification: expected $initialTree, observed $finalTree"
}
if ($finalStatus.Count -ne 0) {
  throw "Detached clone became dirty during qualification; see $identityLog"
}
Write-ReceiptLine $identityLog 'EXIT_CODE=0'
Write-ReceiptLine $identityLog 'RECEIPT_STATUS=pass'

Write-Output "Stage 0 clean-clone qualification passed for $Candidate ($finalTree)."
Write-Output "Evidence: $script:EvidenceRoot"
