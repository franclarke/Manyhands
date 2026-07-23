# 02 — Product Readiness Levels Framework (PRL)

**Target System**: ManyHands Monorepo (`apps/web`, `packages/*`)  
**Document Version**: 2.0.0  
**Status**: Formal Specification (Single-User Local Application Scope)  
**Author**: Principal Engineering Review Board (Planning Worker 2)  
**Date**: 2026-07-22  

---

## 1. Executive Summary & Purpose

The **ManyHands Product Readiness Levels (PRL)** framework establishes a formal, operational staging model for progressing ManyHands from a local thesis baseline to a **Finished Local Product** (running as a single-user, self-hosted application on `127.0.0.1` / `::1`).

### 1.1 Core Architecture Directive & Product Scope
ManyHands is explicitly designed as a **LOCAL, SINGLE-USER, SELF-HOSTED APPLICATION**. It is **NOT** a SaaS, cloud multi-tenant platform, or enterprise hosted service.

- **Deployment Model**: Local workstation application (clone repo, `pnpm install`, configure local API keys in `.env` / local config, execute locally via `apps/web` or `agy` CLI).
- **Threat Model**:
  - **TRUSTED**: The local human developer / user operating the system.
  - **UNTRUSTED**: Clones of third-party repositories, untrusted file names, symlinks, untrusted git hooks, executed scripts, external dependencies, prompt injection payloads inside code snippets, LLM outputs, and agent-proposed shell commands.
- **Web API Boundary**: Bound exclusively to `127.0.0.1` and `::1` loopback interfaces with strict CSRF / Origin header verification and local confirmation prompts. Multi-tenant OAuth2/SSO, cloud RBAC, cloud billing, and multi-tenant DB segregation are explicitly labeled as `OUT_OF_SCOPE_SAAS`.

---

## 2. Product Readiness Level Overview

| Level | Name | Scope & Operating Model | Host Isolation & Execution | Persistence & Recovery | Security & Boundary | UX & Accessibility |
|---|---|---|---|---|---|---|
| **Level A** | **Local Thesis & Dev** | Local dev baseline; experimental execution | Unsandboxed host Git worktree; direct filesystem access | File-based JSONL event store; ephemeral in-memory trace log | Loopback HTTP; no CSRF / origin validation; unrestricted subprocess env | Local Next.js dashboard; non-blocking decision banner |
| **Level B** | **Secure Local Use** | Developer tool safe for daily local use | Host protection (dirty check); worktree scope checks (`../` traversal guard); supervised subprocess registry | Atomic lock with PID fencing; delayed rename retries; durable disk trace store | Filtered agent env (`buildAgentEnvironment`); command execution approval prompts | Refactored DOM-based UI tests; graph-centric state sync |
| **Level C** | **Reliable Local Beta** | Reliable long-running local runs | Sandboxed worktrees; process quota supervision; clean worktree GC on exit | Snapshot log compaction; event log truncation; crash-consistent recovery | Loopback CSRF / Origin header protection; SSE disconnect teardown | WCAG 2.2 AA compliant UI; keyboard focus; reduced motion |
| **Level D** | **Finished Local Product** | Final Goal: Clone, `pnpm install`, run reliably on local host | Hardened local worktree isolation; cancelable agent runners | Compacting JSONL engine; atomic event store replay; durable diagnostics | XML prompt injection envelopes; local token budget spending caps; local sidecar allowlists | 100% WCAG 2.2 AA; smooth zero-config local setup; clear evidence delivery |

---

## 3. Finding Classification Ledger Taxonomy

In alignment with the single-user local application model, all 81 audit findings are categorized using six formal classification tags:

