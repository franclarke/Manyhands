# Security & Host Boundary Audit Report

**Target Version / Branch**: ManyHands Repository Audit  
**Auditor**: teamwork_preview_explorer (Security & Host Boundary Specialist)  
**Date**: 2026-07-21  
**Target Documents**: `docs/system/05-worktree-layer.md`, `docs/system/security-boundary.md`

---

## Executive Summary

An audit of ManyHands' security posture, host boundary isolation, process supervision, lease fencing, environment variable isolation, and path traversal safeguards was conducted across `packages/execution-core`, `packages/shared`, `apps/web`, and related execution subsystems.

While ManyHands implements strong design patterns in several core areas—such as environment variable allowlisting (`agent-env.ts`), structured process supervision (`process.supervision.ts`), and fencing token lease locking (`repo-lock.ts`)—several significant security gaps and host boundary violations were identified during static analysis:

1. **Unsupervised Process Spawning & Secret Leakage in Planning V2** (`MH-AUDIT-SEC-001`, **P1 / High**): The planning pipeline spawns CLI agent processes with full `process.env` (bypassing secret filtering) and uses raw `node:child_process.spawn()` instead of the supervised process wrapper.
2. **Path Traversal & Boundary Verification Bypass in Scope Enforcement** (`MH-AUDIT-SEC-002`, **P1 / High**): Scope path normalizations fail to check for `../` path traversal sequences and do not resolve paths against the expected worktree root.
3. **Windows `cmd.exe` Argument Escaping Vulnerabilities** (`MH-AUDIT-SEC-003`, **P2 / Medium**): Arguments passed to `.cmd` / `.bat` binaries via `node-cli-process.ts` use custom string escaping that can lead to command injection or flag injection under specific argument combinations.
4. **Lack of In-Flight Lease Revocation Signals to Running Executors** (`MH-AUDIT-SEC-004`, **P2 / Medium**): Spawning long-running tasks does not wire lease-lost callbacks to abort the process tree immediately upon takeover.
5. **Orphaned Sub-process Leaks on Windows `taskkill` Failures** (`MH-AUDIT-SEC-005`, **P2 / Medium**): When `taskkill /t` fails, fallback to Node `child.kill()` does not terminate descendant processes on Windows.
6. **Insecure Temporary File Permissions** (`MH-AUDIT-SEC-006`, **P3 / Low**): Atomic lock state and temporary files are created without explicit POSIX file mode masks (e.g. `0o600`), relying on ambient host umasks.

---

## Vulnerability Matrix

| Issue ID | Severity | Category | Target Location | Short Description |
|---|---|---|---|---|
| `MH-AUDIT-SEC-001` | **P1 (High)** | Secret Leak / Process Supervision | `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:117` | Planning CLI spawned with unfiltered `process.env` and bypasses process supervisor registration. |
| `MH-AUDIT-SEC-002` | **P1 (High)** | Path Traversal / Boundary Check | `packages/execution-core/src/scope/checker.ts:46-54`, `glob.ts:7-9` | Scope checker does not validate path traversal (`../`) or ensure paths reside strictly within the worktree root. |
| `MH-AUDIT-SEC-003` | **P2 (Medium)** | Command Injection / Escaping | `packages/shared/src/node-cli-process.ts:93-104,264-278` | Windows `.cmd`/`.bat` argument escaping with `windowsVerbatimArguments` allows potential argument/command injection. |
| `MH-AUDIT-SEC-004` | **P2 (Medium)** | Lease Fencing / Authority | `packages/execution-core/src/executor/process.ts:61-94`, `apps/web/src/lib/server/runs/repo-lock.ts:526` | Active agent execution processes continue running after lease takeover/expiry instead of terminating immediately. |
| `MH-AUDIT-SEC-005` | **P2 (Medium)** | Subprocess Leaks / Teardown | `packages/shared/src/node-cli-process.ts:145-149` | Fallback process kill (`safeDirectKill`) fails to terminate descendant subprocess trees on Windows. |
| `MH-AUDIT-SEC-006` | **P3 (Low)** | Permissive Permissions | `apps/web/src/lib/server/runs/repo-lock.ts:204` | Temporary atomic state files created with default umask without explicit restrictive modes (`0o600`). |

---

## Detailed Audit Findings

