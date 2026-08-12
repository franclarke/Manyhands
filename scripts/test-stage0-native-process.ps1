Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'stage0-native-process.ps1')

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-ReceiptLine([string]$LogPath, [string]$Line) {
  [System.IO.File]::AppendAllText(
    $LogPath,
    $Line + [Environment]::NewLine,
    $script:Utf8NoBom
  )
}

$git = @(Get-Command git -CommandType Application -ErrorAction Stop)[0].Source
$version = Invoke-ExternalText $git @('--version') $PSScriptRoot
if ($version -notmatch '^git version \d+\.\d+') {
  throw "Unexpected Git version output: $version"
}

$missingFailedClosed = $false
try {
  [void](Invoke-ExternalText (Join-Path $PSScriptRoot 'missing-stage0-executable.exe') @() $PSScriptRoot)
} catch {
  $missingFailedClosed = $_.Exception.Message -match '^Native executable is not a file:'
}
if (-not $missingFailedClosed) {
  throw 'A missing executable did not fail closed through the shared native runner.'
}

$powershell = @(Get-Command powershell.exe -CommandType Application -ErrorAction Stop)[0].Source
$tempPrefix = Join-Path ([System.IO.Path]::GetTempPath()) (
  'manyhands-stage0-native-' + [Guid]::NewGuid().ToString('N')
)
$stderrLog = $tempPrefix + '-stderr.log'
$rejectedExitLog = $tempPrefix + '-rejected-exit.log'
$allowedExitLog = $tempPrefix + '-allowed-exit.log'
try {
  [void](Invoke-LoggedExternal $stderrLog $powershell @(
    '-NoProfile',
    '-Command',
    "[Console]::Error.WriteLine('ordinary stderr'); exit 0"
  ) $PSScriptRoot)
  $stderrReceipt = Get-Content -LiteralPath $stderrLog -Raw
  if ($stderrReceipt -notmatch 'ordinary stderr' -or $stderrReceipt -notmatch 'EXIT_CODE=0') {
    throw 'The logged runner did not preserve ordinary stderr with its successful native exit.'
  }

  $unexpectedExitFailedClosed = $false
  try {
    [void](Invoke-LoggedExternal $rejectedExitLog $powershell @(
      '-NoProfile', '-Command', "Write-Output 'unexpected exit'; exit 7"
    ) $PSScriptRoot)
  } catch {
    $unexpectedExitFailedClosed = $_.Exception.Message -match 'Command failed with exit 7'
  }
  if (-not $unexpectedExitFailedClosed -or
      (Get-Content -LiteralPath $rejectedExitLog -Raw) -notmatch 'EXIT_CODE=7') {
    throw 'An unexpected native exit did not fail closed after recording its exit code.'
  }

  [void](Invoke-LoggedExternal $allowedExitLog $powershell @(
    '-NoProfile', '-Command', "Write-Output 'allowed exit'; exit 1"
  ) $PSScriptRoot @(1))
  if ((Get-Content -LiteralPath $allowedExitLog -Raw) -notmatch 'EXIT_CODE=1') {
    throw 'An explicitly allowed native exit was not recorded.'
  }
} finally {
  foreach ($tempLog in @($stderrLog, $rejectedExitLog, $allowedExitLog)) {
    if (Test-Path -LiteralPath $tempLog -PathType Leaf) {
      [System.IO.File]::Delete($tempLog)
    }
  }
}

$script:ExpectedVersionSmoke = 'expected'
$observedVersionSmoke = 'observed'
if ($script:ExpectedVersionSmoke -ne 'expected' -or $observedVersionSmoke -ne 'observed') {
  throw 'Expected and observed version variables collided case-insensitively.'
}

Write-Output 'STAGE0_NATIVE_PROCESS_SMOKE=pass'
Write-Output 'STAGE0_EXPECTED_OBSERVED_VARIABLES=pass'
