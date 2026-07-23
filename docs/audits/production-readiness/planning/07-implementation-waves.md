# 07 — Wave-by-Wave Implementation Plan (Wave 0 to Wave 8)

**Target Repository**: ManyHands  
**Scope**: Local Single-User Self-Hosted Application (127.0.0.1 / localhost)  
**Document Status**: Final Architectural Plan  
**Target Product Level**: Level D (Finished Local Product)  

---

## 1. Executive Summary & Wave Structure

This document defines the 9 sequential implementation waves (Wave 0 through Wave 8) required to execute the ManyHands production readiness master backlog (`MH-REM-001` to `MH-REM-050`).

Each wave represents a coherent, verifiable milestone that builds upon previous invariants. In accordance with the **Local Single-User Self-Hosted Scope Directive**:
- Multi-tenant cloud SaaS, enterprise OAuth, multi-user RBAC, and billing webhooks are explicitly marked `OUT_OF_SCOPE_SAAS` and excluded from exit criteria.
- Wave 8 / Level D exit criteria represents a complete, self-contained **Finished Local Product** running reliably on developer workstations (`localhost`).

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ WAVE 0: Audit Integrity Fixes & Test Suite Foundation (Level A)       │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 1: Core Contracts & Task Graph Typed Relations (Epic 1)          │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 2: Persistence Engine & Event Store WAL (Epic 3)                  │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 3: Worktree Sandbox & Security Boundary (Level B Exit)            │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 4: Execution Core & Fingerprint Materialization (Epic 4)         │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 5: API, SSE & Web UI State Sync (Level C Exit)                   │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 6: AI Security, Prompt Protection & Token Budgeting (Epic 6)      │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 7: Supply Chain, Containerization & Observability (Epic 7 & 8)    │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ WAVE 8: Finished Local Product Polish & Hardening (Level D Exit)       │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Wave Breakdown & Detailed Specifications

### Wave 0: Audit Integrity Fixes & Test Suite Foundation (Level A Baseline)

- **Objective**: Resolve immediate developer workspace contamination risks, lock takeover bugs, and broken test assertions to establish a green, stable local development baseline.
- **Included Backlog Items**:
  1. `MH-REM-001`: GroundingAgent Dirty Workspace Pre-check (`packages/execution-core/src/run/grounding-agent.ts`, `MH-AUDIT-GIT-010`)
  2. `MH-REM-002`: Durable Lock Ownership Verification (`packages/run-store/src/jsonl-event-store.ts`, `MH-AUDIT-PERS-001`)
  3. `MH-REM-003`: Refactor Fragile UI String Tests to DOM Rendering (`tests/run-loading-skeleton.test.ts`, `tests/typography-scale.test.ts`, `MH-AUDIT-QA-003`)
  4. `MH-REM-004`: Standardize Workspace Specifiers to `workspace:*` (`packages/*/package.json`, `MH-AUDIT-INFRA-001`)
  5. `MH-REM-005`: Validation Runner Child Process Leak Fix (`packages/execution-core/src/run/validation-runner.ts`, `MH-AUDIT-QA-002`)
- **Entry Criteria**:
  - Access to `Manyhands` repository root.
  - Baseline execution log recorded in `planning-command-results.md`.
- **Exit Criteria**:
  - GroundingAgent aborts if `git status --porcelain` contains uncommitted user changes.
  - Lock release checks PID and `acquiredAt` timestamp in `owner.json` before deleting lock directory.
  - `pnpm test` passes 100% of test files (0 failures).
- **Agent Skills Required**: `antigravity-guide`, code analysis, unit testing, git mechanics.
- **Verification Commands**:
  ```bash
  pnpm test
  pnpm --filter @manyhands/execution-core test
  ```

---

### Wave 1: Core Contracts & Task Graph Typed Relations (Epic 1)

- **Objective**: Implement canonical typed graph relations, cycle validation across artifact dependencies, and revision immutability in `packages/task-graph` and `packages/contracts`.
- **Included Backlog Items**:
  1. `MH-REM-006`: `ArtifactRequirement` Producer-Consumer Cycle Detection (`packages/task-graph/src/validate-v2.ts`, `MH-AUDIT-ORCH-001`)
  2. `MH-REM-007`: `SeamBinding` Schema Versioning & Type Safety (`packages/contracts/src/seam-binding.ts`, `MH-AUDIT-ORCH-003`)
  3. `MH-REM-008`: `ConflictConstraint` Wave Selection Filtering (`packages/scheduler/src/wave-selector-v2.ts`, `MH-AUDIT-ORCH-002`)
  4. `MH-REM-009`: Goal & Scope Revision Immutable Fingerprinting (`packages/contracts/src/revision.ts`, `MH-AUDIT-ORCH-004`)
  5. `MH-REM-010`: Validation Obligation Contract Execution Guard (`packages/contracts/src/validation-contract.ts`, `MH-AUDIT-ORCH-005`)
  6. `MH-REM-011`: Composite Node Subgraph Expansion Compiler (`packages/decomposer/src/compiler.ts`, `MH-AUDIT-ORCH-006`)
