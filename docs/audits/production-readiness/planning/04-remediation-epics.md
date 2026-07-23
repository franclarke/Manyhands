# 04 — Architectural Remediation Epics Specification

**Target System**: ManyHands Monorepo (`apps/web`, `packages/*`)  
**Document Version**: 2.0.0  
**Status**: Formal Specification (Local Product Alignment)  
**Author**: Principal Engineering Review Board (Planning Worker 3)  
**Date**: 2026-07-22  

---

## 1. Executive Summary & Product Scope

ManyHands is a **local, single-user, self-hosted software engineering coordinator** designed to run on a developer's local machine (`localhost / 127.0.0.1`). It coordinates local AI agent sub-processes to transform software goals into verified, integrated codebase changes. **ManyHands is NOT a multi-tenant SaaS, cloud enterprise platform, or remote web service.**

### Threat Model & Boundaries (Local Self-Hosted Product)
- **Local Human Developer**: TRUSTED. Has local shell access and owns the developer workstation.
- **Untrusted Inputs**: Cloned software repositories, untrusted file names, symlinks, Git hooks, external dependencies, untrusted web snippets, indirect prompt injection payloads in source files, LLM outputs, and agent-proposed shell commands.
- **Network Boundary**: Web server and API endpoints MUST bind exclusively to `127.0.0.1` / `::1` with strict CSRF/Origin verification.
- **Finding Classification Taxonomy**:
  - `BLOCKER_LOCAL_PRODUCT`: Must be fixed for safe/correct local operation.
  - `REQUIRED_FOR_LOCAL_RELIABILITY`: Critical for crash resilience, data integrity, or execution state.
  - `LOCAL_HARDENING`: Security, path traversal, or resource isolation improvements on host.
  - `OPTIONAL_IMPROVEMENT`: Non-critical code cleanup or minor UX enhancements.
  - `OUT_OF_SCOPE_SAAS`: Features exclusive to multi-tenant cloud/SaaS (OAuth, SSO, RBAC, billing, multi-tenant DBs, K8s).
  - `FALSE_POSITIVE_FOR_LOCAL_MODEL`: Audit findings that assume multi-tenant cloud context inapplicable to single-user local deployment.

---

## 2. Redefined Product Readiness Levels (PRL)

| Level | Name | Primary Staging Target | Scope & Capabilities | Exit Criteria |
|---|---|---|---|---|
| **Level A** | **Local Thesis & Dev** | Local Developer Workstation (Baseline) | Initial prototype; hybrid task graph decomposition; basic worktree creation; local Web UI. | Grounding workspace isolation; basic unit test suite. |
| **Level B** | **Secure Local Use** | Host-Protected Workstation | Host repository protection (`git status --porcelain`); path traversal guards; supervised process registry; fenced lock ownership; conflict-aware wave scheduling. | Zero dirty workspace staging (`MH-AUDIT-GIT-010`); zero foreign lock deletions (`MH-AUDIT-PERS-001`); path traversal guards (`MH-AUDIT-SEC-002`). |
| **Level C** | **Reliable Local Beta** | Durable Local Workstation | Event log compaction & snapshot truncation; high-throughput stream writes; durable local trace logs (`JsonlTraceStore`); SSE disconnect teardown; incremental state refolding (60fps UI); localhost API CSRF/Origin protection. | Compaction under long runs (`MH-AUDIT-GAP-001`); zero background timer leaks on SSE disconnect (`MH-AUDIT-API-001`); durable trace logging (`MH-AUDIT-QA-001`). |
| **Level D** | **Finished Local Product** | Production Local Package (Final Goal) | Complete local application (`git clone` -> `pnpm install` -> `agy start`); local prompt injection envelopes; pre-execution token budget spending caps (`maxBudgetUsd`); local MCP sidecar capability sandboxing; standardized `workspace:*` dependencies; Playwright E2E browser tests; WCAG 2.2 AA accessibility. | Clean `pnpm build`; zero typecheck errors; full Playwright E2E pass; hard token budget caps enforced (`MH-AUDIT-AI-002`). |

---

