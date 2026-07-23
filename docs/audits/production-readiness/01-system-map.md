# 01 — System Map & Monorepo Cartography

**Audit Date**: 2026-07-21  
**Target Monorepo**: ManyHands (`apps/`, `packages/`)  
**Auditor**: Teamwork Explorer (Cartography & Architecture Specialist)  

---

## 1. Monorepo Architecture Topology

ManyHands is organized as a pnpm workspace monorepo enforcing a strict unidirectional dependency architecture:
`apps/web` -> `specific packages` -> `@manyhands/shared`.

```
                    ┌─────────────────────────┐
                    │        apps/web         │
                    └────────────┬────────────┘
                                 │
   ┌─────────────────────────────┼─────────────────────────────┐
   ▼                             ▼                             ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│@manyhands/run-coord.    │ │@manyhands/exec-core     │ │@manyhands/decomposer    │
└──────────┬──────────────┘ └────────────┬────────────┘ └────────────┬────────────┘
           │                             │                           │
           ▼                             ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│@manyhands/run-store     │ │@manyhands/task-graph    │ │@manyhands/contracts     │
└──────────┬──────────────┘ └────────────┬────────────┘ └────────────┬────────────┘
           │                             │                           │
           └─────────────────────────────┼───────────────────────────┘
                                         ▼
                            ┌─────────────────────────┐
                            │    @manyhands/shared    │
                            └─────────────────────────┘
```

---

## 2. Monorepo Workspaces Inventory & Status Matrix

| Workspace Name | Path | Type | Implementation Status | Evidence Tag | Architectural Notes / Transition Gaps |
|---|---|---|---|---|---|
| `@manyhands/web` | `apps/web` | App | 🟡 **Partial** | `[Confirmado]` | Next.js 14 App Router. Mixes legacy in-memory run state with V2 event projections. |
| `@manyhands/shared` | `packages/shared` | Package | 🟢 **Complete** | `[Confirmado]` | Base domain types, schemas, and utils. Leaks process spawning in `node-cli-process.ts`. |
| `@manyhands/task-graph` | `packages/task-graph` | Package | 🟡 **Partial** | `[Confirmado]` | Task Graph schemas & revisions. Retains legacy `TaskNode` runtime status fields. |
| `@manyhands/contracts` | `packages/contracts` | Package | 🟡 **Partial** | `[Confirmado]` | Scope/artifact/seam contracts. Exporting legacy `AgentTaskContract` alongside V2 bundles. |
| `@manyhands/decomposer` | `packages/decomposer` | Package | 🟡 **Partial** | `[Confirmado]` | Planner & Graph Compiler. Main output returns legacy `TaskGraph` requiring V2 compiler bridge. |
| `@manyhands/execution-core` | `packages/execution-core` | Package | 🟡 **Partial** | `[Confirmado]` | Worktree manager & candidate validator. Coexists with legacy `src/run/executor.ts`. |
| `@manyhands/orchestrator-graph` | `packages/orchestrator-graph` | Package | 🟡 **Partial** | `[Confirmado]` | V2 Execution Driver. Drives graph execution over RunCoordinator state. |
| `@manyhands/run-coordinator` | `packages/run-coordinator` | Package | 🟢 **Complete** | `[Confirmado]` | State machine reducer for run domain events, input fingerprinting, and evidence matrices. |
| `@manyhands/run-store` | `packages/run-store` | Package | 🟢 **Complete** | `[Confirmado]` | Event store, snapshot store, artifact store, attempt store. |
| `@manyhands/trace-store` | `packages/trace-store` | Package | 🟢 **Complete** | `[Confirmado]` | Diagnostic trace store interface. Currently only implements in-memory trace store. |
| `@manyhands/repository-index` | `packages/repository-index` | Package | 🟢 **Complete** | `[Confirmado]` | Repository snapshotter & TypeScript AST indexer. |
| `@manyhands/scheduler` | `packages/scheduler` | Package | 🟡 **Partial** | `[Confirmado]` | Wave selection & readiness calculation. Coexists with legacy batch scheduler. |
| `@manyhands/conflict-risk` | `packages/conflict-risk` | Package | 🟢 **Complete** | `[Confirmado]` | Conflict risk score analyzer & evidence calculation. |

---

## 3. Package Dependency Matrix

| Workspace | Shared | TaskGraph | Contracts | Decomposer | ExecCore | OrchGraph | RunCoord | RunStore | TraceStore | RepoIndex | Scheduler | ConflictRisk |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `apps/web` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `shared` | — | — | — | — | — | — | — | — | — | — | — | — |
| `task-graph` | ✓ | — | ✓ | — | — | — | — | — | — | — | — | — |
| `contracts` | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| `decomposer` | ✓ | ✓ | ✓ | — | — | — | — | — | — | ✓ | — | — |
| `execution-core` | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| `orchestrator-graph`| ✓ | ✓ | ✓ | — | — | — | ✓ | — | — | — | ✓ | ✓ |
| `run-coordinator` | ✓ | ✓ | — | — | — | — | — | — | — | — | — | — |
| `run-store` | ✓ | — | — | — | — | — | ✓ | — | — | — | — | — |
| `trace-store` | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| `repository-index` | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| `scheduler` | — | ✓ | ✓ | — | — | — | — | — | — | — | — | ✓ |
| `conflict-risk` | ✓ | — | ✓ | — | — | — | — | — | — | ✓ | — | — |

*Verification*: Zero circular dependencies between packages (`0 cycles detected`). Zero legacy `@manyhands/core` imports.