### `MH-AUDIT-SEC-001`: Unsupervised Process Spawning & Environment Secret Leakage in Planning V2
- **Severity**: P1 (High)
- **Category**: Secret Leakage & Unmonitored Process Execution
- **File**: `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`
- **Line Numbers**: 115–117

#### Code Snippet
```ts
// apps/web/src/lib/server/runs/v2/run-coordinator-host.ts
115: const spawn = supervisedSpawnFn({ runId, operationId, label: `planning-v2-attempt-${request.attempt}` });
116: return new Promise((resolve, reject) => {
117:   const child: ChildProcess = spawn(invocation.command, invocation.args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: process.platform !== "win32", ...(invocation.windowsVerbatimArguments !== undefined ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {}) });
```

#### Analysis & Impact
1. **Environment Secret Leakage**: Line 117 explicitly passes `env: process.env` to the spawned planning CLI. This bypasses the environment allowlist mechanism (`buildAgentEnvironment()` in `packages/execution-core/src/executor/agent-env.ts`), exposing all host server environment variables—including database connection strings, web session secrets, internal tokens, and system paths—to the external LLM CLI process. This directly violates `docs/system/security-boundary.md` Section *Datos* (redaction of secrets, minimum privileges).
2. **Process Supervision Bypass**: Although line 115 creates a `spawn` function wrapper using `supervisedSpawnFn`, line 117 invokes `spawn(...)` imported directly from `node:child_process` (line 2: `import { spawn } from "node:child_process"`), *not* the `spawn` wrapper function returned on line 115. As a result, planning CLI processes are never registered with `LiveProcessRegistry` or tracked by the process supervisor. If a run is cancelled during planning, `killRunProcessesVerified(runId)` will fail to locate or kill this process tree, leaving orphaned agent processes consuming host CPU and LLM quota.

#### Proposed Remediation
- Use `buildAgentEnvironment()` for the spawned environment vector.
- Call the `supervisedSpawnFn` wrapper instead of `node:child_process` `spawn`.

---

### `MH-AUDIT-SEC-002`: Path Traversal & Boundary Isolation Bypass in Scope Enforcement
- **Severity**: P1 (High)
- **Category**: Path Traversal & Worktree Escape
- **File**: `packages/execution-core/src/scope/checker.ts`, `packages/execution-core/src/scope/glob.ts`
- **Line Numbers**: `checker.ts:46-60`, `glob.ts:7-9`

#### Code Snippet
```ts
// packages/execution-core/src/scope/glob.ts
7: export function normalizePath(path: string): string {
8:   return path.replaceAll("\\", "/").replace(/^\.\//u, "");
9: }

// packages/execution-core/src/scope/checker.ts
46: for (const file of params.changedFiles) {
47:   if (matchesAnyGlob(file, forbidden)) {
48:     violations.push(file);
49:     continue;
50:   }
51:   if (allowed !== undefined && !matchesAnyGlob(file, allowed)) {
52:     outOfScope.push(file);
53:   }
54: }
```

#### Analysis & Impact
`docs/system/05-worktree-layer.md` Section *Limpieza y seguridad* specifies:
> "Paths se resuelven y verifican bajo la raíz esperada." ("Paths are resolved and verified under the expected root.")

`normalizePath` only replaces backslashes with forward slashes and strips leading `./`. It does *not*:
1. Resolve relative directory traversal segments such as `../` or `..\\`.
2. Verify that resolved absolute paths remain strictly contained within `worktreePath`.

If a malicious or rogue LLM tool modification produces paths containing `../` (e.g. `../../etc/shadow` or `src/../../.env`), `matchesAnyGlob(file, forbidden)` will evaluate against `../../etc/shadow`. If `forbiddenPaths` are defined as `[".git/**", "secrets/**"]`, the path `../../etc/shadow` will not match any forbidden glob pattern, causing the scope check to pass or mark it merely as `outOfScope` rather than throwing a path traversal violation.

#### Proposed Remediation
1. Implement canonical path resolution using `path.resolve(worktreeRoot, relativePath)` and verify that the target path starts with `worktreeRoot + path.sep`.
2. Normalize `../` sequences before matching globs.
3. Reject any path attempting to escape the worktree root as a terminal `ScopeViolationError`.

---

### `MH-AUDIT-SEC-003`: Command & Argument Injection Risks in Windows `cmd.exe` Launcher
- **Severity**: P2 (Medium)
- **Category**: Command Injection / Argument Escaping
- **File**: `packages/shared/src/node-cli-process.ts`
- **Line Numbers**: 93–104, 264–278