1. **`BLOCKER_LOCAL_PRODUCT`**: Critical defect that invalidates host safety, data integrity, or core execution for local use (e.g. host dirty workspace pollution, lock deletion races). Must be fixed in Level B.
2. **`REQUIRED_FOR_LOCAL_RELIABILITY`**: High-priority flaw causing crash instability, resource leaks, or broken DAG scheduling during local execution. Must be fixed in Level B/C.
3. **`LOCAL_HARDENING`**: Security or isolation defect concerning untrusted repository contents, prompt injection, path traversal, or subprocess environment leaks. Must be fixed in Level B/C/D.
4. **`OPTIONAL_IMPROVEMENT`**: Low-severity quality, code style, or minor test flakiness issue. Fixed in Level C/D backlog.
5. **`OUT_OF_SCOPE_SAAS`**: Issues pertaining exclusively to multi-tenant cloud hosting, multi-user authentication (OAuth/SSO), cloud billing, RBAC, or Kubernetes multi-tenancy. Excluded from production score and remediation roadmap.
6. **`FALSE_POSITIVE_FOR_LOCAL_MODEL`**: Audited items that assume multi-tenant cloud risks which do not apply to a local loopback application.

---

## 4. Audit Finding Prerequisite Mapping Matrix

The matrix below maps every key finding from `findings-ledger.json` to its classification tag and mandatory resolution level for the local product architecture:

| Finding ID | Severity | Category | Short Title | Finding Classification | Required Level |
|---|---|---|---|---|---|
| `MH-AUDIT-GIT-010` | **P0** | Git Boundary | Grounding Agent Stages User Dirty Workspace | `BLOCKER_LOCAL_PRODUCT` | **Level B** |
| `MH-AUDIT-PERS-001` | **P0** | Persistence | Unconditional Lock Release Deletes Foreign Lock | `BLOCKER_LOCAL_PRODUCT` | **Level B** |
| `MH-AUDIT-SEC-001` | **P1** | Security & Process | Unsupervised Process Spawning & Secret Leakage | `LOCAL_HARDENING` | **Level B** |
| `MH-AUDIT-SEC-002` | **P1** | Security & Scope | Path Traversal Bypass in Scope Enforcement | `LOCAL_HARDENING` | **Level B** |
| `MH-AUDIT-ORCH-001` | **P1** | Orchestration | DAG Cycle Validation Omits Artifact Requirements | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-ORCH-002` | **P1** | Scheduler | Scheduler Ignores ConflictConstraints | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-ORCH-003` | **P1** | Orchestration | ExecutionDriver Promise Mutation Race | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-ORCH-004` | **P1** | Decomposer | Scope Isolation Critic Over-restriction | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-GIT-001` | **P1** | Git & Worktrees | Execution Pipeline Leaks Worktrees & Branches | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-GIT-005` | **P1** | Git & Worktrees | Git Operations Contend on `.git/index.lock` | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-GIT-007` | **P1** | Git & Worktrees | Missing Fallback Git Committer Identity | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-PERS-002` | **P1** | Persistence | Transient Rename Retries Lack Delay | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-PERS-006` | **P1** | Persistence Store | `JsonlAttemptStore` Lacks `update()` Method | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level B** |
| `MH-AUDIT-API-001` | **P1** | API & Web UI | Server SSE Loop Ignores Disconnect Signals | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level C** |
| `MH-AUDIT-API-002` | **P1** | API & Web UI | Unbounded Client Event Buffer & $O(N^2)$ Refold | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level C** |
| `MH-AUDIT-API-006` | **P1** | API & Web Security | Unauthenticated API Endpoints across Web App | `LOCAL_HARDENING` (CSRF / Origin) | **Level C** |
| `MH-AUDIT-API-008` | **P1** | API & Web Security | Unauthenticated Local Pick Folder Dialog | `LOCAL_HARDENING` (Confirmation) | **Level C** |
| `MH-AUDIT-QA-001` | **P1** | QA & Telemetry | Ephemeral Trace Logging Data Evaporation | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level C** |
| `MH-AUDIT-GAP-001` | **P1** | Scalability | Missing Event Log Compaction & Truncation | `REQUIRED_FOR_LOCAL_RELIABILITY` | **Level C** |
| `MH-AUDIT-QA-003` | **P2** | QA Testing | Fragile UI Tests Rely on String Matching | `OPTIONAL_IMPROVEMENT` | **Level C** |
| `MH-AUDIT-AI-001` | **P1** | AI Security | Indirect Prompt Injection via Repo Files | `LOCAL_HARDENING` | **Level D** |
| `MH-AUDIT-AI-002` | **P1** | AI Cost Control | Uncapped Token Budget & Unmetered Invocations | `LOCAL_HARDENING` | **Level D** |
| `MH-AUDIT-AI-003` | **P1** | AI Security | Unrestricted MCP Sidecar Capabilities | `LOCAL_HARDENING` | **Level D** |
| `MH-AUDIT-INFRA-001` | **P2** | Infrastructure | Workspace Specifier Monorepo Inconsistencies | `OPTIONAL_IMPROVEMENT` | **Level D** |
| `N/A (SaaS Auth)` | N/A | Cloud Security | OAuth2 / SSO / Multi-tenant Cloud RBAC | `OUT_OF_SCOPE_SAAS` | N/A (Excluded) |

