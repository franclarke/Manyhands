$ErrorActionPreference = "Stop"

$root = (Resolve-Path ".").Path
$evidence = "C:\mh-stage3-gr-4e495abd"
$node = "C:\mh-runtime-c781-09\node-v22.22.0-win-x64\node.exe"
$state = Get-Content (Join-Path $evidence "gate-state.json") -Raw | ConvertFrom-Json
$old = Get-Process -Id $state.initialDaemonPid -ErrorAction Stop
if ($old.Path -ne $node) {
  throw "Unexpected process owns the recorded daemon PID."
}
Stop-Process -Id $old.Id -Force
Wait-Process -Id $old.Id -Timeout 15 -ErrorAction SilentlyContinue
$deadline = (Get-Date).AddSeconds(15)
do {
  $oldChild = Get-Process -Id $state.childPid -ErrorAction SilentlyContinue
  $oldGrandchild = Get-Process -Id $state.grandchildPid -ErrorAction SilentlyContinue
  if (-not $oldChild -and -not $oldGrandchild) {
    break
  }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
if ($oldChild -or $oldGrandchild) {
  throw "The crashed daemon left an original descendant alive."
}

$env:NODE_ENV = "production"
$env:MANYHANDS_DAEMON_STATE_ROOT = Join-Path $evidence "daemon"
$env:MANYHANDS_DAEMON_ENDPOINT = "\\.\pipe\manyhands-stage3-4e495abd"
$env:MANYHANDS_DAEMON_PROFILE = "deterministic_fake"
$env:MANYHANDS_FAKE_PID_EVIDENCE = Join-Path $evidence "tree-recovered.json"
$env:MANYHANDS_WINDOWS_JOB_RUNNER = Join-Path $evidence "tools\manyhands-windows-job-runner.exe"
$env:MANYHANDS_WINDOWS_IPC_ACL_HELPER = Join-Path $evidence "tools\manyhands-windows-ipc-acl.exe"
$daemon = Start-Process -FilePath $node -ArgumentList @("apps/daemon/dist/cli.cjs") `
  -WorkingDirectory $root -RedirectStandardOutput (Join-Path $evidence "daemon-after-restart.out") `
  -RedirectStandardError (Join-Path $evidence "daemon-after-restart.err") -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 100
  if ($daemon.HasExited) {
    throw "Recovered daemon exited before readiness."
  }
  $ready = Get-Content (Join-Path $evidence "daemon-after-restart.out") -ErrorAction SilentlyContinue |
    Select-String "manyhands.daemon.ready"
} while (-not $ready -and (Get-Date) -lt $deadline)
if (-not $ready) {
  throw "Recovered daemon readiness timeout."
}

[ordered]@{
  oldDaemonPid = $old.Id
  oldChildAlive = [bool](Get-Process -Id $state.childPid -ErrorAction SilentlyContinue)
  oldGrandchildAlive = [bool](Get-Process -Id $state.grandchildPid -ErrorAction SilentlyContinue)
  newDaemonPid = $daemon.Id
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence "daemon-restart.json")