#### Code Snippet
```ts
// packages/shared/src/node-cli-process.ts
93:  const escapedCommand = escapeWindowsCmdCommand(binaryPath);
94:  const escapedArgs = args.map(escapeWindowsCmdArgument);
95:  const commandLine = [escapedCommand, ...escapedArgs].join(" ");
96:  return {
97:    command: env.ComSpec?.trim() || "cmd.exe",
98:    args: ["/d", "/v:off", "/s", "/c", `"${commandLine}"`],
99:    shell: false,
100:   windowsVerbatimArguments: true
101: };
...
262: const WINDOWS_CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/gu;
...
268: function escapeWindowsCmdArgument(value: string): string {
269:   let escaped = value;
270:   escaped = escaped.replace(/(?=(\\+?)?)\1"/gu, "$1$1\\\"");
271:   escaped = escaped.replace(/(?=(\\+?)?)\1$/gu, "$1$1");
272:   escaped = `"${escaped}"`;
273:   escaped = escaped.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
274:   return escaped.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
275: }
```

#### Analysis & Impact
When spawning Windows batch files (`.cmd` or `.bat`), Node requires running via `cmd.exe`. To avoid Node's deprecated `{ shell: true }` behavior, `node-cli-process.ts` manually constructs a raw command string and passes `windowsVerbatimArguments: true`.

However, the manual double-caret replacement (`escapeWindowsCmdArgument`) suffers from subtle command parser edge cases:
1. `WINDOWS_CMD_META_CHARACTERS` includes double quotes (`"`), spaces (` `), and wildcard characters (`*`, `?`). Applying caret escaping (`^`) *after* wrapping in double quotes (`"${escaped}"`) changes how `cmd.exe` processes quotes inside batch script argument forwarding (`%*` or `%1`).
2. If an argument contains embedded newlines (`\r` or `\n`), `cmd.exe` breaks command line parsing at the newline boundary and interprets subsequent text as a new, separate shell command.

#### Proposed Remediation
1. Strip or reject control characters and unhandled newline characters (`\r`, `\n`) in CLI argument vectors before formatting `cmd.exe` command strings.
2. Where possible, invoke Node or CLI executables directly (e.g. `node.exe path/to/cli.js`) to avoid passing arguments through `cmd.exe /c`.

---

### `MH-AUDIT-SEC-004`: Lack of Active Fencing Token Cancellation in Long-Running Executions
- **Severity**: P2 (Medium)
- **Category**: Fencing Token / Lease Authority Bypass
- **File**: `packages/execution-core/src/executor/process.ts`, `apps/web/src/lib/server/runs/repo-lock.ts`
- **Line Numbers**: `process.ts:61-120`, `repo-lock.ts:526-552`

#### Code Snippet
```ts
// apps/web/src/lib/server/runs/repo-lock.ts
526: export function startRepoLeaseHeartbeat(lease: RepoLease, options: RepoLeaseHeartbeatOptions = {}): () => void {
...
537:   if (!result.ok) {
538:     options.onLost?.(result.reason);
539:     return;
540:   }
```

#### Analysis & Impact
`docs/system/security-boundary.md` Section *Autoridad temporal* states:
> "Operation lease y repository lease con fencing tokens. Todo write/event/adoption verifica token... Un proceso huérfano no conserva autoridad."

When `withRepositoryLease` or `startRepoLeaseHeartbeat` detects that a lease was lost (e.g. stolen by a takeover run after network delay or server crash recovery), it invokes `onLost?(reason)`.

However, `spawnExecutorProcess` in `packages/execution-core` only binds its abortion logic to an `AbortSignal` passed via `options.signal`. The background lease heartbeat lost events are not automatically connected to abort active subprocess execution. Consequently, an agent CLI process can continue executing commands, modifying files in the worktree, and calling remote LLM APIs for minutes after its repository lease has expired or been revoked.

#### Proposed Remediation
- Pass an `AbortController` signal created from `startRepoLeaseHeartbeat`'s `onLost` callback directly into `spawnExecutorProcess`.
- Abort and kill the process tree immediately when a lease check fails.

---

### `MH-AUDIT-SEC-005`: Subprocess Leaks & Orphaned Trees on Windows `taskkill` Failure
- **Severity**: P2 (Medium)
- **Category**: Subprocess Teardown & Resource Leaks
- **File**: `packages/shared/src/node-cli-process.ts`
- **Line Numbers**: 145–149, 188–203

