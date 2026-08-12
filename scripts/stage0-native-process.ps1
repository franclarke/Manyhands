function Format-Command([string]$Executable, [string[]]$Arguments) {
  $rendered = @('&')
  foreach ($argument in @($Executable) + $Arguments) {
    # Single-quote every token so PowerShell metacharacters in rg patterns or
    # paths cannot turn a recorded invocation into a different command.
    $rendered += "'" + $argument.Replace("'", "''") + "'"
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
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Native executable is not a file: $Executable"
  }
  Push-Location -LiteralPath $WorkingDirectory
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 surfaces ordinary native stderr as a
    # NativeCommandError when the surrounding preference is Stop. Preserve the
    # stream in the receipt and decide success solely from the native exit code.
    $ErrorActionPreference = 'Continue'
    # Assign the global automatic variable: assigning unscoped inside a
    # function creates a local shadow that PowerShell 5.1 does not refresh.
    $global:LASTEXITCODE = $null
    & $Executable @Arguments 2>&1 | ForEach-Object {
      $line = $_.ToString()
      Write-Host $line
      Write-ReceiptLine $LogPath $line
    }
    $exitCode = $global:LASTEXITCODE
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

function Invoke-ExternalText(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$WorkingDirectory
) {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Native executable is not a file: $Executable"
  }
  Push-Location -LiteralPath $WorkingDirectory
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    $lines = @(& $Executable @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $global:LASTEXITCODE
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
