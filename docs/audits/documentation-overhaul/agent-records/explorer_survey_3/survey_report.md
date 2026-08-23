# ManyHands Technical Survey & Architectural Audit: Apps, Native Crates & Documentation

**Explorer:** Explorer 3  
**Target Areas:** `apps/daemon`, `apps/web`, `native/windows-job-runner`, `native/windows-ipc-acl`, `docs/modules/*`, `docs/README.md`  
**Date:** 2026-08-18  
**Working Directory:** `c:/Users/franc/Documents/Proyectos/Manyhands/.agents/explorer_survey_3`  
**Normative Plan Reference:** `docs/plans/2026-08-12-correctness-first-system-redesign.md`

---

## 1. Executive Summary

This report delivers a code-level architectural survey, type/interface catalog, and documentation audit for the host applications (`apps/daemon`, `apps/web`), native Windows helpers (`native/windows-job-runner`, `native/windows-ipc-acl`), and centralized documentation (`docs/modules/*`, `docs/README.md`).

### Key Findings Summary:
1. **`apps/daemon`**: Fully implemented local composition root and single authoritative writer for run journals. Employs a ticket-based Lamport mutual-exclusion guard algorithm for installation lease ownership (`daemon.lease`), authenticated HMAC-SHA256 named pipe/socket IPC, and fenced per-run actor supervision. **Gap:** `apps/daemon/README.md` is currently completely missing.
2. **`native/windows-job-runner`**: Pure Rust (no third-party dependencies, standard library + Win32 FFI) process custody runner. Implements dual nested Windows Job Objects with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, suspended process startup, kernel filetime start ticks identity binding, and checksummed `started.json`/`final.json` receipts.
3. **`native/windows-ipc-acl`**: Pure Rust helper for Windows IPC security. Applies and independently verifies protected DACLs (strictly Current User + Local System) for directories/files, and owns the public named pipe instance to proxy single-frame requests to an unadvertised Node backend pipe.
4. **`apps/web`**: Next.js 15 (App Router) + React 19 + Tailwind 4 + @xyflow/react frontend and Server BFF. Completely stripped of legacy lifecycle and process execution ownership. Acts strictly as an authenticated command/query client to the daemon via IPC. Implements loopback host checks, origin validation, SameSite session tokens, and event-sourced client projection reduction. **Gap:** `apps/web/README.md` contains UTF-8 character encoding corruption and references obsolete storage concepts.
5. **`docs/modules/*` & `docs/README.md`**: `docs/modules/` does not currently exist. `docs/README.md` serves as a high-level router to redesign audits and handoffs but lacks modular component breakdowns, interaction diagrams, and third-party developer onboarding.

---

## 2. `apps/daemon` Deep Technical Survey

### 2.1 Purpose & Role in System Lifecycle
`apps/daemon` is the privileged, durable local process owner and composition root of ManyHands. It is the sole authority permitted to append productive domain events to the canonical run journal (`JsonlRunEventStore`). It coordinates:
- Mutex installation leasing across system processes.
- Cryptographic local IPC server (Unix Domain Socket or Windows Named Pipe) with HMAC-SHA256 authentication and replay protection.
- Fenced Run Actors (`RunActor`) driven by the `DurableRunEngine`.
- Physical effect execution and reconciliation via adapters (`process_spawn`, `process_terminate`, `planning`, `delivery`, `model_call`, `git_mutation`, `artifact_materialize`, `validation`, `cleanup`).
- Startup crash recovery and interrupted process convergence.

