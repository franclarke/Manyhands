# 09 — Comprehensive Multi-Tier Test & QA Strategy

**Target Repository**: ManyHands  
**Scope**: Local Single-User Self-Hosted Application (127.0.0.1 / localhost)  
**Document Status**: Final Architectural Plan  
**Target Product Level**: Level D (Finished Local Product)  

---

## 1. Test Strategy Overview

This document establishes the multi-tier testing framework, verification methodology, and regression test catalog required to validate all 50 remediation backlog items (`MH-REM-001` through `MH-REM-050`) and eliminate the 81 audit findings (`MH-AUDIT-XXX`).

The strategy focuses on **Behavioral Testing**: testing observable system guarantees, boundary safety, persistence durability, and local execution invariants rather than internal implementation details.

---

## 2. Multi-Tier Testing Hierarchy

```
                   ┌──────────────────────────────────────┐
                   │ Tier 4: Adversarial & Security Tests │
                   │  (Prompt Injection, Traversal, Locks) │
                   └──────────────────┬───────────────────┘
                                      │
                   ┌──────────────────▼───────────────────┐
                   │ Tier 3: Local E2E Integration Tests  │
                   │  (Full Goal Run Lifecycle on Local)  │
                   └──────────────────┬───────────────────┘
                                      │
                   ┌──────────────────▼───────────────────┐
                   │ Tier 2: Integration & Contract Tests │
                   │  (DAG Invariants, WAL Replay, SSE)   │
                   └──────────────────┬───────────────────┘
                                      │
                   ┌──────────────────▼───────────────────┐
                   │ Tier 1: Unit & Component Tests       │
                   │  (Pure Functions, DOM Layout, Utils) │
                   └──────────────────────────────────────┘
```

### Tier 1: Unit & Component Tests
- **Focus**: Fast, deterministic validation of pure domain logic, schema parsers, path utilities, and React/Svelte component rendering.
- **Location**: `packages/*/src/**/*.test.ts` and `apps/web/src/**/*.test.ts`.
- **Key Invariant**: Zero file system or network side effects. Executes in `< 5 seconds`.

### Tier 2: Integration & Contract Tests
- **Focus**: Multi-component interaction, DAG cycle detection, `InputFingerprint` hashing, durable event store WAL replay, and SSE abort stream wiring.
- **Location**: `tests/*.test.ts` and package-level integration suites.
- **Key Invariant**: Real local file operations in isolated temp directories; verified cleanup on completion.

### Tier 3: Local E2E Integration Tests
- **Focus**: Complete goal breakdown, wave scheduling, candidate commit creation, validation execution, and evidence matrix publication running on `127.0.0.1`.
- **Location**: `tests/e2e-local-run.test.ts`.
- **Key Invariant**: Tests the entire user workflow from goal submission to final commit delivery without external SaaS mock dependencies.

### Tier 4: Adversarial & Security Tests
- **Focus**: Host isolation protection, process environment secret leakage, malicious prompt injection, symlink traversal, and git lock contention.
- **Location**: Dedicated security test suites in `tests/security-*.test.ts`.
- **Key Invariant**: Probes host safety under hostile inputs, dirty workspaces, and unverified LLM output commands.

---

## 3. Verification Methodology per Architectural Epic

| Epic | Target Subsystem | Primary Verification Methodology | Target Packages & Test Locations |
|---|---|---|---|
| **Epic 1** | Task Graph & Contracts | Build circular `ArtifactRequirement` and `SeamBinding` graphs; assert `CyclicArtifactDependencyError` and schema guards. | `packages/task-graph`, `packages/contracts` |
| **Epic 2** | Worktree & Security Sandbox | Spawn mock processes with custom `process.env`, attempt path traversal via `../../`, inject untrusted git hooks. Assert env sanitization, path blocking, and hook execution abort. | `packages/execution-core`, `apps/web` |
| **Epic 3** | Persistence & WAL Engine | Append 10,000 events, trigger abrupt process crash, verify state restoration from `RunSnapshot` and true append stream formatting. | `packages/run-store` |
| **Epic 4** | Execution Core & Fingerprints | Generate deterministic `InputFingerprint` hashes, materialize isolated execution bases, verify candidate commits on isolated branches. | `packages/execution-core` |
| **Epic 5** | API, SSE & Web UI Sync | Connect SSE client, emit events, simulate browser abort signal. Verify background timers terminate within 100ms and canvas viewport lock holds. | `apps/web`, `tests/api-*.test.ts` |
| **Epic 6** | AI Security & Token Budget | Pass adversarial prompt injection payloads inside user file snippets; set `maxBudget` token limits; assert XML escaping and `TokenBudgetExceededError`. | `packages/decomposer` |
| **Epic 7** | Supply Chain & Infrastructure | Audit `package.json` manifests for strict `"workspace:*"` specifiers and test optional local Docker container adapter. | Monorepo root, `package.json` |
| **Epic 8** | QA & Observability | Log diagnostic trace events to `JsonlTraceStore`, trigger log rotation, verify trace recovery after process restart. | `packages/trace-store`, `tests` |