---

## 5. Transition Matrices & Exit Criteria

---

### 5.1 Transition Matrix: Level A -> Level B (Secure Local Use Gate)

#### 5.1.1 Staging Objective
Ensure the developer's local host workspace, host repository, and secrets are 100% protected against corruption or leakage during agent execution.

#### 5.1.2 Transition Matrix Requirements

| Domain | Baseline (Level A) | Target Requirement (Level B) | Verification Method |
|---|---|---|---|
| **Host Worktree Safety** | `GroundingAgent` commits uncommitted user files (`MH-AUDIT-GIT-010`) | `GroundingAgent` checks `git status --porcelain`. Aborts or isolates skeleton in temp worktree if dirty. | `pnpm test tests/git-dirty-workspace-grounding.test.ts` |
| **Durable Concurrency Lock**| Lock release deletes lock directory blindly (`MH-AUDIT-PERS-001`) | Durable lock release verifies PID and acquisition timestamp in `owner.json` before unlinking lock dir. | `pnpm test tests/run-store-lock-ownership.test.ts` |
| **Path & Scope Boundaries** | Scope checker permits `../` traversal (`MH-AUDIT-SEC-002`) | Strict `path.resolve` normalization and prefix validation against worktree root. | `pnpm test tests/scope-path-traversal.test.ts` |
| **Process Environment** | Spawns processes with raw `process.env` (`MH-AUDIT-SEC-001`) | Supervised process spawning using `buildAgentEnvironment()` filtered keys and `LiveProcessRegistry`. | `pnpm test tests/security-planning-env.test.ts` |
| **DAG Graph Validation** | Cycle check omits `ArtifactRequirement` (`MH-AUDIT-ORCH-001`) | `validateGraphRevision` executes Kahn's algorithm on parentage and artifact requirement edges. | `pnpm test tests/task-graph-artifact-cycles.test.ts` |
| **Scheduler Compliance** | Wave selection ignores `ConflictConstraint` (`MH-AUDIT-ORCH-002`) | `selectReadyWaveV2` filters candidate ready nodes using `ConflictRiskAnalyzer`. | `pnpm test tests/scheduler-conflict-constraints.test.ts` |
| **Worktree Teardown** | Worktrees and branches leak on run exit (`MH-AUDIT-GIT-001`) | `finally` block `gcRun()` execution cleans up temporary worktree directories and branches. | `pnpm test tests/git-worktree-cleanup.test.ts` |

#### 5.1.3 Level B Exit Criteria Verification Command Suite
```bash
pnpm test
pnpm -r --filter "./packages/*" typecheck

pnpm exec jest tests/git-dirty-workspace-grounding.test.ts
pnpm exec jest tests/run-store-lock-ownership.test.ts
pnpm exec jest tests/scope-path-traversal.test.ts
pnpm exec jest tests/security-planning-env.test.ts
pnpm exec jest tests/task-graph-artifact-cycles.test.ts
pnpm exec jest tests/scheduler-conflict-constraints.test.ts
```

---

### 5.2 Transition Matrix: Level B -> Level C (Reliable Local Beta Gate)

#### 5.2.1 Staging Objective
Guarantee long-running crash recovery, compact persistence, background resource teardown, and accessible Web UI for local usage.

#### 5.2.2 Transition Matrix Requirements

