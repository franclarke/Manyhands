# 00 — Audit Integrity & Methodology Review

**Audit Review Date**: 2026-07-22  
**Reviewer**: Planning Worker 1 (Findings Validation & Audit Integrity Reviewer)  
**Target Product Vision**: ManyHands Local Single-User Self-Hosted Developer Product (Localhost Execution)  
**Target Repository**: `c:\Users\franc\Documents\Proyectos\Manyhands`  

---

## 1. Audit Methodology Assessment

### 1.1 Methodology Evaluation
The initial production-readiness audit (documents `00-executive-summary.md` through `14-remediation-plan.md`) conducted a multi-perspective static analysis and architectural review across 13 monorepo workspace targets (`apps/web`, 12 packages in `packages/*`, and top-level configs). 

The initial audit methodology demonstrated high rigor in identifying deep asynchronous races, persistence boundary violations, process lifecycle leaks, and task graph compilation gaps. However, our secondary integrity audit identified three systematic methodology flaws in the initial audit:

1. **Target Architecture Misalignment (SaaS Bias)**: The initial audit evaluated ManyHands under an assumed multi-tenant SaaS / cloud service threat model (requiring OAuth 2.0/OIDC session authentication middleware, RBAC, cross-tenant isolation, multi-tenant rate limits). Per the **ManyHands Product Charter (`PRODUCT.md`, `AGENTS.md`)**, ManyHands is strictly a **Local, Single-User, Self-Hosted Application** running on `localhost` (`127.0.0.1` / `::1`). Evaluated against the local product model, public SaaS auth requirements are out of scope (`OUT_OF_SCOPE_SAAS`), while local threat boundaries (untrusted cloned repos, prompt injection in third-party code, agent process isolation, and local dev workspace protection) represent the true security baseline.
2. **Finding Duplication Across Domain Review Panels**: The initial audit operated split domain panels (Security, Persistence, QA, Scalability, Missing Systems). This domain separation resulted in identical root defects being assigned separate finding IDs across different review files (e.g. `MH-AUDIT-PERS-004`, `MH-AUDIT-QA-001`, and `MH-AUDIT-GAP-002` all document the exact same `InMemoryTraceStore` ephemeral logging bug).
3. **Target Citation Drift**: Certain finding citations in the initial inventory referenced non-existent or legacy directory paths (e.g. `apps/web/src/app/api/runs/[runId]/events/route.ts` instead of the actual Next.js App Router path `apps/web/src/app/api/runs/[id]/run-events/route.ts`).

---

## 2. Quality Review of Initial Audit Findings

### 2.1 Initial Severity Distribution
The initial audit reported 81 findings, breaking down by severity as:
- **P0 Critical**: 2 (2.5%)
- **P1 High**: 28 (34.6%)
- **P2 Medium**: 39 (48.1%)
- **P3 Low**: 12 (14.8%)

### 2.2 Reclassified Severity Distribution (Local Self-Hosted Product Model)
Under the **Local Single-User Product Vision**, findings have been reclassified according to their impact on local developer workspace safety, local execution reliability, and local product usability:
- **Blocker Local Product (`BLOCKER_LOCAL_PRODUCT`)**: 14 findings (Critical defects causing user workspace corruption, process leaks, DAG deadlocks, or lock deletion during local runs).
- **Required for Local Reliability (`REQUIRED_FOR_LOCAL_RELIABILITY`)**: 22 findings (Essential durability, resource cleanup, and stability fixes for long-running local executions).
- **Local Hardening (`LOCAL_HARDENING`)**: 12 findings (Local prompt injection defense, local process sandboxing, localhost CORS/CSRF protection).
- **Optional Improvement (`OPTIONAL_IMPROVEMENT`)**: 24 findings (UI polish, minor style/formatting issues, non-critical refactoring).
- **Merged Duplicate (`MERGED_DUPLICATE`)**: 7 findings (Cross-referenced domain duplicates merged into primary canonical finding IDs).
- **Out of Scope SaaS (`OUT_OF_SCOPE_SAAS`)**: 2 findings (Multi-tenant cloud auth / public internet session middleware).

---