### 2.2 Directory Layout & Internal Architecture
```
apps/daemon/
├── package.json
├── tsconfig.json
├── dist/                          # Compiled artifacts (CLI, worker entrypoints, CJS/ESM)
└── src/
    ├── index.ts                   # Barrel re-export of public daemon kernel and adapters
    ├── cli.ts                     # CLI entrypoint; parses env, resolves profile, starts daemon
    ├── daemon-kernel.ts           # Core daemon kernel; lifecycle leasing, event/receipt stores, IPC server
    ├── daemon-profile.ts          # Profile resolution: deterministic_fake, transitional_unsafe, sandboxed_live
    ├── productive-daemon.ts       # Productive composition: supervisor, adapters, application policy
    ├── product-run-application.ts # Decision and reaction policy mapping product commands to domain facts & effects
    ├── local-ipc-server.ts        # Net server, HMAC-SHA256 authentication, nonce replay cache, frame bounds
    ├── windows-ipc-acl.ts         # TypeScript wrapper for native windows-ipc-acl helper
    ├── installation-lease.ts      # Lamport bakery guard ticket lock & process start identity probe
    ├── installation-capability.ts # 256-bit base64url capability file generation and OS DACL enforcement
    ├── local-process-identity.ts  # Windows PowerShell ticks & Linux /proc/[pid]/stat start tick identity probes
    ├── process-effect-adapters.ts # Physical effect adapters bridging RunEngine to ProcessSupervisor
    ├── current-lifecycle-adapters.ts # Transitional adapters for PlanningEngine, RepositoryModel & TransactionalDelivery
    ├── canonical-planning-contract.ts# Contract builders for goal, proof strategy & validation obligations
    ├── node-activity.ts           # Read-side query for agent streaming activity from JsonlTraceStore
    ├── stage8-sandbox.ts          # Sandbox provider configuration & credential broker wiring (Codex)
    ├── transitional-repository-lease.ts # Mutex lease over local Git repository during execution
    ├── transitional-unsafe-profile.ts   # Bridge to transitional worker & result store
    ├── transitional-unsafe-worker.ts    # Child worker executing run attempts using CanonicalExecutionDriver
    └── deterministic-fake-worker.ts     # Offline fake worker with grandchild process tree for crash tests
```

### 2.3 Design Patterns & Technical Strategies
1. **Distributed Mutual Exclusion Guard (Lamport Bakery Algorithm)**:
   - Implemented in `installation-lease.ts`.
   - Before taking or releasing `daemon.lease`, a process must acquire an atomic directory claim inside `daemon.lease.guard/claims/<uuid>/owner.json`, write a monotonically increasing ticket in `ticket.json`, and wait for all claims with earlier tickets or lower UUIDs to clear.
   - Probes live process identity (`pid` + `processStartIdentity`) to clean up abandoned locks safely without race conditions.
2. **Epoch-Fenced Run Journaling**:
   - Every daemon instance mints a unique `daemonEpoch`.
   - `FencedRunActorJournal` verifies daemon authority before every event append, rejecting stale or superseded daemon processes.
3. **Local IPC Capability & Replay Cache**:
   - `ensureInstallationCapability` creates a 32-byte cryptographically secure random token in `.manyhands/daemon/installation/ipc-capability` with strict OS permissions (0600 on POSIX, protected DACL on Windows).
   - All IPC frames are signed via HMAC-SHA256 using canonical request/response materials.
   - `ExpiringNonceReplayCache` tracks `requestId` and `nonce` pairs to prevent replay attacks within clock skew limits (max clock skew 30s, TTL 60s).
4. **Physical Effect Dispatcher & Outbox Reconciliation**:
   - Physical work is expressed as content-addressed `EffectIntent` inputs stored in `FileEffectInputStore`.
   - Physical receipts are persisted in `FilePhysicalEffectReceiptStore`.
   - On daemon startup, `startupRecovery` discovers un-reconciled runs, recovers interrupted processes, cleans up brokered credentials, and restores actor states sequentially.
5. **Decoupled Application Policy vs Adapter Work**:
   - Application logic resides in `product-run-application.ts` (`decide` and `react`).
   - Adapters perform physical work only and return physical receipts; they are strictly forbidden from appending domain lifecycle events directly.

