# 04 — Security & Host Boundary Technical Audit

**Audit Date**: 2026-07-21  
**Target Subsystems**: `packages/execution-core`, `packages/shared`, `apps/web`  
**Target Specs**: `docs/system/05-worktree-layer.md`, `docs/system/security-boundary.md`  
**Auditor**: Teamwork Explorer (Security & Host Boundary Specialist)  

---

## 1. Security Architecture Summary

ManyHands relies on process supervision, environment variable filtering, and worktree boundaries to isolate LLM-driven subagent processes. While core abstractions (such as `buildAgentEnvironment` in `packages/execution-core/src/executor/agent-env.ts` and `LiveProcessRegistry` in `packages/shared/src/process-supervision.ts`) provide clean security primitives, static analysis revealed **6 actionable security defects** where host isolation boundaries are bypassed or compromised.

---

## 2. Security Vulnerabilities Inventory

| Issue ID | Severity | Category | Target Location | Description |
|---|---|---|---|---|
| `MH-AUDIT-SEC-001` | **P1 (High)** | Secret Leak / Supervision | `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:117` | Planning CLI process is spawned with full `process.env` (bypassing secret redactor) and bypasses `LiveProcessRegistry`. |
| `MH-AUDIT-SEC-002` | **P1 (High)** | Path Traversal | `packages/execution-core/src/scope/checker.ts:46-54` | Scope path normalization fails to check `../` path traversal sequences or verify paths stay strictly inside worktree. |
| `MH-AUDIT-SEC-003` | **P2 (Medium)** | Command Injection | `packages/shared/src/node-cli-process.ts:93-104` | Windows `.cmd`/`.bat` argument escaping with `windowsVerbatimArguments` allows potential flag injection. |
| `MH-AUDIT-SEC-004` | **P2 (Medium)** | Lease Fencing | `packages/execution-core/src/executor/process.ts:61-94` | Running agent processes continue executing after lease takeover/expiry instead of receiving immediate abort signal. |
| `MH-AUDIT-SEC-005` | **P2 (Medium)** | Subprocess Leak | `packages/shared/src/node-cli-process.ts:145-149` | Teardown fallback to `child.kill()` fails to terminate descendant process trees on Windows when `taskkill` fails. |
| `MH-AUDIT-SEC-006` | **P3 (Low)** | Permissive Permissions | `apps/web/src/lib/server/runs/repo-lock.ts:204` | Lock files and temporary atomic files are created without explicit POSIX file mode masks (e.g. `0o600`). |

---

## 3. Deep Dive Analysis & Evidence

### `MH-AUDIT-SEC-001`: Environment Secret Leakage & Supervision Bypass in Planning V2
- **Location**: `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:115-117`
- **Code**:
  ```ts
  const spawn = supervisedSpawnFn({ runId, operationId, label: `planning-v2-attempt-${request.attempt}` });
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(invocation.command, invocation.args, { cwd, env: process.env, ... });
  ```
- **Evidence**: Line 117 explicitly passes `env: process.env` to the spawned planning process instead of using `buildAgentEnvironment()`. This leaks host credentials, session secrets, and connection strings to the external LLM process. Additionally, line 117 calls Node's native `spawn` function (imported on line 2), bypassing the `spawn` wrapper created on line 115, so the process is never registered with `LiveProcessRegistry`.

### `MH-AUDIT-SEC-002`: Path Traversal in Scope Enforcement
- **Location**: `packages/execution-core/src/scope/checker.ts:46-54`
- **Code**:
  ```ts
  export function isPathAllowed(targetPath: string, allowedPaths: readonly string[]): boolean {
    const normalized = targetPath.replace(/\\/g, "/");
    return allowedPaths.some(allowed => normalized.startsWith(allowed));
  }
  ```
- **Evidence**: `isPathAllowed` performs simple `startsWith` checks on normalized strings. An input such as `allowed/../../etc/passwd` matches `allowed` prefix but escapes the boundary when resolved on disk.

---

## 4. Remediation Plan

1. **Fix Secret Filtering (`MH-AUDIT-SEC-001`)**: Replace `env: process.env` with `buildAgentEnvironment(process.env)` in `run-coordinator-host.ts` and call the `supervisedSpawnFn` instance.
2. **Fix Path Traversal (`MH-AUDIT-SEC-002`)**: In `checker.ts`, resolve `targetPath` against `worktreeRoot` using `path.resolve` and assert `resolvedPath.startsWith(resolvedWorktreeRoot)`.
3. **Fix Lease Revocation Signals (`MH-AUDIT-SEC-004`)**: Wire `repoLock.onLeaseLost` callback to immediately invoke `processSupervisor.killRunProcesses(runId)`.