## 3. Evidence Chain Verification & Path Discrepancies

Every finding was spot-checked against the current codebase using automated view and search tools. The table below highlights key verified path corrections:

| Finding ID | Cited Path in Initial Audit | Verified Actual Codebase Path | Line Citation | Validation Verdict |
|---|---|---|---|---|
| `MH-AUDIT-GIT-010` | `packages/execution-core/src/run/grounding-agent.ts:77-101` | `packages/execution-core/src/run/grounding-agent.ts` | Lines 77-101 | **CONFIRMED** (`git.addAllExcluding` called without `statusPorcelain` check) |
| `MH-AUDIT-PERS-001` | `packages/run-store/src/jsonl-event-store.ts:173-197` | `packages/run-store/src/jsonl-event-store.ts` | Lines 173-197 | **CONFIRMED** (`rm(lockPath)` callback deletes active foreign lock) |
| `MH-AUDIT-SEC-001` | `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:117` | `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts` | Lines 115-117 | **RECLASSIFIED** (`supervisedSpawnFn` IS invoked on line 115, but `env: process.env` leaks secrets on line 117) |
| `MH-AUDIT-SEC-002` | `packages/execution-core/src/scope/checker.ts:46-54` | `packages/execution-core/src/scope/checker.ts` | Lines 46-54 | **CONFIRMED** (Missing `path.resolve` boundary check against `worktreeRoot`) |
| `MH-AUDIT-ORCH-001` | `packages/task-graph/src/validate-v2.ts:44-88` | `packages/task-graph/src/validate-v2.ts` | Lines 44-88 | **CONFIRMED** (`validateGraphRevision` checks parentage cycles but omits artifact dependency edges) |
| `MH-AUDIT-ORCH-002` | `packages/scheduler/src/wave-selector-v2.ts:32-79` | `packages/scheduler/src/wave-selector-v2.ts` & `execution-driver.ts` | Lines 6-15 & 126 | **CONFIRMED** (`selectReadyWaveV2` ignores compiled `graph.conflictConstraints`) |
| `MH-AUDIT-API-001` | `apps/web/src/app/api/runs/[runId]/events/route.ts:45-89` | `apps/web/src/app/api/runs/[id]/run-events/route.ts` | Lines 31-63 | **CORRECTED PATH / CONFIRMED** (SSE loop ignores `request.signal` abort) |
| `MH-AUDIT-API-006` | `apps/web/src/app/api/runs/route.ts:12-40` | `apps/web/src/app/api/**/*.ts` (17 routes) | Lines 1-40 | **RECLASSIFIED** (SaaS auth is `OUT_OF_SCOPE_SAAS`; local model requires localhost binding & CSRF) |
| `MH-AUDIT-API-008` | `apps/web/src/app/api/local-fs/pick-folder/route.ts:15-32` | `apps/web/src/app/api/local-fs/pick-folder/route.ts` | Lines 8-18 | **RECLASSIFIED** (Native OS file picker requires local user confirmation) |

---

## 4. False Positive & Duplicate Analysis

### 4.1 Canonical Duplicate Mergers
The following duplicate finding IDs have been identified and merged into their primary canonical finding IDs:

1. **Diagnostic Trace Telemetry Evaporation**:
   - Primary Finding: `MH-AUDIT-QA-001` (`packages/trace-store/src/index.ts:24-60`)
   - Merged Duplicates: `MH-AUDIT-PERS-004` (in 07-persistence report) and `MH-AUDIT-GAP-002` (in 13-missing systems report).
   - *Rationale*: All three findings address the exact same defect: `InMemoryTraceStore` keeps trace events strictly in RAM without persisting to disk.

2. **Web API Route Protection**:
   - Primary Finding: `MH-AUDIT-API-006` (`apps/web/src/app/api/runs/route.ts:12`)
   - Merged Duplicate: `MH-AUDIT-GAP-007` (in 13-missing systems report).
   - *Rationale*: Both findings address missing request validation and authorization controls across Next.js API endpoints.