- **Entry Criteria**:
  - Wave 0 exit criteria satisfied.
- **Exit Criteria**:
  - `validateGraphRevision()` throws `CyclicArtifactDependencyError` when circular producer-consumer edges are present.
  - `selectReadyWaveV2()` filters candidate nodes against `ConflictRiskAnalyzer`.
  - `pnpm -r --filter "./packages/task-graph" typecheck` passes cleanly.
- **Agent Skills Required**: Typed graph theory, TypeScript type synthesis, contract validation.
- **Verification Commands**:
  ```bash
  pnpm --filter @manyhands/task-graph test
  pnpm --filter @manyhands/scheduler test
  ```

---

### Wave 2: Persistence Engine & Event Store WAL (Epic 3)

- **Objective**: Harden `packages/run-store` into a crash-resilient write-ahead event store with true append streams, atomic state updates, and log compaction.
- **Included Backlog Items**:
  1. `MH-REM-012`: `JsonlRunEventStore` Atomic Write Retry Backoff (`packages/run-store/src/jsonl-event-store.ts`, `MH-AUDIT-PERS-002`)
  2. `MH-REM-013`: True File Append Stream Event Logger (`packages/run-store/src/jsonl-event-store.ts`, `MH-AUDIT-GAP-008`)
  3. `MH-REM-014`: `JsonlAttemptStore` Immutable Status Transition Guard (`packages/run-store/src/attempt-store.ts`, `MH-AUDIT-PERS-006`)
  4. `MH-REM-015`: Event Log Compaction & Snapshot Truncation Engine (`packages/run-store/src/compaction.ts`, `MH-AUDIT-GAP-001`)
  5. `MH-REM-016`: Local Event Replay Crash Recovery Engine (`packages/run-store/src/recovery.ts`, `MH-AUDIT-PERS-004`)
  6. `MH-REM-017`: Local Storage Free Space Safety Monitor (`packages/run-store/src/storage-monitor.ts`, `MH-AUDIT-PERS-005`)
- **Entry Criteria**:
  - Wave 1 contracts complete.
- **Exit Criteria**:
  - Event store appends lines via `fs.createWriteStream` without re-writing entire history files.
  - Unannounced process termination during event write resumes state perfectly from last `RunSnapshot`.
- **Agent Skills Required**: File system I/O, event SOURCING, crash recovery testing.
- **Verification Commands**:
  ```bash
  pnpm --filter @manyhands/run-store test
  ```

---

### Wave 3: Worktree Sandbox & Security Boundary (Level B Exit)

- **Objective**: Establish strict host security, process environment isolation, and git worktree lifecycle management to achieve **Level B Readiness (Secure Local Use)**.
- **Included Backlog Items**:
  1. `MH-REM-018`: Supervised Process Environment Sanitization (`apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`, `MH-AUDIT-SEC-001`)
  2. `MH-REM-019`: Scope Checker Path Traversal Resolution (`packages/execution-core/src/scope/checker.ts`, `MH-AUDIT-SEC-002`)
  3. `MH-REM-020`: Worktree Garbage Collection Lifecycle Wire-in (`apps/web/src/lib/server/runs/v2/execution-pipeline.ts`, `MH-AUDIT-GIT-001`)
  4. `MH-REM-021`: Git Index Lock Contention Retry Loop (`packages/execution-core/src/git/runner.ts`, `MH-AUDIT-GIT-005`)
  5. `MH-REM-022`: Local Command Injection Shield & Argv Escaping (`packages/execution-core/src/cli/exec.ts`, `MH-AUDIT-SEC-003`)
  6. `MH-REM-023`: Symlink & Git Hook Execution Guard (`packages/execution-core/src/scope/hooks-guard.ts`, `MH-AUDIT-SEC-004`)
  7. `MH-REM-024`: Local Process Resource Limits & Timeout Supervisor (`packages/execution-core/src/run/supervisor.ts`, `MH-AUDIT-SEC-005`)
- **Entry Criteria**:
  - Wave 2 persistence layer complete.
- **Exit Criteria**:
  - Spawned agent processes receive filtered environment via `buildAgentEnvironment()`.
  - Path traversal attempts (`../../etc/passwd`) blocked by `ScopeChecker`.
  - Worktrees cleaned automatically in `finally` block of execution pipeline.
  - **Level B Release Gate Passed**.
