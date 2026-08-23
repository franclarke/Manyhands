# Handoff Report — Explorer 3: Apps, Native Crates & Documentation Audit

## 1. Observation
1. **`apps/daemon` Source and Entrypoints**:
   - `apps/daemon/src/index.ts:1-12`: Exports `daemon-kernel.js`, `daemon-profile.js`, `current-lifecycle-adapters.js`, `installation-capability.js`, `installation-lease.js`, `local-process-identity.js`, `local-ipc-server.js`, `process-effect-adapters.js`, `product-run-application.js`, `productive-daemon.js`, `transitional-unsafe-profile.js`, `windows-ipc-acl.js`.
   - `apps/daemon/src/cli.ts:46-60`: Initializes `startProductiveDaemon` passing `windowsJobRunnerPath`, `windowsAclHelperPath`, `protectCapabilityPath`, and emits stdout ready event `{"event": "manyhands.daemon.ready", ...}`.
   - `apps/daemon/src/installation-lease.ts:95-130`: Implements Lamport bakery mutual exclusion directory ticket lock inside `daemon.lease.guard` with process start ticks verification.
   - `apps/daemon/src/local-ipc-server.ts:65-166`: Creates local IPC server with HMAC-SHA256 authenticated framing, constant-time token comparison via `timingSafeEqual`, frame bounds checking (`maxFrameBytes`), and replay attack caching (`ExpiringNonceReplayCache`).
   - `apps/daemon/README.md`: Observed file absence (error opening file: `open c:/Users/franc/Documents/Proyectos/Manyhands/apps/daemon/README.md: The system cannot find the file specified.`).
2. **`native/windows-job-runner`**:
   - `native/windows-job-runner/Cargo.toml:1-8`: Rust 2021 edition, zero third-party dependencies, direct Win32 API usage.
   - `native/windows-job-runner/src/main.rs:286-303`: Exposes CLI commands `run`, `probe`, `terminate`.
   - `native/windows-job-runner/src/main.rs:305-335`: Creates dual nested Job Objects (`custodian_job` and `provider_job`) with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, spawns child process suspended with `CREATE_SUSPENDED`, records kernel creation filetime ticks, writes checksummed `started.json` receipt before calling `ResumeThread`, and verifies `active_process_limit == 0` before publishing `final.json`.
3. **`native/windows-ipc-acl`**:
   - `native/windows-ipc-acl/Cargo.toml:1-8`: Rust 2021 edition, zero third-party dependencies, links `kernel32`, `advapi32`.
   - `native/windows-ipc-acl/src/main.rs:269-285`: Exposes CLI operations `serve-pipe`, `verify-pipe`, `apply`, `verify`.
   - `native/windows-ipc-acl/src/main.rs:35-45`: Uses `FILE_FLAG_OPEN_REPARSE_POINT` to reject junction points and builds protected DACLs (`SE_DACL_PROTECTED`) with exactly two ACEs: Current User and `WinLocalSystemSid` (`FILE_ALL_ACCESS`).
4. **`apps/web`**:
   - `apps/web/package.json:16-41`: Dependencies include Next.js 15.5.7, React 19.2.6, Tailwind CSS 4.3.0, `@xyflow/react` 12.10.2.
   - `apps/web/src/lib/server/security/boundary.ts:115-159`: Evaluates local API boundary: restricts `Host` header to loopback (`localhost`, `127.0.0.1`, `[::1]`), verifies `Origin`, enforces `Content-Type: application/json` on mutations, and requires `mh_session` cookie / `x-manyhands-session` header for mutations and live streams.
   - `apps/web/src/lib/server/daemon/productive-client.ts:46-78`: Communicates directly with `apps/daemon` via authenticated local IPC client; contains no background execution threads or journal event stores.
   - `tests/stage3-web-productive-boundary.test.ts:34-60`: 24 retired legacy web owner files (`runner-state.ts`, `run-operation-lease.ts`, `command-host.ts`, etc.) were completely deleted.
   - `apps/web/README.md:1-45`: Contains corrupted UTF-8 encoding (e.g. `proyecciÃ³n`, `ejecuciÃ³n`, `publicaciÃ³n`) and references obsolete `RunRecord` storage.
