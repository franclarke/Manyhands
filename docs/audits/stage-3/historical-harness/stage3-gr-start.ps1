$ErrorActionPreference = "Stop"

$ports = 3357, 3358
$listeners = Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue
if ($listeners) {
  throw "Stage 3 evidence ports are already in use."
}

$root = (Resolve-Path ".").Path
$evidence = "C:\mh-stage3-gr-4e495abd"
$node = "C:\mh-runtime-c781-09\node-v22.22.0-win-x64\node.exe"
$endpoint = "\\.\pipe\manyhands-stage3-4e495abd"
$session = "stage3-gr-4e495abd-shared-session"

$env:NODE_ENV = "production"
$env:MANYHANDS_DAEMON_STATE_ROOT = Join-Path $evidence "daemon"
$env:MANYHANDS_DAEMON_ENDPOINT = $endpoint
$env:MANYHANDS_DAEMON_PROFILE = "deterministic_fake"
$env:MANYHANDS_FAKE_PID_EVIDENCE = Join-Path $evidence "tree.json"
$env:MANYHANDS_WINDOWS_JOB_RUNNER = Join-Path $evidence "tools\manyhands-windows-job-runner.exe"
$env:MANYHANDS_WINDOWS_IPC_ACL_HELPER = Join-Path $evidence "tools\manyhands-windows-ipc-acl.exe"
$env:MANYHANDS_SESSION_TOKEN = $session

$daemon = Start-Process -FilePath $node -ArgumentList @("apps/daemon/dist/cli.cjs") `
  -WorkingDirectory $root -RedirectStandardOutput (Join-Path $evidence "daemon.out") `
  -RedirectStandardError (Join-Path $evidence "daemon.err") -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 100
  if ($daemon.HasExited) {
    throw "Daemon exited before readiness."
  }
  $ready = Get-Content (Join-Path $evidence "daemon.out") -ErrorAction SilentlyContinue |
    Select-String "manyhands.daemon.ready"
} while (-not $ready -and (Get-Date) -lt $deadline)
if (-not $ready) {
  throw "Daemon readiness timeout."
}

$web1 = Start-Process -FilePath $node `
  -ArgumentList @("apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-H", "127.0.0.1", "-p", "3357") `
  -WorkingDirectory $root -RedirectStandardOutput (Join-Path $evidence "web-3357.out") `
  -RedirectStandardError (Join-Path $evidence "web-3357.err") -WindowStyle Hidden -PassThru
$web2 = Start-Process -FilePath $node `
  -ArgumentList @("apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-H", "127.0.0.1", "-p", "3358") `
  -WorkingDirectory $root -RedirectStandardOutput (Join-Path $evidence "web-3358.out") `
  -RedirectStandardError (Join-Path $evidence "web-3358.err") -WindowStyle Hidden -PassThru

$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 200
  if ($web1.HasExited -or $web2.HasExited) {
    throw "A Next process exited before readiness."
  }
  try {
    $health1 = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3357/api/health" -TimeoutSec 2).StatusCode
  } catch {
    $health1 = 0
  }
  try {
    $health2 = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3358/api/health" -TimeoutSec 2).StatusCode
  } catch {
    $health2 = 0
  }
} while (($health1 -ne 200 -or $health2 -ne 200) -and (Get-Date) -lt $deadline)
if ($health1 -ne 200 -or $health2 -ne 200) {
  throw "Next readiness timeout."
}

[ordered]@{
  daemonPid = $daemon.Id
  web1Pid = $web1.Id
  web2Pid = $web2.Id
  endpoint = $endpoint
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence "processes-initial.json")
Get-Content -LiteralPath (Join-Path $evidence "processes-initial.json")