- **Agent Skills Required**: Process security, OS boundary enforcement, Git internal APIs.
- **Verification Commands**:
  ```bash
  pnpm --filter @manyhands/execution-core test
  ```

---

### Wave 4: Execution Core & Fingerprint Materialization (Epic 4)

- **Objective**: Materialize isolated execution bases based on deterministic `InputFingerprint` hashing and build the candidate commit verification pipeline in `packages/execution-core`.
- **Included Backlog Items**:
  1. `MH-REM-025`: `InputFingerprint` Deterministic Hash Engine (`packages/execution-core/src/fingerprint.ts`, `MH-AUDIT-EXEC-001`)
  2. `MH-REM-026`: Execution Base Isolated Directory Materializer (`packages/execution-core/src/materializer.ts`, `MH-AUDIT-EXEC-002`)
  3. `MH-REM-027`: Candidate Commit Verification Pipeline (`packages/execution-core/src/candidate-commit.ts`, `MH-AUDIT-EXEC-003`)
  4. `MH-REM-028`: Grounding Agent Incremental Re-grounding (`packages/execution-core/src/run/grounding-agent.ts`, `MH-AUDIT-EXEC-004`)
  5. `MH-REM-029`: Failure Recovery Classifier & Policy Engine (`packages/execution-core/src/failure-policy.ts`, `MH-AUDIT-EXEC-005`)
  6. `MH-REM-030`: Local Validation Evidence Matrix Builder (`packages/execution-core/src/evidence-matrix.ts`, `MH-AUDIT-EXEC-006`)
- **Entry Criteria**:
  - Wave 3 worktree sandbox verified.
- **Exit Criteria**:
  - Attempts produce immutable execution bases matching exact `InputFingerprint` hashes.
  - Orchestrator creates candidate commits on isolated branches without polluting main branch.
  - Evidence matrix asserts exact git commit SHAs for verified results.
- **Agent Skills Required**: Cryptographic fingerprinting, Git branch mechanics, test evidence generation.
- **Verification Commands**:
  ```bash
  pnpm --filter @manyhands/execution-core test
  ```

---

### Wave 5: API, SSE & Web UI State Sync (Level C Exit)

- **Objective**: Bind Next.js Web API routes to `127.0.0.1`, wire SSE abort signal handlers, and synchronize SvelteKit/React UI components to achieve **Level C Readiness (Reliable Local Beta)**.
- **Included Backlog Items**:
  1. `MH-REM-031`: Next.js Localhost Hostname Binding & CSRF Middleware (`apps/web/src/app/api/runs/route.ts`, `MH-AUDIT-API-006`)
  2. `MH-REM-032`: SSE Event Stream Abort Listener Wiring (`apps/web/src/app/api/runs/[runId]/events/route.ts`, `MH-AUDIT-API-001`)
  3. `MH-REM-033`: Frontend Incremental SSE Event Model Sync (`apps/web/src/lib/client/use-live-run-model.ts`, `MH-AUDIT-API-002`)
  4. `MH-REM-034`: React Flow Viewport Fixed Position Lock (`apps/web/src/app/runs/[runId]/_components/task-graph-canvas.tsx`, `MH-AUDIT-UI-001`)
  5. `MH-REM-035`: Non-Blocking Decision Queue Card & Modal (`apps/web/src/app/runs/[runId]/_components/decision-queue.tsx`, `MH-AUDIT-UI-002`)
  6. `MH-REM-036`: State Indicator Badge Contract Compliance (`apps/web/src/app/runs/[runId]/_components/status-badge.tsx`, `MH-AUDIT-UI-003`)
  7. `MH-REM-037`: Local Action Confirmation & Execution Guard (`apps/web/src/lib/server/runs/v2/action-guard.ts`, `MH-AUDIT-API-004`)
- **Entry Criteria**:
  - Wave 4 execution core complete.
- **Exit Criteria**:
  - Server SSE loop aborts background polling within 100ms of browser stream disconnect.
  - Canvas viewport position does not shift or jump during live graph stream updates.
  - Decision queue permits unblocked execution of independent parallel branches.
  - **Level C Release Gate Passed**.
- **Agent Skills Required**: Next.js API routes, Server-Sent Events, React Flow canvas, UI state management.
- **Verification Commands**:
  ```bash
  pnpm --filter @manyhands/web exec tsc --noEmit
  pnpm --filter @manyhands/web test
  ```

---

### Wave 6: AI Security, Prompt Protection & Token Budgeting (Epic 6)