### 2.4 Exact Exported Symbols, Types & Contracts
| Symbol / Type | Location | Purpose |
|---|---|---|
| `startDaemonKernel` | `daemon-kernel.ts:87` | Core initialization function combining lease, IPC, engine, and stores |
| `DaemonKernel` | `daemon-kernel.ts:64` | Interface exposing `endpoint`, `daemonEpoch`, `startupRecovery`, `engine`, `close` |
| `startProductiveDaemon` | `productive-daemon.ts:98` | High-level productive entrypoint assembling supervisor and profile |
| `ProductiveDaemonProfile` | `productive-daemon.ts:75` | Union of `DeterministicFake`, `TransitionalUnsafe`, `SandboxedLive` profiles |
| `resolveDaemonProfile` | `daemon-profile.ts:20` | Resolves profile from `MANYHANDS_DAEMON_PROFILE` env |
| `acquireInstallationLease` | `installation-lease.ts:95`| Acquires exclusive installation lease with PID start ticks |
| `ensureInstallationCapability`| `installation-capability.ts:28`| Creates or loads the 256-bit IPC capability secret |
| `startLocalIpcServer` | `local-ipc-server.ts:65` | Starts Unix socket or Windows named-pipe server |
| `createProcessSpawnPhysicalEffectAdapter` | `process-effect-adapters.ts:50` | Effect adapter for spawning supervised processes |
| `createProcessTerminatePhysicalEffectAdapter`| `process-effect-adapters.ts:60` | Effect adapter for terminating supervised processes |
| `createProductRunApplication` | `product-run-application.ts:86` | Translates product commands into domain facts and effect intents |
| `readNodeActivity` | `node-activity.ts:47` | Query function extracting trace entries for specific run tasks |

### 2.5 CLI Commands & Environment Variables
- **CLI Entrypoint:** `node dist/cli.cjs` (built from `src/cli.ts`).
- **Stdout Protocol Event:** Emits `{"event":"manyhands.daemon.ready","endpoint":"...","daemonEpoch":"...","profile":"..."}` upon successful initialization.
- **Environment Variables:**
  - `MANYHANDS_DAEMON_STATE_ROOT`: Directory for daemon state (default: `.manyhands/daemon`).
  - `MANYHANDS_DAEMON_ENDPOINT`: Socket/Pipe path (default Windows: `\\.\pipe\manyhands-daemon-<sha256>`, Unix: `<stateRoot>/daemon.sock`).
  - `MANYHANDS_DAEMON_PROFILE`: `deterministic_fake` | `transitional_unsafe` | `sandboxed_live`.
  - `MANYHANDS_WINDOWS_JOB_RUNNER`: Absolute path to `windows-job-runner.exe` (required on Windows).
  - `MANYHANDS_WINDOWS_IPC_ACL_HELPER`: Absolute path to `windows-ipc-acl.exe` (required for production IPC on Windows).
  - `MANYHANDS_CODEX_AUTH_PATH`: Path to auth file for `sandboxed_live`.
  - `MANYHANDS_STAGE8_WINDOWS_SANDBOX`: `elevated` | `unelevated`.

### 2.6 Transition Gaps & Audit Status
- **Missing File:** `apps/daemon/README.md` does not exist in the repository.
- **Transitional Workers:** `transitional-unsafe-worker.ts` and `current-lifecycle-adapters.ts` remain transitional bridges pending Stage 11/12 cleanup, but their boundary is strictly isolated behind daemon effect intents and result stores.

---

## 3. `native/windows-job-runner` Deep Technical Survey

### 3.1 Purpose & Role in System Lifecycle
`windows-job-runner` is a native, dependency-free Rust executable providing kernel-enforced process containment and lifecycle supervision on Windows. It guarantees that spawned agent processes and all their child/grandchild descendants are terminated cleanly without orphan processes, even across daemon crashes or abrupt terminations.

### 3.2 Win32 Kernel Architecture & Rust Design
- **Source File:** `native/windows-job-runner/src/main.rs` (1,053 lines of Rust).
- **Cargo Config:** `native/windows-job-runner/Cargo.toml` (zero external dependencies, links directly to `kernel32`).
- **Mechanisms:**
  1. **Dual Nested Job Objects:**
     - `custodian_job`: Created with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The runner assigns its own current process (`GetCurrentProcess()`) to this job.
     - `provider_job`: Created with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The target executable process is assigned to this job.
  2. **Suspended Spawn & Verification:**
     - Process is created using `CreateProcessW` with flags `CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT`.
     - Job object assignment is verified with `IsProcessInJob` before resuming execution.
  3. **Kernel Creation Time Identity:**
     - Queries creation timestamp ticks via `GetProcessTimes` for both custodian and provider.
     - Outputs identity format: `windows:start-ticks:<ticks>`.
  4. **Atomic Checksummed Receipts:**
     - Publishes `started.json` with SHA-256 checksum, custodian PID/ticks, provider PID/ticks, and effect bindings.
     - Only after `started.json` is flushed and synced does the runner call `ResumeThread`.
  5. **Termination & Descent Verification:**
     - On stdin closure (parent daemon termination) or timeout/completion, calls `TerminateJobObject`.
     - Queries `GetJobObjectInformation` (`active_process_limit == 0`) to verify all descendants have terminated before publishing `final.json`.

