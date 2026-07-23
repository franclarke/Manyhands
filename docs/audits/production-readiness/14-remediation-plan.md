# 14 — 30-Day Prioritized Remediation Plan

**Audit Date**: 2026-07-21  
**Target Repository**: ManyHands  
**Auditor**: Principal Engineering Review Board (Orchestrator Panel)  

---

## 1. Remediation Strategy & Sprint Structure

To achieve production readiness and resolve all 81 cataloged audit findings, engineering work is prioritized into a **4-sprint 30-day remediation roadmap**:

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ SPRINT 1 (Days 1-7): Host Safety & Storage Lock Integrity               │
 │ Focus: P0 Grounding Agent dirty workspace fix, lock ownership fencing   │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼────────────────────────────────────┐
 │ SPRINT 2 (Days 8-14): Orchestration, Scheduler & Persistence Hardening   │
 │ Focus: DAG cycle validator, ConflictConstraints, fsync atomic writes    │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼────────────────────────────────────┐
 │ SPRINT 3 (Days 15-21): API Auth, SSE Resource Teardown & UI Fixes      │
 │ Focus: Next.js API session middleware, SSE disconnect abort, UI tests   │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼────────────────────────────────────┐
 │ SPRINT 4 (Days 22-30): AI Guardrails, Test Suite & Performance Optim.   │
 │ Focus: Prompt XML escaping, token caps, true append event store, E2E QA │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Sprint Breakdown & Actionable Tasks

### Sprint 1 (Days 1–7): Host Safety & Storage Lock Integrity
- **Task 1.1 (`MH-AUDIT-GIT-010`)**: Update `GroundingAgent` (`packages/execution-core/src/run/grounding-agent.ts`) to call `git.statusPorcelain()` before writing files. Abort or create isolated worktree if workspace is dirty.
- **Task 1.2 (`MH-AUDIT-PERS-001`)**: Update `acquireDurableLock` (`packages/run-store/src/jsonl-event-store.ts`) release callback to verify PID and timestamp in `owner.json` before unlinking `lockPath`.
- **Task 1.3 (`MH-AUDIT-SEC-001`)**: Replace `env: process.env` with `buildAgentEnvironment()` in `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts` and register planning CLI processes with `LiveProcessRegistry`.
- **Task 1.4 (`MH-AUDIT-SEC-002`)**: Add `path.resolve` boundary verification against `worktreeRoot` in `packages/execution-core/src/scope/checker.ts`.
- **Task 1.5 (`MH-AUDIT-GIT-001`)**: Wrap `driveClaimedExecutionV2` (`apps/web/src/lib/server/runs/v2/execution-pipeline.ts`) in a `finally` block executing `worktrees.gcRun(runId)`.

### Sprint 2 (Days 8–14): Orchestration, Scheduler & Persistence Hardening
- **Task 2.1 (`MH-AUDIT-ORCH-001`)**: Add `ArtifactRequirement` consumer-producer edge cycle detection to `validateGraphRevision` in `packages/task-graph/src/validate-v2.ts`.
- **Task 2.2 (`MH-AUDIT-ORCH-002`)**: Wire `GraphRevision` `ConflictConstraint` records into `selectReadyWaveV2` wave selection in `packages/scheduler/src/wave-selector-v2.ts`.
- **Task 2.3 (`MH-AUDIT-PERS-002`)**: Add exponential backoff delay between transient rename retries and unlink `.tmp` on failure in `JsonlRunEventStore.atomicWrite`.
- **Task 2.4 (`MH-AUDIT-PERS-006`)**: Implement `update()` status transition method in `JsonlAttemptStore` (`packages/run-store/src/attempt-store.ts`).
- **Task 2.5 (`MH-AUDIT-GIT-005`)**: Add exponential retry loops for `.git/index.lock` contention in `SimpleGitRunner` (`packages/execution-core/src/git/runner.ts`).

### Sprint 3 (Days 15–21): API Security, SSE Stream Teardown & UI Fixes
- **Task 3.1 (`MH-AUDIT-API-006`)**: Implement session authentication and CSRF token validation middleware across all Next.js API routes in `apps/web/src/app/api/`.
- **Task 3.2 (`MH-AUDIT-API-001`)**: Wire `request.signal.addEventListener('abort', ...)` in `apps/web/src/app/api/runs/[runId]/events/route.ts` to stop event subscriber background timers.
- **Task 3.3 (`MH-AUDIT-QA-003`)**: Fix off-grid spacing classes in `cockpit-fixture-view.client.tsx:73` and `run-model-view.client.tsx:132` to resolve the 2 failing tests in `pnpm test`.
- **Task 3.4 (`MH-AUDIT-API-002`)**: Update `useLiveRunModel` (`apps/web/src/lib/client/use-live-run-model.ts`) to apply incoming SSE events incrementally.

### Sprint 4 (Days 22–30): AI Guardrails, Test Infrastructure & Performance Optimization
- **Task 4.1 (`MH-AUDIT-AI-001`)**: Enclose user file snippets in XML envelope tags (`<user_file_content>`) in `WorkBreakdownPlanner`.
- **Task 4.2 (`MH-AUDIT-AI-002`)**: Enforce `maxBudget` token spending limits in `LLMDecomposer` (`packages/decomposer/src/llm-decomposer.ts`).
- **Task 4.3 (`MH-AUDIT-QA-001`)**: Implement durable `JsonlTraceStore` in `packages/trace-store` to persist diagnostic events to disk.
- **Task 4.4 (`MH-AUDIT-GAP-008`)**: Refactor `JsonlRunEventStore.append()` to use true file append streams (`fs.appendFile`) instead of full file re-write loops.
- **Task 4.5 (`MH-AUDIT-INFRA-001`)**: Standardize all monorepo internal package dependencies to `"workspace:*"`.

---

## 3. Verification & Acceptance Criteria

Upon completion of the 30-day remediation sprint, the following acceptance checks must pass:
1. `pnpm test` passes 100% of test files (`0 failed`).
2. `pnpm -r --filter "./packages/*" typecheck` passes with zero errors.
3. `pnpm --filter @manyhands/web exec tsc --noEmit` passes with zero errors.
4. `pnpm build` and `pnpm web:build` build cleanly.
5. Production Readiness Re-audit Scorecard achieves `>= 90 / 100`.
