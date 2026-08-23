# Handoff Report — Milestone 5: Applications & Native Bridges READMEs

## 1. Observation
- Audited the exact source code, TypeScript types, CLI options, Win32 FFI implementations, and security mechanisms across:
  - `apps/daemon`: 20 source files under `src/` including `cli.ts`, `daemon-kernel.ts`, `installation-lease.ts`, `local-ipc-server.ts`, `process-effect-adapters.ts`, `product-run-application.ts`, `windows-ipc-acl.ts`, `local-process-identity.ts`.
  - `apps/web`: 18 API routes under `src/app/api/`, `middleware.ts`, `src/lib/server/security/boundary.ts`, `src/lib/server/daemon/productive-client.ts`, `src/lib/run-model/reducer.ts`, and `@xyflow/react` UI components in `src/app/runs/[runId]/_components/`.
  - `native/windows-job-runner`: Pure Rust Win32 process containment (`src/main.rs`, 1,053 lines) with zero third-party dependencies in `Cargo.toml`.
  - `native/windows-ipc-acl`: Pure Rust Win32 security helper (`src/main.rs`, 934 lines) with zero third-party dependencies in `Cargo.toml`.
- Authored the following 4 files conforming to the 7-section structure:
  - `apps/daemon/README.md` (new file created)
  - `apps/web/README.md` (rewritten, fixing UTF-8 encoding flaws and removing obsolete `RunRecord` claims)
  - `native/windows-job-runner/README.md` (rewritten in pedagogical Spanish with full CLI, receipt schemas, and Win32 limits)
  - `native/windows-ipc-acl/README.md` (rewritten in pedagogical Spanish with DACL structure, reparse point defense, and proxy architecture)

## 2. Logic Chain
- **Requirement Verification**:
  1. `apps/daemon/README.md`: Explains the privileged composition root and single-authoritative journal writer. Details the Lamport bakery ticket mutual exclusion guard (`daemon.lease.guard`), HMAC-SHA256 authenticated IPC with `crypto.timingSafeEqual` and `ExpiringNonceReplayCache` (TTL 60s, skew 30s), fenced actor journal engine, outbox effect dispatching, and non-blocking startup recovery.
  2. `apps/web/README.md`: Explains the pure Server BFF client model with zero background worker ownership. Details the local API security boundary (`boundary.ts`) against DNS rebinding (loopback Host check) and CSRF (Origin validation + `mh_session` SameSite=Strict cookie + JSON content-type), event-sourced React Flow canvas without automatic view jumps, accessible WCAG 2.2 AA decision dialogs, and the complete catalog of all 18 API routes.
  3. `native/windows-job-runner/README.md`: Explains the Win32 FFI custody runner with dual nested Job Objects (`custodian_job` and `provider_job`) with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, suspended process startup (`CREATE_SUSPENDED`), kernel creation filetime start ticks (`windows:start-ticks:<ticks>`), checksummed receipt hard-linking (`started.json`, `final.json`), stdin liveness sentinel, and CLI operations (`run`, `probe`, `terminate`).
  4. `native/windows-ipc-acl/README.md`: Explains the Win32 security helper with protected DACLs (`SE_DACL_PROTECTED`) containing exactly two ACEs (Current User + Local System `NT AUTHORITY\SYSTEM`), reparse point junction defense (`FILE_FLAG_OPEN_REPARSE_POINT`), first-pipe proxying for public named pipes to unadvertised Node backend pipes, and CLI operations (`serve-pipe`, `verify-pipe`, `apply`, `verify`).
- **Plan Alignment**: All 4 READMEs explicitly document alignment with Stages 3, 7, 8, 9, 10, and 11 of `docs/plans/2026-08-12-correctness-first-system-redesign.md`.

## 3. Caveats
- No compiled binary executables (`.exe`) are committed in the repository for `windows-job-runner` or `windows-ipc-acl`. Operators must build them with `cargo build --release` as documented in their respective READMEs before running production workloads on Windows.
- Transitional workers (`transitional-unsafe-worker.ts`) and lifecycle adapters (`current-lifecycle-adapters.ts`) in `apps/daemon` remain isolated behind formal effect intent and receipt boundaries pending Stages 11-13 cleanup.

## 4. Conclusion
Milestone 5 deliverables have been completely authored, verified, and validated against actual source code and types. The documentation is pedagogical, accurate, and adheres strictly to the system redesign architecture and user guidelines.

## 5. Verification Method
- `pnpm --filter @manyhands/daemon typecheck` (passed: exit code 0)
- Inspect generated files:
  - `apps/daemon/README.md`
  - `apps/web/README.md`
  - `native/windows-job-runner/README.md`
  - `native/windows-ipc-acl/README.md`