### 3.3 CLI Commands & Protocol
1. `manyhands-windows-job-runner run <request_file_path>`:
   - Reads binary length-prefixed request buffer specifying: `job_name`, `receipt_directory`, `executable`, `argv`, `cwd`, `env`, `stdout_path`, `stderr_path`, `timeout_ms`, `effect_id`, `input_digest`, `daemon_epoch`, `attempt_id`.
   - Runs supervised process, streams stdio to files, writes `started.json` and `final.json`.
2. `manyhands-windows-job-runner probe <pid> <expected_creation_identity>`:
   - Queries kernel process start time for `<pid>` and exits `0` only if the process is currently alive and matches `<expected_creation_identity>`.
3. `manyhands-windows-job-runner terminate <job_name> <custodian_pid> <custodian_identity> <provider_pid> <provider_identity>`:
   - Probes identities of both custodian and provider; opens existing Job Objects and terminates them safely. Never performs blind PID termination.

### 3.4 Status of `native/windows-job-runner/README.md`
- The current `README.md` is in English, accurate regarding the dual-job architecture and Win32 limits.
- **Update required:** Needs translation into comprehensive Spanish documentation with exact CLI parameter syntax, JSON receipt structures, and error conditions.

---

## 4. `native/windows-ipc-acl` Deep Technical Survey

### 4.1 Purpose & Role in Security Boundary
`windows-ipc-acl` is a native Rust utility enforcing operating system-level Access Control Lists (DACLs) on Windows IPC resources (Named Pipes, capability directories, and capability secret files). It prevents local privilege escalation and cross-user snooping by restricting access exclusively to the **Current User** and **Local System (NT AUTHORITY\SYSTEM)**.

### 4.2 Win32 Security Architecture & Rust Design
- **Source File:** `native/windows-ipc-acl/src/main.rs` (934 lines of Rust).
- **Cargo Config:** `native/windows-ipc-acl/Cargo.toml` (zero external dependencies, links directly to `kernel32`, `advapi32`).
- **Key Win32 Techniques:**
  1. **Reparse Point Defense:** Opens file/directory handles using `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS` to reject symlinks and junction points.
  2. **Strict Owner Assertion:** Reads token owner (`GetTokenInformation(TokenUser)`) and verifies that the file/directory/pipe owner matches the current user SID.
  3. **Protected DACL Construction:**
     - Builds an absolute security descriptor with `PROTECTED_DACL_SECURITY_INFORMATION` (`SE_DACL_PROTECTED`).
     - Adds exactly two `ACCESS_ALLOWED_ACE` entries:
       - Current User SID (`FILE_ALL_ACCESS`, inheritance flags on directories: `OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE`).
       - Local System SID (`WinLocalSystemSid` / `S-1-5-18`, `FILE_ALL_ACCESS`).
     - Explicitly strips all inherited and world-readable ACEs.
  4. **First Pipe Instance Proxy:**
     - In `serve-pipe` mode, creates the public pipe with `FILE_FLAG_FIRST_PIPE_INSTANCE | PIPE_REJECT_REMOTE_CLIENTS` and the protected DACL.
     - Connects to an unadvertised private backend pipe created by Node.js, proxying bidirectional framed traffic.
     - Emits `READY\n` on stdout when listening.

### 4.3 CLI Commands & Syntax
1. `manyhands-windows-ipc-acl serve-pipe <public_endpoint> <backend_endpoint>`:
   - Creates restricted public named pipe and proxies framed connections to the backend.
2. `manyhands-windows-ipc-acl verify-pipe <public_endpoint>`:
   - Connects to the public pipe, inspects `GetSecurityInfo`, and verifies that the DACL is protected and contains only the expected two ACEs.
3. `manyhands-windows-ipc-acl apply <directory|file> <target_path>`:
   - Applies protected DACL to the target filesystem path.