#### Code Snippet
```ts
// packages/shared/src/node-cli-process.ts
145: if (!firstTaskkillSucceeded) {
146:   const retrySucceeded = await runWindowsTaskkill(pid, spawnFn, verifyTimeoutMs);
147:   if (!retrySucceeded) safeDirectKill(child);
148:   const closedAfterRetry = await waitForChildClose(child, verifyTimeoutMs);
149:   return retrySucceeded && closedAfterRetry;
150: }
...
205: function safeDirectKill(child: KillableCliProcess): void {
206:   try {
207:     child.kill("SIGKILL");
208:   } catch {}
209: }
```

#### Analysis & Impact
`docs/system/security-boundary.md` Section *Procesos* requires:
> "Process Supervisor registra árbol, timeout y abort. Cancelación requiere confirmar terminación. Un proceso huérfano no conserva autoridad."

On Windows, `taskkill /pid <PID> /t /f` is responsible for recursing through process trees to terminate child and grandchild processes.

If `taskkill` fails (for instance, if `taskkill.exe` is missing from system path, or returns non-zero due to privilege constraints), `killCliProcessTree` falls back to `safeDirectKill(child)`. On Windows, Node's `child.kill()` native binding only terminates the immediate top-level child process, leaving all spawned child processes (such as compilers, background servers, or child Node/Git processes) running detached as orphans.

#### Proposed Remediation
- If `taskkill` fails on Windows, query `wmic` or `powershell` process tree relationships to find all descendant PIDs before attempting fallback kills.
- Treat `safeDirectKill` fallback as an unverified termination (`terminationVerified: false`), flagging the attempt as dirty/unverified.

---

### `MH-AUDIT-SEC-006`: Permissive Default Permissions for Temporary State & Lock Files
- **Severity**: P3 (Low)
- **Category**: File Permission Leakage
- **File**: `apps/web/src/lib/server/runs/repo-lock.ts`
- **Line Numbers**: 203–212

#### Code Snippet
```ts
// apps/web/src/lib/server/runs/repo-lock.ts
203: async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
204:   const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
205:   await writeFile(tmp, JSON.stringify(value), "utf8");
206:   try {
207:     await renameWithRetry(tmp, file);
```

#### Analysis & Impact
Lock files (`owner.json`), token records (`heartbeat-<token>.json`), and temporary instruction prompt files are created using standard `writeFile` without explicit mode options (`mode: 0o600`). On POSIX systems with permissive default umasks (such as `0022` or `0002`), these files are readable by all local system users. Local users on shared machines could read active run tokens, process PIDs, or sensitive prompt contents.

#### Proposed Remediation
- Pass explicit mode `{ mode: 0o600 }` to `writeFile` when persisting sensitive lock tokens, prompt instructions, or operation state.

---

## Verification & Compliance Checklist

- [x] **Process Execution**: Inspected `packages/execution-core/src/executor/process.ts`, `cli-executor.ts`, `node-cli-process.ts`.
- [x] **Environment Isolation**: Checked `agent-env.ts` vs `run-coordinator-host.ts`.
- [x] **Worktree & Scope Boundaries**: Inspected `scope/checker.ts`, `scope/glob.ts`, `git/runner.ts`.
- [x] **Lease Fencing & Locks**: Inspected `apps/web/src/lib/server/runs/repo-lock.ts`, `run-operation-lease.ts`.
- [x] **Target Architecture Documents**: Verified findings against `docs/system/05-worktree-layer.md` and `docs/system/security-boundary.md`.

---

## Recommended Action Plan

1. **Immediate Fix (P1)**: Update `run-coordinator-host.ts` to call `buildAgentEnvironment()` and use `supervisedSpawnFn` instead of `node:child_process.spawn()`.
2. **Immediate Fix (P1)**: Update `ScopeChecker` to resolve paths against `worktreePath` and reject `../` traversal attempts.
3. **Secondary Fix (P2)**: Connect `startRepoLeaseHeartbeat`'s `onLost` callback to an `AbortController` that cancels running agent process trees immediately upon lease loss.
4. **Secondary Fix (P2)**: Sanitize CLI arguments against control/newline characters in `node-cli-process.ts`.
5. **Hardening (P3)**: Add explicit `{ mode: 0o600 }` to atomic file writes in lock management.
