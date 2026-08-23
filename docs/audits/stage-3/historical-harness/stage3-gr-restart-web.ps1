$ErrorActionPreference = "Stop"

$root = (Resolve-Path ".").Path
$evidence = "C:\mh-stage3-gr-4e495abd"
$node = "C:\mh-runtime-c781-09\node-v22.22.0-win-x64\node.exe"
$initial = Get-Content (Join-Path $evidence "processes-initial.json") -Raw | ConvertFrom-Json
$old = Get-Process -Id $initial.web1Pid -ErrorAction Stop
if ($old.Path -ne $node) {
  throw "Unexpected process owns the recorded web PID."
}
Stop-Process -Id $old.Id
Wait-Process -Id $old.Id -Timeout 15 -ErrorAction SilentlyContinue

$env:NODE_ENV = "production"
$env:MANYHANDS_DAEMON_STATE_ROOT = Join-Path $evidence "daemon"
$env:MANYHANDS_DAEMON_ENDPOINT = "\\.\pipe\manyhands-stage3-4e495abd"
$env:MANYHANDS_WINDOWS_IPC_ACL_HELPER = Join-Path $evidence "tools\manyhands-windows-ipc-acl.exe"
$env:MANYHANDS_SESSION_TOKEN = "stage3-gr-4e495abd-shared-session"
$web = Start-Process -FilePath $node `
  -ArgumentList @("apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-H", "127.0.0.1", "-p", "3357") `
  -WorkingDirectory $root -RedirectStandardOutput (Join-Path $evidence "web-3357-after-restart.out") `
  -RedirectStandardError (Join-Path $evidence "web-3357-after-restart.err") -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 200
  if ($web.HasExited) {
    throw "Restarted Next process exited before readiness."
  }
  try {
    $health = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3357/api/health" -TimeoutSec 2).StatusCode
  } catch {
    $health = 0
  }
} while ($health -ne 200 -and (Get-Date) -lt $deadline)
if ($health -ne 200) {
  throw "Restarted Next readiness timeout."
}
[ordered]@{ oldPid = $old.Id; newPid = $web.Id; health = $health } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence "next-restart.json")
