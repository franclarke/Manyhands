# 10 — Binary Release Gates & Product Readiness Thresholds

**Target Repository**: ManyHands  
**Scope**: Local Single-User Self-Hosted Application (127.0.0.1 / localhost)  
**Document Status**: Final Architectural Plan  
**Target Product Level**: Level D (Finished Local Product)  

---

## 1. Release Gate Framework

This document defines the 4 formal **Binary Release Gates** (Gate A through Gate D) mapped directly to the Product Readiness Levels of ManyHands.

In strict alignment with the **Local Single-User Self-Hosted Scope Directive**:
- Release gates measure readiness for a single-user self-hosted developer tool running on `localhost`.
- Multi-tenant cloud SaaS features, OAuth/SSO servers, billing webhooks, and K8s operators are classified as `OUT_OF_SCOPE_SAAS` and do NOT block release gates.
- A gate is evaluated as a strict binary **PASS** or **FAIL**. All mandatory criteria must be satisfied 100% without exceptions or waivers.

---

## 2. Gate Matrix Overview

| Release Gate | Product Target Level | Key Focus Area | Mandatory Exit Prerequisites |
|---|---|---|---|
| **Gate A** | Level A: Local Baseline | Dirty Workspace & Lock Safety | `MH-REM-001` through `MH-REM-005` |
| **Gate B** | Level B: Secure Local Use | Worktree Sandbox & Host Boundary | `MH-REM-006` through `MH-REM-024` |
| **Gate C** | Level C: Reliable Local Beta | Event Store WAL, Recovery & SSE Sync | `MH-REM-025` through `MH-REM-037` |
| **Gate D** | Level D: Finished Local Product | Single-Install UX, Prompt Escaping & QA | `MH-REM-038` through `MH-REM-050` |

---

## 3. Detailed Binary Release Gate Specifications

### Gate A: Local Baseline (Level A Exit Criteria)

- **Purpose**: Ensure basic developer workspace safety so running ManyHands locally never corrupts uncommitted work or deletes active locks.
- **Scope**: Wave 0 implementation items (`MH-REM-001` to `MH-REM-005`).
- **Mandatory Pass/Fail Metrics**:
  1. `GroundingAgent` aborts execution if target local repository has uncommitted user files (`git status --porcelain != ""`).
  2. Durable lock release inspects `owner.json` PID and `acquiredAt` timestamp; active foreign locks are never deleted.
  3. `pnpm test` passes with zero failing test files (`0 failed`).
  4. Monorepo internal dependencies standardized to `"workspace:*"`.
- **Verification Command**:
  ```bash
  pnpm test
  ```
- **Gate Decision**: **PASS / FAIL**

---

### Gate B: Secure Local Use (Level B Exit Criteria)

- **Purpose**: Validate host process isolation, scope path traversal protection, command execution wrapping, and automatic worktree garbage collection.
- **Scope**: Wave 1 through Wave 3 implementation items (`MH-REM-006` to `MH-REM-024`).
- **Mandatory Pass/Fail Metrics**:
  1. `validateGraphRevision()` detects and rejects circular `ArtifactRequirement` producer-consumer dependencies.
  2. `ConflictConstraint` rules actively prevent conflicting task nodes from executing concurrently in wave selection.
  3. Spawning CLI/agent processes uses `buildAgentEnvironment()` to strip sensitive host environment variables.
  4. `ScopeChecker` blocks path traversal attempts containing `../` sequences outside `worktreeRoot`.
  5. Execution pipeline guarantees worktree cleanup in `finally` blocks, leaving zero orphan worktrees on error.
  6. Git lock contention handles transient `.git/index.lock` collisions via exponential backoff retries.
- **Verification Command**:
  ```bash
  pnpm --filter @manyhands/task-graph test
  pnpm --filter @manyhands/execution-core test
  ```
- **Gate Decision**: **PASS / FAIL**

---

### Gate C: Reliable Local Beta (Level C Exit Criteria)

- **Purpose**: Ensure long-running multi-hour agent executions survive process crashes, append events durably without data loss, and maintain real-time web UI synchronization.
- **Scope**: Wave 4 and Wave 5 implementation items (`MH-REM-025` to `MH-REM-037`).
- **Mandatory Pass/Fail Metrics**:
  1. `JsonlRunEventStore` appends events via stream (`fs.createWriteStream`) without full log rewrite loops.
  2. Abrupt process termination (`SIGKILL`) recovers run execution state accurately upon restart using `RunSnapshot`.
  3. Next.js API endpoints bind strictly to `127.0.0.1` / `::1` and enforce CSRF origin headers.
  4. Client browser disconnect on SSE stream triggers request signal abort, stopping server background polling timers within 100ms.
  5. React Flow canvas viewport remains locked and motionless during live event stream pushes.
  6. Candidate commits are verified in isolated worktrees before updating run state.
- **Verification Command**:
  ```bash
  pnpm --filter @manyhands/run-store test
  pnpm --filter @manyhands/web exec tsc --noEmit
  pnpm --filter @manyhands/web test
  ```
- **Gate Decision**: **PASS / FAIL**

---

### Gate D: Finished Local Product (Level D Exit Criteria - Final Milestone)

- **Purpose**: Certify ManyHands as a finished, self-contained local developer application ready for single-command installation and execution.
- **Scope**: Wave 6 through Wave 8 implementation items (`MH-REM-038` to `MH-REM-050`).
- **Mandatory Pass/Fail Metrics**:
  1. User repository file snippets interpolated into LLM prompts are sanitized inside `<user_file_content>` XML envelope tags.
  2. LLM token spending caps enforce `maxBudget` limits and halt execution on budget exhaustion.
  3. System prompt decoy rules withstand adversarial prompt extraction payloads.
  4. Diagnostic traces persist durably to disk via `JsonlTraceStore` with active log rotation.
  5. A developer can run `pnpm setup:local` on a fresh clone and execute a complete goal run without error.
  6. Web UI complies with WCAG 2.2 AA accessibility standard (full keyboard navigation, focus indicators).
  7. `pnpm test` passes 100% of tests.
  8. `pnpm -r --filter "./packages/*" typecheck` passes with 0 errors.
  9. `pnpm --filter @manyhands/web exec tsc --noEmit` passes with 0 errors.
  10. `pnpm build` and `pnpm web:build` execute cleanly.
- **Verification Command**:
  ```bash
  pnpm test
  pnpm -r --filter "./packages/*" typecheck
  pnpm --filter @manyhands/web exec tsc --noEmit
  pnpm build
  pnpm web:build
  ```
- **Gate Decision**: **PASS / FAIL**

---

## 4. Exclusion of SaaS & Multi-Tenant Criteria

In accordance with the scope directive:
- **Tenant Isolation Checks**: `OUT_OF_SCOPE_SAAS` (Not evaluated).
- **Enterprise OAuth / SSO Provider Integration**: `OUT_OF_SCOPE_SAAS` (Not evaluated).
- **Billing Webhook Signature Verification**: `OUT_OF_SCOPE_SAAS` (Not evaluated).
- **Kubernetes Pod Security Policies**: `OUT_OF_SCOPE_SAAS` (Not evaluated).
