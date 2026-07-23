# ManyHands QA, Testing Infrastructure & Observability Audit Report

**Auditor**: `teamwork_preview_explorer` (Testing, Observability & QA Specialist)  
**Date**: 2026-07-21  
**Target Repository**: `ManyHands` monorepo  
**Report Location**: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_qa\report.md`

---

## 1. Executive Summary

An exhaustive audit of the testing infrastructure, unit/integration/E2E test suites, trace logging, error handling, and diagnostic observability was performed across the ManyHands codebase.

### Key Metrics
- **Total Test Files Evaluated**: 166 test modules (130 test files in `tests/`, 36 execution variants)
- **Test Suite Results**: 3 Failed, 163 Passed (957 tests passing, 3 failing, 1 skipped)
- **Suite Execution Duration**: ~137.3 seconds (heavy integration & real Git execution overhead)
- **Monorepo Package Test Scripts**: 0 out of 12 packages in `packages/*` or `apps/web` possess a `"test"` script in `package.json`.
- **Frontend / UI Component Test Coverage**: **0%** real DOM / React component tests (UI testing relies on `readFileSync` string pattern matching on JSX files).
- **Diagnostic Trace Persistence**: **0%** persistent trace storage (`InMemoryTraceStore` is the sole implementation; all diagnostic traces evaporate on process exit).

---

## 2. Audit Findings & Gap Inventory

| Defect ID | Severity | Category | Target Location | Short Summary |
|---|---|---|---|---|
| `MH-AUDIT-QA-001` | **HIGH** | Observability | `packages/trace-store/src/index.ts:101` | Ephemeral `InMemoryTraceStore` causes all diagnostic trace events to evaporate on process exit |
| `MH-AUDIT-QA-002` | **HIGH** | Testing Coverage | `apps/web/package.json:1` | Zero DOM/Component unit tests or E2E browser tests for `apps/web` UI components & actions |
| `MH-AUDIT-QA-003` | **HIGH** | Test Reliability | `tests/run-loading-skeleton.test.ts:25` | Fragile UI tests inspect JSX source strings with `readFileSync`, causing false failures on code formatting |
| `MH-AUDIT-QA-004` | **HIGH** | Infrastructure | `vitest.config.ts:28` & package.json | Packages lack package-level `"test"` scripts, and `vitest.config.ts` has obsolete glob patterns |
| `MH-AUDIT-QA-005` | **MEDIUM** | Test Flakiness | `vitest.config.ts:33` | Windows file-lock lockouts in Git tests cause suite failures and rely on global `retry: 1` workaround |
| `MH-AUDIT-QA-006` | **MEDIUM** | Testing Quality | `tests/decomposer-claude-code-recursive.test.ts:1` | Excessive mock reliance for Claude Code / Codex CLI executions with 0 live process eval integration tests |
| `MH-AUDIT-QA-007` | **MEDIUM** | Error Visibility | `apps/web/src/app/api/runs/[id]/run-events/route.ts:45` | SSE event streaming routes suppress stream errors silently without diagnostic event telemetry |
| `MH-AUDIT-QA-008` | **MEDIUM** | Logging | `packages/execution-core/src/logging/` | Inconsistent logger usage (`console.log` / `console.error`) lacking contextual run correlation IDs |
| `MH-AUDIT-QA-009` | **LOW** | Contract Verification | `apps/web/src/app/api/runs/[id]/cancel/route.ts` | API route error responses are not tested against standard Zod `ErrorResponse` schemas |

---

## 3. Detailed Audit Findings

### `MH-AUDIT-QA-001` — Ephemeral Diagnostic Trace Logging (`InMemoryTraceStore` Only)
- **Severity**: HIGH
- **Location**: `packages/trace-store/src/index.ts:101-142` & `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:112`
- **Observation**:
  `InMemoryTraceStore` is the only class implementing `TraceStore` in `packages/trace-store`. In `execution-pipeline.ts:112`, the run execution pipeline initializes:
  ```ts
  const traceStore = new InMemoryTraceStore();
  ```
- **Logic Chain**:
  1. Diagnostic trace events (`TraceEvent`) record critical execution telemetry, including executor stdout/stderr chunks, repair syntax rejections, scope check failures, and agent lifecycle transitions.
  2. Because `InMemoryTraceStore` stores events strictly in an in-memory array (`private readonly events: TraceEvent[] = []`), all diagnostic data evaporates as soon as the Node.js process terminates or restarts.
  3. Unlike canonical run events which write to `.events.v2.jsonl`, no persistent `JsonlTraceStore` or `FileTraceStore` exists in the repository.
- **Impact**: Post-execution post-mortems, diagnostic analysis of failed agent runs, and historical auditing cannot be performed once a process completes or restarts.

---

### `MH-AUDIT-QA-002` — Zero UI / Component Unit & E2E Test Coverage for `apps/web`
- **Severity**: HIGH
- **Location**: `apps/web/package.json:1-63` & `apps/web/src/`
- **Observation**:
  `apps/web/package.json` contains no `"test"` script and lacks standard web testing dependencies (`@testing-library/react`, `@testing-library/user-event`, `jsdom`, `happy-dom`, `playwright`). There are **0 test files** anywhere in `apps/web/src/`.
- **Logic Chain**:
  1. Frontend components (`WorkspacePicker`, `EffortControl`, `ModelPicker`, `RunModelView`, `MinimalRunGraph`), server actions, custom client hooks (`useLiveRunModel`, `useFixturePlayback`), and interactive forms are never rendered or tested in a DOM environment.
  2. Web layer functionality relies entirely on indirect backend unit tests or source code text matching.
- **Impact**: UI regressions, interactive state bugs, React hydration mismatches, component rendering errors, and accessibility failures pass completely undetected by automated QA.

---

### `MH-AUDIT-QA-003` — Fragile UI Testing via Source Code String Inspection (False Failures)
- **Severity**: HIGH
- **Location**: `tests/run-loading-skeleton.test.ts:25`, `tests/typography-scale.test.ts:79`, `tests/run-cockpit-chrome.test.ts:11-37`
- **Observation**:
  UI tests load component source files from disk with `readFileSync` and assert regex/string containment:
  ```ts
  // tests/run-loading-skeleton.test.ts
  const runViewSource = readFileSync(..., "utf8");
  expect(runViewSource).toContain('px-6 py-4');
  ```
  Executing `pnpm test` produced **2 immediate test failures** due to this pattern:
  1. `tests/run-loading-skeleton.test.ts` failed because line formatting changed in the source component.
  2. `tests/typography-scale.test.ts` failed because off-grid Tailwind spacing (`p-2.5` / `m-5.5`) was added to `cockpit-fixture-view.client.tsx:73` and `run-model-view.client.tsx:132`.
- **Logic Chain**:
  1. Inspecting raw source text does not test component DOM structure, CSS behavior, or user interaction.
  2. Standard code formatting or harmless refactoring triggers false-positive test failures.
  3. Broken component logic that retains matching text passes tests (false negative).
- **Impact**: High test maintenance overhead, false alarms in CI/CD, and ineffective UI quality verification.

---

### `MH-AUDIT-QA-004` — Missing Package-Level Test Scripts & Obsolete Vitest Glob Inclusion
- **Severity**: HIGH
- **Location**: `package.json` (all `packages/*/package.json`), `vitest.config.ts:28`
- **Observation**:
  1. None of the 12 packages in `packages/*` (`packages/execution-core`, `packages/decomposer`, `packages/task-graph`, etc.) define a `"test"` script in `package.json`. Running `pnpm --filter @manyhands/execution-core test` fails.
  2. `vitest.config.ts:28` includes the glob `"packages/orchestrator-graph/src/**/*.test.ts"`. However, `packages/orchestrator-graph/src` contains **0 test files** (all tests reside in `tests/`).