## 3. The 8 Architectural Remediation Epics

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                 MANYHANDS REMEDIATION PROGRAM                                    │
 ├────────────────────────────────┬────────────────────────────────┬────────────────────────────────┤
 │ Epic 1: Task Graph & Canonical │ Epic 2: Worktree Security,     │ Epic 3: Persistence Engine &   │
 │ Relations Contract Engine      │ Process Supervision & Host     │ Atomic Event Store Recovery    │
 ├────────────────────────────────┼────────────────────────────────┼────────────────────────────────┤
 │ Epic 4: Execution Core, Base   │ Epic 5: API, SSE & Web UI      │ Epic 6: AI Security, Prompt    │
 │ Materialization & Fingerprint │ Local State Synchronization    │ Protection & Token Governance  │
 ├────────────────────────────────┴────────────────────────────────┴────────────────────────────────┤
 │ Epic 7: Infrastructure, Supply Chain & Build Hardening                                           │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Epic 8: QA, Observability & End-to-End Test Infrastructure                                       │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Epic 1: Task Graph & Canonical Relations Contract Engine

- **Epic ID**: `EPIC-01`
- **Primary Goal**: Establish a mathematically sound, cycle-free hybrid task graph compiler and conflict-aware wave scheduler backed by four canonical typed relations (`parentId`, `ArtifactRequirement`, `SeamBinding`, `ConflictConstraint`) and immutable `GraphRevision` reductions.
- **Architecture Target**: ADR-001. Resolves DAG validation gaps, wave selector conflict omissions, and execution driver promise concurrency races.
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Scope & System Boundaries**:
  - `packages/task-graph` (validation, graph reducer, typed relation schemas)
  - `packages/scheduler` (wave selection, conflict risk analyzer integration)
  - `packages/orchestrator-graph` (v2 execution driver compare-and-swap state)
- **Included Audit Findings**: `MH-AUDIT-ORCH-001` (P1), `MH-AUDIT-ORCH-002` (P1), `MH-AUDIT-ORCH-003` (P1), `MH-AUDIT-ORCH-004` (P1), `MH-AUDIT-GAP-010` (P1).
- **Included Backlog Items**: `MH-REM-001` through `MH-REM-006`.
- **Key Architectural Deliverables**:
  1. Kahn's algorithm topological cycle detector operating over combined `parentId` and `ArtifactRequirement` edges in `validateGraphRevision`.
  2. Conflict-aware wave selector filtering ready candidate nodes against active wave nodes using `ConflictConstraint` contracts and `ConflictRiskAnalyzer`.
  3. Compare-and-swap (CAS) lock-free execution driver state reducer eliminating promise mutation races in `V2ExecutionDriver`.
  4. Calibrated scope isolation critic preventing false-positive rejection of valid leaf node edits.
  5. Immutable `GraphRevision` reducer guaranteeing versioned, traceable graph state transitions.
- **Target Readiness Level**: **Level B** (Secure Local Use).

---

### Epic 2: Worktree Security, Process Supervision & Host Sandboxing

- **Epic ID**: `EPIC-02`
- **Primary Goal**: Protect the developer's host filesystem and secrets from contamination or leaks, enforce strict path traversal boundaries, guarantee process lifecycle supervision, and clean up temporary worktrees and branches.
- **Architecture Target**: ADR-002. Resolves P0 GroundingAgent workspace contamination, scope traversal vulnerabilities, secret environment leaks, worktree resource leaks, and Git lock contention.
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Scope & System Boundaries**:
  - `packages/execution-core` (grounding agent, scope checker, Git runner, supervised process manager)
  - `apps/web/src/lib/server/runs/v2` (run coordinator host, execution pipeline)
- **Included Audit Findings**: `MH-AUDIT-GIT-010` (P0), `MH-AUDIT-SEC-001` (P1), `MH-AUDIT-SEC-002` (P1), `MH-AUDIT-GIT-001` (P1), `MH-AUDIT-GIT-005` (P1), `MH-AUDIT-GIT-007` (P1).
- **Included Backlog Items**: `MH-REM-007` through `MH-REM-013`.
- **Key Architectural Deliverables**:
  1. `git status --porcelain` dirty workspace checker in `GroundingAgent` aborting or isolating skeleton creation if uncommitted user files exist.
  2. Absolute path normalization (`path.resolve`) and `worktreeRoot` prefix enforcement in `ScopeChecker` preventing `../` traversal.
  3. `SupervisedProcessManager` and `LiveProcessRegistry` filtering process environment variables via `buildAgentEnvironment()` and tracking active PIDs for clean termination on cancellation.
  4. Mandatory `finally` block `gcRun()` execution in execution pipelines destroying temporary worktree directories and Git branches.
  5. Exponential backoff retry loop with random jitter handling `.git/index.lock` contention.
  6. Explicit fallback Git committer identity (`ManyHands Bot <bot@manyhands.dev>`) for automated commits.
  7. Local process isolation architecture for executing agent commands in host worktrees without root privileges.