4. `manyhands-windows-ipc-acl verify <directory|file> <target_path>`:
   - Inspects target path and exits `0` if and only if owner and DACL match strict requirements.

### 4.4 Status of `native/windows-ipc-acl/README.md`
- Accurate description of the proxying and DACL model in English.
- **Update required:** Needs comprehensive Spanish documentation, detailed Win32 error code handling explanations, and concrete usage examples with `apps/daemon`.

---

## 5. `apps/web` Deep Technical Survey

### 5.1 Purpose & Role as Server BFF Client
`apps/web` provides the user interface (Command Center and Run Cockpit) and acts as an authenticated server-side Backend-for-Frontend (BFF) client to `apps/daemon`. It contains:
- Zero background execution workers or process lifecycle ownership.
- Pure Next.js server actions and API route handlers that sign and forward commands to the daemon.
- Event-sourced UI projection via React Flow (`@xyflow/react`) and custom reducers.

### 5.2 Directory Layout & Subsystems
```
apps/web/
├── package.json                   # Next.js 15.5.7, React 19.2.6, Tailwind 4.3.0, @xyflow/react 12.10.2
├── README.md                      # Web app overview (contains encoding flaws)
└── src/
    ├── app/
    │   ├── layout.tsx             # Root layout: lists runs from daemon for sidebar preview
    │   ├── page.tsx               # Command Center home page
    │   ├── (command-center)/      # Workspace picker, prompt input, model/effort controls
    │   ├── runs/
    │   │   ├── [runId]/           # Run Cockpit workspace page (server component + client view)
    │   │   └── proto/[fixture]/   # Prototype fixture playback runner
    │   └── api/                   # Server API routes (BFF endpoints to daemon)
    └── lib/
        ├── run-model/             # Reducer, flow layout, graph projection, SSE adapter, types
        ├── server/
        │   ├── daemon/            # IPC client (productive-client.ts, local-ipc-client.ts)
        │   ├── security/          # Local API boundary: host/origin/cookie validation (boundary.ts)
        │   ├── runs/              # Schema, target context capture, product presenter
        │   ├── workspaces/        # Local workspace persistence and repository reference locks
        │   └── providers/         # Model provider readiness and command detection
        └── ...
```

### 5.3 Security Boundary (`src/lib/server/security/boundary.ts`)
To protect local system administration from malicious web pages and browser threats:
1. **Loopback Host Allowlist:** Restricts Host header to `localhost`, `127.0.0.1`, `[::1]`, or `MANYHANDS_ALLOWED_HOSTS` to defeat DNS rebinding attacks.
2. **Origin Validation:** Rejects requests with foreign or opaque `null` origins to prevent CSRF.
3. **Session Token Capability:** Requires `mh_session` cookie (SameSite=Strict) or `x-manyhands-session` header on all mutation routes and sensitive streams (`/api/runs/*/run-events`, terminal, filesystem).
4. **Content-Type Constraint:** Enforces `application/json` on all state-changing HTTP methods (POST, PUT, PATCH, DELETE).

### 5.4 Complete HTTP & SSE API Route Catalog
All routes located under `src/app/api/`:
| Route | Method | Daemon Operation | Description |
|---|---|---|---|
| `/api/runs` | `GET` | `query(list)` | Lists runs filtered by workspace, status, or archive state |
| `/api/runs` | `POST` | `submit(create_run)` | Captures Git target context & creates a new run |
| `/api/runs/[id]` | `GET` | `query(projection)` | Returns full `RunProjection` for a run |
| `/api/runs/[id]` | `PATCH` | `submit(rename/archive)`| Renames run title or sets archived flag |
| `/api/runs/[id]/run` | `POST` | `submit(start/continue)`| Starts or continues execution wave |
| `/api/runs/[id]/pause` | `POST` | `submit(pause_run)` | Pauses execution wave |
| `/api/runs/[id]/resume` | `POST` | `submit(resume_run)` | Resumes paused execution |
| `/api/runs/[id]/restart` | `POST` | `submit(restart_run)`| Restarts interrupted execution attempt |
| `/api/runs/[id]/cancel` | `POST` | `submit(cancel_run)` | Cancels run and terminates active processes |
| `/api/runs/[id]/decisions/[decisionId]` | `POST` | `submit(resolve_decision)` | Resolves human gate (approve plan, validation, etc.) |
| `/api/runs/[id]/deliver` | `POST` | `submit(deliver_run)` | Publishes verified change to target Git ref |
| `/api/runs/[id]/run-events` | `GET` | `eventsReady(long-poll)`| Server-Sent Events stream of canonical `RunEvent`s |
| `/api/runs/[id]/nodes/[nodeId]/activity` | `GET` | `query(activity)` | Paginated streaming activity/traces for a node |
| `/api/health` | `GET` | (local probe) | Health check endpoint |
| `/api/capabilities` | `GET` | (local probe) | Model and provider capability declarations |
| `/api/providers/readiness` | `GET` | (local probe) | CLI tool installation readiness (git, codex, etc.) |
| `/api/local-fs/pick-folder` | `POST` | (PowerShell/Zenith)| Native OS folder picker dialog for repository selection |
| `/api/workspaces` | `GET/POST`| (workspace store) | CRUD for local workspace directories |