- **Logic Chain**:
  1. Monorepo architecture requires individual package test targets.
  2. Monorepo developers must run the entire 130-file test suite rather than executing targeted package tests.
- **Impact**: Developer workflow friction, inability to run modular CI test jobs, and stale configuration clutter.

---

### `MH-AUDIT-QA-005` — Windows File Locking Contention & Global Retry Workaround
- **Severity**: MEDIUM
- **Location**: `vitest.config.ts:29-33`, `tests/workspace-file-lock-commit.test.ts:267`
- **Observation**:
  1. `vitest.config.ts:33` sets `retry: 1` globally to absorb transient file locks on Windows.
  2. During full suite execution, `tests/workspace-file-lock-commit.test.ts:267` failed on Windows with:
     `WorkspaceConflictError: Timed out waiting for the workspace store lock at ...\workspaces.json.lock` and `Error: ENOTEMPTY: directory not empty, rmdir ...`.
- **Logic Chain**:
  1. Parallel Vitest workers contend for temporary directories and Git lock files on Windows.
  2. Global `retry: 1` masks underlying filesystem race conditions, retries deterministic code failures, and increases test suite duration to over 2 minutes (~137 seconds).
- **Impact**: Intermittent CI test flakiness on Windows platforms and masked file handle leak defects.