- **Target Readiness Level**: **Level B** (Secure Local Use) & **Level D** (Finished Local Product).

---

### Epic 3: Persistence Engine & Atomic Event Store Recovery

- **Epic ID**: `EPIC-03`
- **Primary Goal**: Build a crash-resilient, high-performance local file-based persistence engine featuring fenced lock ownership, atomic `fsync` file writes, event store compaction, snapshot truncation, and durable diagnostic trace logging.
- **Architecture Target**: ADR-003. Resolves P0 foreign lock deletion, atomic rename retry leaks, missing attempt store update methods, missing event log compaction, $O(N^2)$ append write loops, and trace log data evaporation.
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Scope & System Boundaries**:
  - `packages/run-store` (durable lock, JSONL event store, attempt store, event store compactor)
  - `packages/trace-store` (JSONL trace store, telemetry writer)
- **Included Audit Findings**: `MH-AUDIT-PERS-001` (P0), `MH-AUDIT-PERS-002` (P1), `MH-AUDIT-PERS-004` (P1), `MH-AUDIT-PERS-006` (P1), `MH-AUDIT-QA-001` (P1), `MH-AUDIT-GAP-001` (P1), `MH-AUDIT-GAP-008` (P1).
- **Included Backlog Items**: `MH-REM-014` through `MH-REM-020`.
- **Key Architectural Deliverables**:
  1. Fenced lock ownership protocol writing `owner.json` (PID + acquiredAt + UUID token) inside lock directories and verifying tokens before release.
  2. Atomic file write engine executing `fsync()` on file descriptors and retrying renames with jittered exponential backoff (10ms, 20ms, 40ms).
  3. `update(attemptId, patchFn)` method implementation in `JsonlAttemptStore`.
  4. Periodic event store snapshot compactor truncating historical events prior to the latest verified `RunSnapshot`.
  5. Refactored high-throughput `fs.appendFile` stream writer eliminating $O(N^2)$ full file re-writes on event append.
  6. Durable `JsonlTraceStore` persisting diagnostic telemetry to disk under `.manyhands/runs/<runId>/traces.jsonl`.
  7. Automated persistence crash recovery and log integrity verification utility.
- **Target Readiness Level**: **Level B** (Lock Fencing) & **Level C** (Reliable Local Beta).

---

### Epic 4: Execution Core, Base Materialization & Input Fingerprinting

- **Epic ID**: `EPIC-04`
- **Primary Goal**: Ensure absolute determinism, reproducibility, and immutability for node attempts by materializing explicit execution bases and calculating node-local input fingerprints.
- **Architecture Target**: ADR-004. Resolves non-deterministic base builds, stale attempt adopting races, and excessive worktree disk overhead.
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Scope & System Boundaries**:
  - `packages/execution-core` (base materializer, fingerprint calculator, worktree manager)
  - `packages/contracts` (artifact requirements, scope contracts)
  - `packages/orchestrator-graph` (attempt adoption engine)
- **Included Audit Findings**: `MH-AUDIT-ORCH-003` (P1), `MH-AUDIT-ORCH-004` (P1), `MH-AUDIT-GAP-009` (P1).
- **Included Backlog Items**: `MH-REM-021` through `MH-REM-026`.
- **Key Architectural Deliverables**:
  1. `ExecutionBaseBuilder` constructing attempt workspace directories by applying ONLY explicitly declared `ArtifactRequirement` commits onto baseline Git commits.
  2. Node-local `InputFingerprint` calculator combining node ID, contract hashes, base commit hash, artifact SHA-256 hashes, and executor profile while excluding global `GraphRevision` ID.
  3. Stale attempt rejection engine in `RunCoordinator` discarding attempt results whose input fingerprint no longer matches active node contracts.
  4. Optimized worktree disk footprint manager sharing local Git object storage via hardlinks or git alternate object store paths.
  5. `execution-base-manifest.json` generator recording exact base commit, applied artifact versions, and materialization timestamps.
  6. Attempt checksum verifier guaranteeing immutable attempt storage.
- **Target Readiness Level**: **Level B** (Secure Local Use).

---

### Epic 5: API, SSE & Web UI Local State Synchronization