### 5.5 UI Run Model & Graph Visualization
- **`buildRunModel` / `reduceRunEvents`** (`src/lib/run-model/reducer.ts`):
  - Pure event reducer folding canonical `RunEvent` streams into `RunProjection`, `RunGraphView`, `RunNodeView`s, and `EvidenceMatrix`.
  - Supports dual schema graphs: `canonicalGraphView` (primary target) and `legacyGraphView` (historical replay).
- **React Flow Graph Canvas** (`src/app/runs/[runId]/_components/cockpit-run-graph.tsx`):
  - Nodes: `task-node-v2.tsx` (tasks with status badge, effort, contracts, evidence), `flow-band-node.tsx` (composite bands).
  - Edges: `InteractiveRelationEdge.tsx` (typed relations: parent, artifact requirement, seam binding, resource claim).
  - **No Automatic Viewport Jump:** Follows product principle 1 & WCAG rules — does not force `fitView` or recenter canvas automatically upon run events. Auto-framing is user-toggleable via toolbar.
- **Accessible Decisions Drawer** (`DecisionQueueDrawer.tsx`, `accessible-dialog.tsx`):
  - Complies with WCAG 2.2 AA (focus traps, keyboard navigation `Esc`/`Enter`, high-contrast borders).
  - Supports diff inspection (`SideBySideDiffViewer.tsx`) and seam inspection (`SeamContractInspector.tsx`).

### 5.6 Status of `apps/web/README.md`
- **Encoding Issues:** Contains corrupt UTF-8 sequences (`proyecciÃ³n`, `ejecuciÃ³n`, `publicaciÃ³n`).
- **Outdated Claims:** Mentions `RunRecord` as owning persistence, and references variables like `MANYHANDS_RUNS_DIR` which are daemon-owned.
- **Update required:** Comprehensive rewrite in clean Spanish reflecting the pure BFF client model.

---

## 6. Centralized Documentation Audit (`docs/`)

### 6.1 Catalog of Documentation Tree
```
docs/
├── README.md                                          # Documentation entrypoint & audit status
├── agents/                                            # Agent operating runbooks
│   ├── correctness-first-execution.md
│   ├── domain.md
│   ├── issue-tracker.md
│   └── triage-labels.md
├── plans/                                             # Normative architecture & stage plans
│   ├── 2026-08-12-correctness-first-system-redesign.md # Canonical redesign specification
│   ├── 2026-08-13-exploratory-longitudinal-study.md
│   ├── 2026-08-14-stage-7-git-native-artifacts-and-exact-validation.md
│   ├── 2026-08-14-stage-9-hierarchical-integration-and-bounded-parallelism.md
│   ├── 2026-08-14-stage-10-crash-safe-exact-delivery.md
│   ├── 2026-08-15-remaining-stages-to-gprod.md
│   └── 2026-08-15-stage-10-crash-safe-exact-delivery.md
├── handoffs/                                          # Stage transition handoff records (Stages 2->3, 3->4, 4->5, 5->6, 6->7)
├── audits/                                            # Attributable audit logs & evidence for Stages 0 through 12
└── tesis/                                             # Academic / historical evidence (frozen)
```