- **Objective**: Protect local execution against indirect prompt injection from untrusted cloned repository files and enforce strict token spending caps.
- **Included Backlog Items**:
  1. `MH-REM-038`: XML Envelope Tag Escaping for User Snippets (`packages/decomposer/src/planner/work-breakdown.ts`, `MH-AUDIT-AI-001`)
  2. `MH-REM-039`: LLM Cumulative Token Budget Enforcer (`packages/decomposer/src/llm-decomposer.ts`, `MH-AUDIT-AI-002`)
  3. `MH-REM-040`: System Prompt Decoy Rule Boundary (`packages/decomposer/src/prompts/system.ts`, `MH-AUDIT-AI-003`)
  4. `MH-REM-041`: Decomposer Structural Output Schema Guard (`packages/decomposer/src/schema-guard.ts`, `MH-AUDIT-AI-004`)
  5. `MH-REM-042`: Local API Key Secure Configuration Storage (`apps/web/src/lib/server/config/keys.ts`, `MH-AUDIT-AI-005`)
  6. `MH-REM-043`: Untrusted LLM Command Execution Approval Flow (`apps/web/src/lib/server/runs/v2/command-approver.ts`, `MH-AUDIT-AI-006`)
- **Entry Criteria**:
  - Wave 5 API & Web UI sync complete.
- **Exit Criteria**:
  - User file snippets containing adversarial prompt overrides are sanitized inside `<user_file_content>` XML tags.
  - LLM calls exceeding `maxBudget` fail fast with `TokenBudgetExceededError`.
  - System prompt decoy rule successfully deflects prompt extraction requests.
- **Agent Skills Required**: LLM prompt security, schema validation, token estimation.
- **Verification Commands**:
  ```bash
  pnpm --filter @manyhands/decomposer test
  ```

---

### Wave 7: Supply Chain, Containerization & Observability (Epic 7 & 8)

- **Objective**: Persist diagnostic traces to disk durably via `JsonlTraceStore`, enforce workspace package dependencies, and establish local log rotation.
- **Included Backlog Items**:
  1. `MH-REM-044`: Durable `JsonlTraceStore` File Persistence Engine (`packages/trace-store/src/jsonl-trace-store.ts`, `MH-AUDIT-QA-001`)
  2. `MH-REM-045`: Monorepo Strict `workspace:*` Dependency Lock (`package.json`, `MH-AUDIT-INFRA-002`)
  3. `MH-REM-046`: Optional Local Docker Isolation Adapter (`packages/execution-core/src/sandbox/docker-adapter.ts`, `MH-AUDIT-INFRA-003`)
  4. `MH-REM-047`: Local Diagnostic Telemetry & Log Rotation Engine (`packages/trace-store/src/log-rotation.ts`, `MH-AUDIT-QA-004`)
- **Entry Criteria**:
  - Wave 6 AI security complete.
- **Exit Criteria**:
  - `packages/trace-store` writes events to disk and survives process restarts.
  - All workspace package manifests strictly use `"workspace:*"`.
- **Agent Skills Required**: Monorepo management, file logging, trace telemetry.
- **Verification Commands**:
  ```bash
  pnpm --filter @manyhands/trace-store test
  ```

---

### Wave 8: Finished Local Product Polish & Hardening (Level D Exit)

- **Objective**: Achieve **Level D Readiness (Finished Local Product)** by polishing single-command local setup, enforcing WCAG 2.2 AA accessibility, and executing full end-to-end integration tests.
- **Included Backlog Items**:
  1. `MH-REM-048`: Single-Command Local Developer Setup & Self-Test CLI (`packages/cli/src/setup.ts`, `MH-AUDIT-PROD-001`)
  2. `MH-REM-049`: WCAG 2.2 AA Keyboard Navigation & Contrast Audit (`apps/web/src/app/runs/[runId]/page.tsx`, `MH-AUDIT-UI-004`)
  3. `MH-REM-050`: End-to-End Local Execution Integration Suite (`tests/e2e-local-run.test.ts`, `MH-AUDIT-QA-005`)
- **Entry Criteria**:
  - Waves 0 through 7 successfully completed and verified.
- **Exit Criteria**:
  - A developer can clone the repo, run `pnpm setup:local`, and execute a goal run without manual configuration.
  - `pnpm test` passes 100% of test files.
  - `pnpm -r --filter "./packages/*" typecheck` passes cleanly (0 errors).
  - `pnpm --filter @manyhands/web exec tsc --noEmit` passes cleanly (0 errors).
  - **Level D Release Gate Passed**.
- **Agent Skills Required**: CLI UX design, WCAG accessibility testing, end-to-end integration QA.
- **Verification Commands**:
  ```bash
  pnpm test
  pnpm -r --filter "./packages/*" typecheck
  pnpm --filter @manyhands/web exec tsc --noEmit
  pnpm build
  pnpm web:build
  ```