---

### `MH-AUDIT-QA-006` — Heavy Mocking of Agent CLI Executions without Real Eval Checks
- **Severity**: MEDIUM
- **Location**: `tests/decomposer-claude-code-recursive.test.ts:1-120`, `tests/decomposer-codex-recursive.test.ts:1-110`, `tests/execution-core-mock-agent.test.ts:1-90`
- **Observation**:
  Decomposer and execution core test suites rely almost exclusively on mocked stdout strings and fake child processes (`MockCodex`, fake process spawners).
- **Logic Chain**:
  1. No integration test suite runs against real or recorded CLI process outputs from actual Claude Code or Codex binaries in isolated test sandboxes.
  2. Output format shifts, flag deprecations, or exit code changes in external CLI binaries will not be detected until production execution failures occur.
- **Impact**: Blind spots in AI agent integration safety.

---

### `MH-AUDIT-QA-007` — Silent Error Handling in SSE / Streaming API Routes
- **Severity**: MEDIUM
- **Location**: `apps/web/src/app/api/runs/[id]/run-events/route.ts:45-90` & `apps/web/src/app/api/runs/[id]/terminals/[terminalId]/stream/route.ts:30-70`
- **Observation**:
  SSE streaming route handlers wrap internal loop errors in generic try/catch blocks that invoke `console.error` or close silently without emitting structured diagnostic events.
- **Logic Chain**:
  1. Connection drops or stream formatting errors do not write `TraceEvent` records to `TraceStore` nor emit domain error frames to the client stream before closing.
  2. Client applications receive abrupt disconnections without diagnostic error payloads explaining the root cause.
- **Impact**: Impaired operational observability for real-time run telemetry feeds.

---

### `MH-AUDIT-QA-008` — Unstandardized Logger Abstraction Across Subsystems
- **Severity**: MEDIUM
- **Location**: `packages/execution-core/src/logging/` & `apps/web/src/lib/server/`
- **Observation**:
  Log statements across `packages/execution-core`, `packages/run-coordinator`, and `apps/web` invoke `console.log` or `console.error` directly without structured context fields (such as `runId`, `taskId`, `attemptId`).
- **Logic Chain**:
  1. Without a centralized logger package/interface, logs cannot be filtered by log level or correlated back to specific run execution attempts in multi-tenant / concurrent environments.
- **Impact**: Disorganized logging and reduced diagnostic efficiency.

---

### `MH-AUDIT-QA-009` — Unverified API Endpoint Error Response Contracts
- **Severity**: LOW
- **Location**: `apps/web/src/app/api/runs/[id]/cancel/route.ts`, `apps/web/src/app/api/workspaces/[id]/route.ts`
- **Observation**:
  API route handlers lack automated integration tests verifying that 400 Bad Request, 404 Not Found, or 500 Internal Server Error responses adhere to standard Zod `ErrorResponse` schemas.
- **Logic Chain**:
  1. Unexpected exceptions in Next.js route handlers default to HTML error fallback pages instead of structured JSON error payloads.
- **Impact**: Potential JSON parsing errors in clients consuming ManyHands REST endpoints.

---

## 4. Remediation Plan & Recommendations

1. **Build `JsonlTraceStore` in `packages/trace-store`**:
   Implement a durable `JsonlTraceStore` appending `TraceEvent` objects to `.traces.v2.jsonl` files in run directories, eliminating `MH-AUDIT-QA-001`.
2. **Setup Frontend Testing in `apps/web`**:
   Install Vitest / `@testing-library/react` / `jsdom` in `apps/web`. Replace fragile source file `readFileSync` string checks (`MH-AUDIT-QA-003`) with real component render tests (`MH-AUDIT-QA-002`).
3. **Configure Monorepo Package Test Targets**:
   Add `"test": "vitest run"` scripts to all `packages/*/package.json` and remove obsolete glob patterns in `vitest.config.ts` (`MH-AUDIT-QA-004`).
4. **Fix Concurrency & Windows Lock Teardowns**:
   Refactor `workspace-file-lock-commit.test.ts` to use isolated unique temporary directory paths per test case and eliminate global `retry: 1` workaround (`MH-AUDIT-QA-005`).
5. **Introduce `@manyhands/logger` & SSE Error Events**:
   Create a light, structured logger package with contextual fields (`runId`, `nodeId`) and update SSE streaming route handlers to emit diagnostic events on error (`MH-AUDIT-QA-007`, `MH-AUDIT-QA-008`).

---