### 6.2 Inspection of `docs/modules/`
- **Current Status:** `docs/modules/` **does not exist**.
- **Requirement R3 Gap:** The project requires a centralized, structured, and pedagogical architectural documentation set under `docs/modules/` covering every package, app, and native helper, along with an interaction index in `docs/README.md`.

### 6.3 Link Health & Consistency Audit in `docs/README.md`
1. **Verified Active Links:**
   - `../PRODUCT.md` — Active.
   - `plans/2026-08-12-correctness-first-system-redesign.md` — Active.
   - `agents/correctness-first-execution.md` — Active.
   - `audits/stage-0/` through `audits/stage-10/` — Active.
   - `audits/stage-8/evidence/review-gate.md` — Active.
   - `handoffs/` files — Active.
2. **Missing/Incomplete Sections in `docs/README.md`:**
   - Lacks a modular index directing third-party engineers to module-specific architecture guides (`docs/modules/*`).
   - Lacks an end-to-end system lifecycle diagram (Planning -> Graph -> Execution -> Validation -> Persistence -> Daemon/UI).
   - Lacks a public interface table mapping IPC, CLI, and HTTP protocols across boundaries.

---

## 7. Consolidated Transition Gap Matrix

| Component | Target Architecture Requirement | Current Implementation Status | Gap / Debt | Recommended Action |
|---|---|---|---|---|
| `apps/daemon` | Privileged process owner & single journal writer | Fully implemented (`startProductiveDaemon`, `daemon-kernel.ts`, `local-ipc-server.ts`) | `README.md` is missing entirely | Create `apps/daemon/README.md` in Spanish detailing architecture, IPC protocol, leasing algorithm, and CLI flags. |
| `native/windows-job-runner` | Dual Job Object process containment & receipts | Fully implemented in Rust (`main.rs`) | Existing `README.md` is English-only and brief | Expand `native/windows-job-runner/README.md` in Spanish with Win32 limits, receipt schemas, and recovery details. |
| `native/windows-ipc-acl` | OS-restricted DACLs & first-pipe proxy | Fully implemented in Rust (`main.rs`) | Existing `README.md` is English-only and brief | Expand `native/windows-ipc-acl/README.md` in Spanish with DACL structure, Win32 error codes, and IPC proxying. |
| `apps/web` | Pure server-side BFF client to daemon; no local worker | Fully implemented (API routes forward commands via IPC, 24 legacy web owner files removed) | `README.md` has corrupted UTF-8 encoding and references obsolete `RunRecord` persistence | Rewrite `apps/web/README.md` in clean Spanish with full API catalog, security boundary, and React Flow UI details. |
| `docs/modules/*` | Centralized modular architecture guides for third parties | Nonexistent (`docs/modules/` directory does not exist) | Missing entire subsystem documentation tree | Create `docs/modules/` with structured guides for Daemon, Web, Native, Contracts, Decomposer, Engine, Execution, Store, etc. |
| `docs/README.md` | Central navigation hub with lifecycle & interaction maps | High-level audit status router | Lacks module index and lifecycle interaction maps | Update `docs/README.md` to link all `docs/modules/*` guides and provide system interaction diagrams. |

---

## 8. Recommendations for Next Stages

1. **For README Writers (`packages/*/README.md`, `apps/*/README.md`, `native/*/README.md`):**
   - Write clear, pedagogical Spanish documentation while retaining exact English symbols, types, and error codes.
   - Explicitly document the design decisions: why Lamport bakery guard is used in `installation-lease.ts`, why nested Job Objects with suspended thread resumption are used in `windows-job-runner`, why DACL inheritance is applied in `windows-ipc-acl`, and how `boundary.ts` stops DNS rebinding and CSRF in `apps/web`.
2. **For Centralized Architecture Guide Writers (`docs/modules/*` and `docs/README.md`):**
   - Create dedicated modular guides under `docs/modules/`:
     - `docs/modules/daemon.md`
     - `docs/modules/web.md`
     - `docs/modules/windows-job-runner.md`
     - `docs/modules/windows-ipc-acl.md`
     - ... (and corresponding package guides).
   - In `docs/README.md`, add a system lifecycle map illustrating the flow from user prompt -> repository grounding -> decomposition & graph compilation -> daemon execution wave & sandboxed attempts -> exact validation -> transactional git delivery.