- **Epic ID**: `EPIC-05`
- **Primary Goal**: Deliver a secure, high-performance, local Web application bound to `127.0.0.1` with CSRF/Origin protection, automatic SSE client disconnect teardown, incremental state synchronization (60fps UI), local confirmation dialogs, and WCAG 2.2 AA accessibility.
- **Architecture Target**: ADR-005. Resolves SSE server subscriber leaks, client browser freezing under $O(N^2)$ event refolding, unauthenticated local dialog spawning, and UI spacing bugs. Multi-tenant OAuth/JWT is classified as `OUT_OF_SCOPE_SAAS` and replaced with Localhost Origin & CSRF Guards.
- **Classification**: `LOCAL_HARDENING` / `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Scope & System Boundaries**:
  - `apps/web` (Next.js middleware, API routes, SSE route handler, client hooks, UI components)
  - `apps/web/src/lib/run-model` (client state refolding engine, snapshot projections)
- **Included Audit Findings**: `MH-AUDIT-API-001` (P1), `MH-AUDIT-API-002` (P1), `MH-AUDIT-API-006` (P1 - Localhost Guard), `MH-AUDIT-API-008` (P1 - Local Folder Dialog Guard), `MH-AUDIT-QA-003` (P2).
- **Included Backlog Items**: `MH-REM-027` through `MH-REM-033`.
- **Key Architectural Deliverables**:
  1. Next.js middleware restricting API requests to `127.0.0.1` / `::1` and verifying CSRF / Origin headers.
  2. SSE handler binding `request.signal.addEventListener('abort', ...)` to immediately cancel background event store subscribers on client disconnect.
  3. Native folder picker route guard requiring explicit user confirmation token before spawning native file picker dialogs.
  4. Incremental event fold engine in `useLiveRunModel` using bounded event buffers (max 500 events) and `Last-Event-ID` reconnection headers.
  5. UI tailwind class fix resolving cockpit fixture view off-grid spacing errors.
  6. Non-auto-recentering canvas viewport controller preserving user pan and zoom levels across run events.
  7. Full WCAG 2.2 AA accessibility overhaul supporting keyboard navigation, visible focus indicators, color-independent state indicators, and `prefers-reduced-motion`.
- **Target Readiness Level**: **Level C** (Reliable Local Beta) & **Level D** (Finished Local Product).

---

### Epic 6: AI Security, Prompt Protection & Token Governance

- **Epic ID**: `EPIC-06`
- **Primary Goal**: Protect ManyHands from indirect prompt injection embedded in untrusted cloned repositories, enforce local pre-execution token spending limits per run (`maxBudgetUsd`), and sandbox local MCP sidecar tool execution capabilities.
- **Architecture Target**: ADR-006. Resolves prompt injection risks via unsanitized repository files, uncapped token spending, and unrestricted sidecar capabilities.
- **Classification**: `LOCAL_HARDENING` / `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Scope & System Boundaries**:
  - `packages/decomposer` (work breakdown planner, prompt envelope, LLM decomposer)
  - `packages/shared` (sidecar wrapper, token budget ledger)
  - `apps/web/src/lib/server/runs/v2` (run coordinator host AI execution)
- **Included Audit Findings**: `MH-AUDIT-AI-001` (P1), `MH-AUDIT-AI-002` (P1), `MH-AUDIT-AI-003` (P1).
- **Included Backlog Items**: `MH-REM-034` through `MH-REM-039`.
- **Key Architectural Deliverables**:
  1. XML prompt envelope sanitizer wrapping untrusted user repository files in `<user_repository_file path="...">` tags and escaping inner closing tags.
  2. Pre-execution token spending governor (`TokenBudgetLedger`) evaluating `maxBudgetUsd` and rejecting requests with `TokenBudgetExceededError` before calling LLM providers.
  3. Sidecar MCP tool capability allowlists and parameter JSON schema validation wrappers preventing unauthorized local command execution.
  4. Prompt injection escaping library filtering system prompt override framing.
  5. Per-agent token cost attribution logger recording prompt and completion token counts in local event store metadata.
  6. Local model fallback router automatically switching to secondary API keys or local LLM instances (e.g. Ollama/vLLM) on primary provider rate limits or outages.
- **Target Readiness Level**: **Level D** (Finished Local Product).

---

### Epic 7: Infrastructure, Supply Chain & Build Hardening

- **Epic ID**: `EPIC-07`
- **Primary Goal**: Standardize monorepo workspace dependencies (`workspace:*`), ensure seamless local installation (`git clone` -> `pnpm install`), build reliability, and clean execution scripts.
- **Architecture Target**: ADR-007. Resolves workspace specifier inconsistencies and local build environment failures. Cloud K8s/Docker registry tasks are classified as `OUT_OF_SCOPE_SAAS`.
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Scope & System Boundaries**:
  - Root `package.json` and all `packages/*/package.json` manifests
  - Monorepo build and installation scripts