5. **`docs/` and Central Documentation**:
   - `docs/modules/`: Directory does not exist on disk.
   - `docs/README.md:1-66`: Serves as an audit/plan router but lacks module-by-module breakdown, interaction sequence diagrams, and third-party developer onboarding.

---

## 2. Logic Chain
1. *From Observation 1*: `apps/daemon` has established itself as the sole composition root and journal writer. Its architecture combines distributed leasing, cryptographic IPC, and fenced actor dispatch. Because `apps/daemon/README.md` is missing, developers encountering `apps/daemon` have no entrypoint guide explaining how to configure profiles or IPC parameters.
2. *From Observation 2 & 3*: The two native Windows crates (`windows-job-runner` and `windows-ipc-acl`) provide the low-level operating system boundary guarantees (process containment via dual Job Objects and Named Pipe ACL security). They are functionally complete, standalone, and free of external crates, but their existing READMEs are brief and in English.
3. *From Observation 4*: `apps/web` has successfully transitioned into a pure Server BFF and projection client for `apps/daemon`. The UI code respects the redesign rules (no auto-recentering React Flow canvas, accessible WCAG 2.2 AA decision dialogs, event-sourced reducers). However, its existing README is outdated and corrupted by UTF-8 encoding flaws.
4. *From Observation 5*: Central documentation under `docs/` is currently missing the entire `docs/modules/` directory required by R3. Furthermore, `docs/README.md` requires an overhaul to become a navigational guide for third parties.

---

## 3. Caveats
- **Live Model Execution**: No live model API keys (Codex/Claude) were invoked during this survey, as this was a read-only investigation in accordance with the execution protocol.
- **Stage 8 Review Status**: Stage 8 / GLeaf is recorded in `docs/plans/2026-08-12-correctness-first-system-redesign.md` and `docs/audits/stage-8/evidence/review-gate.md` as `in_review` (with finding B1 awaiting a single live R0 re-run under the corrected capability record). This status was documented as-is.

---

## 4. Conclusion
The technical architecture of `apps/daemon`, `apps/web`, `native/windows-job-runner`, and `native/windows-ipc-acl` is robust, highly cohesive, and adheres strictly to the canonical redesign plan (`2026-08-12-correctness-first-system-redesign.md`). 

The primary action items for the documentation overhaul are:
1. Author `apps/daemon/README.md` in Spanish describing daemon architecture, lease guard mechanism, profiles, and IPC protocol.
2. Rewrite `apps/web/README.md` in Spanish fixing UTF-8 encoding, documenting all 18 API routes, the security boundary (`boundary.ts`), and the React Flow UI architecture.
3. Update `native/windows-job-runner/README.md` and `native/windows-ipc-acl/README.md` in Spanish with exact CLI syntax, Win32 mechanisms, and receipt schemas.
4. Create the `docs/modules/` directory with detailed technical guides (`daemon.md`, `web.md`, `windows-job-runner.md`, `windows-ipc-acl.md`, etc.).
5. Update `docs/README.md` to serve as the unified navigation hub and system lifecycle map.

Detailed findings and exact symbol tables are available in:
`c:\Users\franc\Documents\Proyectos\Manyhands\.agents\explorer_survey_3\survey_report.md`.

---

## 5. Verification Method
1. **File Existence & Integrity Inspection**:
   - Inspect `survey_report.md` at `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\explorer_survey_3\survey_report.md`.
   - Verify `apps/daemon/package.json`, `apps/daemon/src/index.ts`, and `apps/daemon/src/cli.ts`.
   - Verify `apps/web/src/lib/server/security/boundary.ts` and `apps/web/src/lib/server/daemon/productive-client.ts`.
   - Verify `native/windows-job-runner/src/main.rs` and `native/windows-ipc-acl/src/main.rs`.
2. **Typecheck & Test Verification Commands**:
   - `pnpm -r --filter "./apps/*" typecheck`
   - `pnpm --filter @manyhands/web exec tsc --noEmit`
   - `pnpm vitest run tests/stage3-web-productive-boundary.test.ts tests/daemon-kernel.test.ts tests/daemon-local-ipc.test.ts`