| Domain | Baseline (Level B) | Target Requirement (Level C) | Verification Method |
|---|---|---|---|
| **Local API Security** | Open API endpoints (`MH-AUDIT-API-006`, `MH-AUDIT-API-008`) | Web API restricted to `127.0.0.1` / `::1` loopback with CSRF / Origin verification & dialog confirmation. | `pnpm test tests/api-auth-guards.test.ts` |
| **SSE Resource Teardown**| SSE route ignores client disconnect (`MH-AUDIT-API-001`) | `request.signal.addEventListener('abort', ...)` stops event subscriber loop within 100ms on disconnect. | `pnpm test tests/api-sse-disconnect.test.ts` |
| **Client UI Refolding** | $O(N^2)$ full event refolding in UI (`MH-AUDIT-API-002`) | Incremental fold engine with event index checkpointing and max 500 event memory window. | `pnpm test tests/client-state-refold.test.ts` |
| **Event Store Compaction** | Event logs accumulate indefinitely (`MH-AUDIT-GAP-001`) | Event store snapshot compactor truncates historical JSONL logs prior to latest `RunSnapshot`. | `pnpm test tests/run-store-compaction.test.ts` |
| **Trace Store Durability** | Diagnostic logs lost on exit (`MH-AUDIT-QA-001`) | `JsonlTraceStore` durably persisting diagnostic telemetry to disk mirroring `JsonlRunEventStore`. | `pnpm test tests/trace-store-durability.test.ts` |
| **Web UI Accessibility** | Partial accessibility support | 100% WCAG 2.2 AA compliance verified by Pa11y/Axe automated accessibility scans in CI. | `pnpm web:build && pnpm test:a11y` |

#### 5.2.3 Level C Exit Criteria Verification Command Suite
```bash
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm web:build

pnpm exec jest tests/api-auth-guards.test.ts
pnpm exec jest tests/api-sse-disconnect.test.ts
pnpm exec jest tests/run-store-compaction.test.ts
pnpm exec jest tests/trace-store-durability.test.ts
```

---

### 5.3 Transition Matrix: Level C -> Level D (Finished Local Product Gate)

#### 5.3.1 Staging Objective
Deliver a polished, zero-config local product (clone repo, `pnpm install`, set local keys, run reliably) with prompt injection envelopes, local token spending limits, and monorepo hardening.

#### 5.3.2 Transition Matrix Requirements

| Domain | Baseline (Level C) | Target Requirement (Level D) | Verification Method |
|---|---|---|---|
| **AI Prompt Safety** | Direct prompt string interpolation (`MH-AUDIT-AI-001`) | XML envelope wrapping (`<user_repository_file>`) with XML escaping for untrusted repository text. | `pnpm test tests/ai-prompt-injection.test.ts` |
| **Local Token Cost Cap**| Uncapped token consumption (`MH-AUDIT-AI-002`) | Per-run `maxBudgetUsd` spending cap tracking input/output tokens and aborting on budget exhaustion. | `pnpm test tests/ai-budget-limits.test.ts` |
| **MCP Sidecar Security** | Unrestricted sidecar capabilities (`MH-AUDIT-AI-003`) | Capability allowlists, schema parameter validation, and RPC permission checks in local sidecar wrappers. | `pnpm test tests/mcp-sidecar-capability.test.ts` |
| **Monorepo Distribution**| Workspace version inconsistencies (`MH-AUDIT-INFRA-001`) | Standardized `workspace:*` specifiers across all package manifests + zero-config local start (`pnpm dev`). | `pnpm test tests/infra-workspace-deps.test.ts` |

#### 5.3.3 Level D Exit Criteria Verification Command Suite
```bash
pnpm build
pnpm test

pnpm exec jest tests/ai-prompt-injection.test.ts
pnpm exec jest tests/ai-budget-limits.test.ts
pnpm exec jest tests/mcp-sidecar-capability.test.ts
pnpm exec jest tests/infra-workspace-deps.test.ts
```

---

## 6. Governance & Verification Protocol

1. **Local Scope Alignment**: All engineering efforts MUST align exclusively with the local single-user self-hosted product target. Features or audit findings requiring multi-tenant cloud SaaS infrastructure are explicitly deferred as `OUT_OF_SCOPE_SAAS`.
2. **Zero Regression Guarantee**: Higher readiness levels MUST NOT weaken or disable host workspace protections, scope path checks, or lock fencing established in Level B.
3. **Audit Ledger Synchronization**: Remediated audit findings MUST update `evidenceTag` in `findings-ledger.json` with direct links to automated test verification files.