- **Included Audit Findings**: `MH-AUDIT-INFRA-001` (P2).
- **Included Backlog Items**: `MH-REM-040` through `MH-REM-044`.
- **Key Architectural Deliverables**:
  1. Monorepo dependency standardizer converting all internal package dependencies to `"workspace:*"`.
  2. Automated local build verification script checking package manifest integrity and preventing version drift.
  3. Clean local installation and startup configuration (`agy start` / `pnpm dev`).
  4. Standardized monorepo build scripts and Vitest configurations.
  5. Environment configuration verifier validating local API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) before run execution.
- **Target Readiness Level**: **Level D** (Finished Local Product).

---

### Epic 8: QA, Observability & End-to-End Test Infrastructure

- **Epic ID**: `EPIC-08`
- **Primary Goal**: Replace fragile UI text matching tests with React Testing Library DOM assertions, build Playwright end-to-end browser test suites for the local Web app, standardize test scripts, and provide local trace logging.
- **Architecture Target**: ADR-003, ADR-005, ADR-007. Resolves fragile UI tests, missing web E2E test suites, missing package test scripts, and unexported trace telemetry.
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Scope & System Boundaries**:
  - `tests/` monorepo test suite directory
  - `apps/web/tests` component & Playwright E2E tests
  - `packages/trace-store` local trace exporter
- **Included Audit Findings**: `MH-AUDIT-QA-001` (P1), `MH-AUDIT-QA-002` (P1), `MH-AUDIT-QA-003` (P2), `MH-AUDIT-QA-004` (P2).
- **Included Backlog Items**: `MH-REM-045` through `MH-REM-050`.
- **Key Architectural Deliverables**:
  1. Refactored UI test suite utilizing React Testing Library to render components in virtual DOM (JSDOM) and assert accessibility roles.
  2. Playwright E2E browser test suite covering run creation, live SSE graph visualization, decision banner interactions, and local execution completion.
  3. Package-level `test` scripts added to all `packages/*/package.json` manifests with updated Vitest glob patterns.
  4. Worktree lifecycle and concurrency integration test suite exercising dirty workspace checks and process registry cleanup.
  5. Synthetic task graph stress test generator verifying wave selector performance under high node loads.
  6. Local trace store log reader enabling developers to inspect agent diagnostic traces via local CLI or Web UI.
- **Target Readiness Level**: **Level C** (Reliable Local Beta) & **Level D** (Finished Local Product).

---

## 4. Epic Summary & Level Distribution

| Epic ID | Epic Name | Target Level | Classification | Backlog Items | Points |
|---|---|---|---|---|:---:|
| **EPIC-01** | Task Graph & Canonical Relations Engine | **Level B** | `BLOCKER_LOCAL_PRODUCT` | `MH-REM-001`..`006` | 24 |
| **EPIC-02** | Worktree Security & Process Supervision | **Level B / D** | `BLOCKER_LOCAL_PRODUCT` | `MH-REM-007`..`013` | 31 |
| **EPIC-03** | Persistence Engine & Event Store Recovery | **Level B / C** | `REQUIRED_FOR_LOCAL_RELIABILITY` | `MH-REM-014`..`020` | 29 |
| **EPIC-04** | Execution Core & Input Fingerprinting | **Level B** | `REQUIRED_FOR_LOCAL_RELIABILITY` | `MH-REM-021`..`026` | 22 |
| **EPIC-05** | API, SSE & Web UI Local Synchronization | **Level C / D** | `LOCAL_HARDENING` | `MH-REM-027`..`033` | 27 |
| **EPIC-06** | AI Security, Prompt Protection & Token Caps | **Level D** | `LOCAL_HARDENING` | `MH-REM-034`..`039` | 25 |
| **EPIC-07** | Infrastructure, Supply Chain & Build Hardening | **Level D** | `BLOCKER_LOCAL_PRODUCT` | `MH-REM-040`..`044` | 15 |
| **EPIC-08** | QA, Observability & E2E Test Infrastructure | **Level C / D** | `REQUIRED_FOR_LOCAL_RELIABILITY` | `MH-REM-045`..`050` | 23 |
| **Total** | **8 Architectural Epics** | | | **50 Items (`MH-REM-001`..`050`)** | **196** |
