# Architecture

ManyHands is a visual orchestration workspace for multi-agent software
development. It accepts a natural-language software goal, plans a DAG of tasks,
executes leaf work in isolated git worktrees, and integrates the resulting
commits bottom-up.

## Product Architecture

```text
Web App (Next.js App Router)
  -> API routes
  -> Planning host / Execution host
  -> LangGraph StateGraphs
  -> execution-core
  -> AgentExecutor profiles
  -> Git / worktree layer
  -> RunEvent log + RunRecord persistence
```

The web app does not reimplement orchestration logic. It calls API routes backed
by package APIs and renders validated artifacts: `TaskGraph`,
`AgentTaskContract`, `RunRecord`, `RunEvent`, diffs, logs, decisions and run
metrics.

## Execution Pipeline

```text
Feature prompt
  -> planningGraph
      -> recursive decomposition
      -> TaskGraph + AgentTaskContracts + sharedInterfaces
      -> plan review / approval
  -> executionGraph
      -> grounding / seam preparation
      -> scope-aware wave selection
      -> RunExecutor.runNode per leaf
          -> WorktreeManager
          -> FileSystemContextPacker
          -> AgentExecutor
          -> ScopeChecker
          -> ValidationRunner
          -> ResultRecorder
          -> orchestrator commit
      -> IntegrationAgent per composite
          -> cherry-pick
          -> semantic repair on conflict
          -> parent validation
      -> run validation and metrics
  -> RunRecord + RunEvent log
  -> web projection
```

`GranularityVector` is still the schema name used for run metrics in
`execution-core`; it is not an active benchmark methodology.

## Package Boundaries

Dependency direction: `apps -> specific packages -> shared`. Never import from
`apps` inside packages. `@manyhands/core` is a legacy barrel; new code should use
specific packages.

| Package | Responsibility | Status |
|---------|----------------|--------|
| `task-graph` | TaskNode, TaskGraph, DAG validation, topo sort | Active |
| `contracts` | AgentTaskContract, InterfaceContract, ExecutionScope | Active |
| `decomposer` | Recursive planning and LLM schemas | Active |
| `orchestrator-graph` | LangGraph StateGraphs and checkpointing | Active |
| `execution-core` | Worktrees, executors, scope, recorder, integration | Active |
| `scheduler` | Scope/risk-aware wave selection | Active |
| `run-store` | Run snapshots/patches and JSON persistence | Active |
| `trace-store` | Trace events | Active |
| `conflict-risk` | Pairwise conflict risk prediction | Active |
| `repository-index` | Structural TypeScript index | Active |
| `shared` | EntityId, IsoTimestamp, helpers | Active |
| `core` | Legacy barrel | Legacy |

## Runtime Design

- **Persistence:** JSON files for workspaces, runs, events and checkpoints.
- **SSE:** run events stream through `/api/runs/[runId]/run-events`.
- **Checkpoints:** LangGraph checkpoints support resume and fork.
- **Repos:** local git workspaces are the product path. Fixture provisioning
  still exists as a generic/testing mechanism, but there is no active benchmark
  fixture suite in the repo.
- **Agent execution:** goes through `AgentExecutor` profiles. Gemini CLI remains
  the primary/default product executor.
- **UI state:** the client reduces `RunEvent` and derives view-models with pure
  selectors.

## Removed Historical Surfaces

The deterministic Lab Mode, `/lab`, `/replay`, `/replay/demo`, benchmark
manifests, mock benchmark reports and old evaluator package are not part of the
current product. Any future quality-measurement strategy must be designed
freshly after product completion.

