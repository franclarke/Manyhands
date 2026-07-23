# Handoff Report — Host Security & Execution Boundary Audit

## 1. Observation
- **Scope Examined**: `packages/execution-core` (`executor/process.ts`, `executor/cli-executor.ts`, `executor/agent-env.ts`, `scope/checker.ts`, `scope/glob.ts`, `git/runner.ts`), `packages/shared` (`src/node-cli-process.ts`), `apps/web` (`lib/server/runs/process-supervision.ts`, `lib/server/runs/repo-lock.ts`, `lib/server/runs/v2/run-coordinator-host.ts`, `lib/server/runs/v2/command-host.ts`).
- **Target Contracts**: Checked against `docs/system/05-worktree-layer.md` and `docs/system/security-boundary.md`.
- **Direct Code Evidence**:
  - `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:117`: Spawns CLI via `spawn(..., { env: process.env })`, passing full raw host environment variables and bypassing `buildAgentEnvironment()`. It also calls `node:child_process` `spawn` directly instead of using the `supervisedSpawnFn` wrapper on line 115.
  - `packages/execution-core/src/scope/checker.ts:46-60` & `packages/execution-core/src/scope/glob.ts:7-9`: `normalizePath` only converts `\` to `/` and strips `./`. It does not resolve `../` path traversal sequences or verify containment under `worktreePath`.
  - `packages/shared/src/node-cli-process.ts:93-104, 268-278`: Argument escaping for Windows `.cmd`/`.bat` binaries applies caret escaping after double quotes and lacks newline/control character filtering.
  - `packages/execution-core/src/executor/process.ts:61-120` & `apps/web/src/lib/server/runs/repo-lock.ts:526-552`: Lease heartbeat lost callback (`onLost`) is not wired to abort the active `spawnExecutorProcess` run signal.
  - `packages/shared/src/node-cli-process.ts:145-149`: Fallback kill (`safeDirectKill`) on Windows fails to terminate child process trees when `taskkill` fails.

## 2. Logic Chain
1. **Unsupervised Process & Env Leak**:
   - `buildAgentEnvironment()` in `agent-env.ts` provides an allowlist for secret reduction (`PATH`, provider keys, etc.).
   - `run-coordinator-host.ts:117` sets `env: process.env`, bypassing `buildAgentEnvironment()`. Thus internal server secrets leak to CLI subprocesses.
   - Line 117 invokes `spawn` imported from `node:child_process`, ignoring the `supervisedSpawnFn` wrapper created on line 115. These processes are not tracked by `LiveProcessRegistry` and survive cancellation.
2. **Scope Enforcement Escape**:
   - `docs/system/05-worktree-layer.md` requires resolving paths under the expected root.
   - `ScopeChecker` matches raw path strings with `matchesAnyGlob`. Relative path segments like `../` are not resolved against `worktreeRoot`. A path like `../../etc/passwd` escapes forbidden checks if forbidden paths are scoped to `.git/**`.
3. **Escaping & Windows Command Parsing**:
   - Spawning batch scripts uses `windowsVerbatimArguments: true` with double-caret escaping. Embedded newlines or metacharacter ordering differences in `%*` forwarding enable potential argument injection.
4. **Lease Loss & Authority**:
   - Fencing rules mandate that orphaned or stolen processes lose authority immediately.
   - `startRepoLeaseHeartbeat` detects lease loss, but `spawnExecutorProcess` execution loops are not notified, allowing agents to execute actions long after lease revocation.

## 3. Caveats
- Audit performed via static analysis and code tracing against target architecture documentation. Dynamic penetration tests were not run on host commands.

## 4. Conclusion
Identified 6 host security and execution boundary issues (`MH-AUDIT-SEC-001` through `MH-AUDIT-SEC-006`), including 2 High-Severity (P1) issues in process environment isolation and scope path traversal checks. The complete analysis and issue catalog have been compiled in `report.md`.

## 5. Verification Method
1. **Full Report**: Inspect `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_security\report.md`.
2. **Key Findings Verification**:
   - `MH-AUDIT-SEC-001`: Inspect `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts` line 117 to verify `env: process.env` usage and direct `node:child_process.spawn` call.
   - `MH-AUDIT-SEC-002`: Inspect `packages/execution-core/src/scope/checker.ts` lines 46–60 and `packages/execution-core/src/scope/glob.ts` lines 7–9 to verify lack of `../` resolution and root path prefix containment check.