---

## 4. Regression Test Catalog for Audit Findings

| Audit Finding ID | Remediation Task ID | Target Test File | Specific Regression Test Description |
|---|---|---|---|
| `MH-AUDIT-GIT-010` | `MH-REM-001` | `tests/git-dirty-workspace-grounding.test.ts` | Create uncommitted user file in target repo, trigger GroundingAgent, assert dirty file is preserved untracked. |
| `MH-AUDIT-PERS-001` | `MH-REM-002` | `tests/run-store-lock-ownership.test.ts` | Acquire durable lock, simulate lock timeout takeover by process B, trigger process A release, verify process B lock remains active. |
| `MH-AUDIT-QA-003` | `MH-REM-003` | `tests/ui-component-rendering.test.ts` | Refactor raw source string matching tests in `tests/run-loading-skeleton.test.ts` and `tests/typography-scale.test.ts` to DOM rendering assertions. |
| `MH-AUDIT-INFRA-001` | `MH-REM-004` | `tests/infra-workspace-deps.test.ts` | Parse all monorepo `package.json` files and verify internal package dependencies use `"workspace:*"`. |
| `MH-AUDIT-QA-002` | `MH-REM-005` | `tests/execution-core-validation-runner.test.ts` | Trigger validation runner timeout, verify all descendant child process PIDs are terminated cleanly. |
| `MH-AUDIT-ORCH-001` | `MH-REM-006` | `tests/task-graph-artifact-cycles.test.ts` | Construct circular `ArtifactRequirement` producer-consumer graph, invoke `validateGraphRevision()`, assert cyclic error. |
| `MH-AUDIT-ORCH-002` | `MH-REM-008` | `tests/scheduler-conflict-constraints.test.ts` | Define `ConflictConstraint` between Node A and Node B, trigger `selectReadyWaveV2()`, assert Node B is excluded while A runs. |
| `MH-AUDIT-SEC-001` | `MH-REM-018` | `tests/security-planning-env.test.ts` | Spawn planning process in `run-coordinator-host.ts`, assert `process.env` contains only allowlisted keys and PID is registered. |
| `MH-AUDIT-SEC-002` | `MH-REM-019` | `tests/scope-path-traversal.test.ts` | Pass `../../etc/passwd` to `ScopeChecker`, assert path traversal error thrown. |
| `MH-AUDIT-GIT-001` | `MH-REM-020` | `tests/worktree-gc-pipeline.test.ts` | Execute run pipeline with intentional crash, verify `worktrees.gcRun()` cleans worktree directory in `finally` block. |
| `MH-AUDIT-PERS-002` | `MH-REM-012` | `tests/run-store-atomic-write.test.ts` | Inject write lock contention during `atomicWrite()`, verify backoff retries and `.tmp` file cleanup on error. |
| `MH-AUDIT-PERS-006` | `MH-REM-014` | `tests/attempt-store-transitions.test.ts` | Attempt invalid status transition on `JsonlAttemptStore`, assert immutability error. |
| `MH-AUDIT-API-001` | `MH-REM-032` | `tests/api-sse-disconnect.test.ts` | Abort SSE HTTP request signal, assert background store polling timer stops within 100ms. |
| `MH-AUDIT-API-006` | `MH-REM-031` | `tests/api-auth-guards.test.ts` | Send external request to Next.js API, verify host binding is strictly `127.0.0.1` with CSRF validation. |
| `MH-AUDIT-AI-001` | `MH-REM-038` | `tests/ai-prompt-injection.test.ts` | Place prompt injection string in repo file, pass to `WorkBreakdownPlanner`, verify snippet is enclosed in `<user_file_content>` XML tags. |
| `MH-AUDIT-AI-002` | `MH-REM-039` | `tests/ai-budget-limits.test.ts` | Set max token budget to 500 tokens, trigger high-token LLM request, assert `TokenBudgetExceededError`. |
| `MH-AUDIT-QA-001` | `MH-REM-044` | `tests/trace-store-durability.test.ts` | Emit trace events to `JsonlTraceStore`, restart process, verify events persist and re-read from disk. |

---

## 5. Test Runner Invocations & Continuous Verification

To maintain continuous verification throughout remediation:

```bash
# 1. Primary Full Suite Test Runner
pnpm test

# 2. Package-Specific Targeted Test Invocations
pnpm --filter @manyhands/task-graph test
pnpm --filter @manyhands/run-store test
pnpm --filter @manyhands/execution-core test
pnpm --filter @manyhands/decomposer test
pnpm --filter @manyhands/web test

# 3. Monorepo Typecheck Verification
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit

# 4. Production Build Verification
pnpm build
pnpm web:build
```