3. **Artifact Requirement DAG Cycle Validation**:
   - Primary Finding: `MH-AUDIT-ORCH-001` (`packages/task-graph/src/validate-v2.ts:44`)
   - Merged Duplicate: `MH-AUDIT-GAP-003` (in 13-missing systems report).
   - *Rationale*: Both findings document the lack of consumer-producer artifact cycle detection in graph revision validation.

4. **Execution Worktree Garbage Collection**:
   - Primary Finding: `MH-AUDIT-GIT-001` (`apps/web/src/lib/server/runs/v2/execution-pipeline.ts:111`)
   - Merged Duplicate: `MH-AUDIT-GAP-006` (in 13-missing systems report).
   - *Rationale*: Both findings document uncalled `gcRun()` worktree cleanup on run exit.

5. **Event Store Append Overhead**:
   - Primary Finding: `MH-AUDIT-GAP-008` (`packages/run-store/src/jsonl-event-store.ts:220`)
   - Merged Duplicate: `MH-AUDIT-PERS-005` (partially overlapping corrupt read/write loop).
   - *Rationale*: Consolidates event store IO performance and corrupt tail handling into unified persistence remediation.

---

## 5. Threat Model & Product Vision Alignment

### 5.1 Local Self-Hosted Product Threat Model
ManyHands operates as a **single-user desktop / CLI / local web tool**. The threat model is explicitly defined as follows:

- **TRUSTED ENTITY**: The local human user operating ManyHands on their personal machine.
- **UNTRUSTED ENTITY**: 
  - Third-party repositories cloned by the user containing adversarial code, hidden `.git` hooks, malformed filenames, or malicious configuration files.
  - LLM completion outputs generated by external AI models, which may propose unsafe terminal commands, out-of-scope path modifications, or malformed artifact bundles.
  - Indirect prompt injections contained within codebase files read by the repository indexer.
  - Subprocesses spawned by agents (e.g. Claude Code CLI, Codex CLI, MCP sidecars) attempting unauthorized disk access outside the designated worktree.

### 5.2 Product Readiness Level Definitions
To provide actionable milestones toward delivering a **Finished Local Product**, every finding is assigned to one of four Product Readiness Levels:

- **Level A: Local Thesis & Core Integrity**: Hard execution correctness without risk of corrupting the developer's local host workspace. (Fixes `MH-AUDIT-GIT-010`, `MH-AUDIT-PERS-001`, `MH-AUDIT-SEC-002`, `MH-AUDIT-ORCH-001`).
- **Level B: Secure Local Use**: Host worktree isolation, process tree cleanup, token cost caps, prompt injection defense, local cancellation. (Fixes `MH-AUDIT-SEC-001`, `MH-AUDIT-AI-001`, `MH-AUDIT-AI-002`, `MH-AUDIT-GIT-001`, `MH-AUDIT-GIT-005`).
- **Level C: Reliable Local Beta**: Long-running durability, event log append optimization, crash recovery, snapshot compaction, durable trace store. (Fixes `MH-AUDIT-GAP-008`, `MH-AUDIT-QA-001`, `MH-AUDIT-PERS-006`, `MH-AUDIT-API-001`).
- **Level D: Finished Local Product**: Final polish — zero setup friction (`git clone`, `pnpm install`, configure key, run), clean package manifests, 100% test pass rate, UI polish. (Fixes `MH-AUDIT-INFRA-001`, `MH-AUDIT-QA-003`, `MH-AUDIT-QA-004`).

---

## 6. Remaining Blind Spots & Future Recommendations

1. **Windows Native Subprocess Tree Isolation**: Node.js `child_process` handling on Windows does not support native `job objects` out of the box without native C++ addons (`node-pty` or `win-process`). When `taskkill` fails under high CPU load, descendant agent subprocesses can linger.
2. **SQLite vs JSONL Threshold**: At >100,000 events per run, JSONL append files require index scanning during startup replay. Future architecture should benchmark embedding SQLite (`better-sqlite3`) as a storage adapter alternative for ultra-large runs.
3. **MCP Sidecar Process Protocol**: MCP sidecar wrappers (`packages/shared/src/sidecar-wrapper.ts`) lack strict RPC schema validation and rate limiting on tool call execution requests.
