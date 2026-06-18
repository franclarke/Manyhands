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
      -> executable contract/interface boundary validation
      -> plan review / approval
  -> executionGraph
      -> grounding / seam preparation
      -> risk-aware wave selection
          -> required run.scheduling.wave_selected event
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
- **Agent execution:** goes through `AgentExecutor` profiles. Claude Code CLI is
  the primary/default product executor; Codex CLI is the selectable alternative.
- **UI state:** the client reduces `RunEvent` and derives view-models with pure
  selectors.

## Runtime Safety and Auditability

The current runtime hardening sequence is intentionally incremental:

- **PR-S1:** run start uses a CAS/active-runner guard so one run cannot launch
  concurrent pipelines. Integration fails explicitly when a successful child has
  no commit to cherry-pick.
- **PR-S2:** critical lifecycle events are awaited/required, best-effort events
  are named as such, and background pipelines can be drained in tests before
  temp cleanup.
- **PR-S3:** critical `RunRecord.status` transitions and
  `run.status.changed` event appends go through audited mutation helpers. JSON
  snapshot + JSONL event log are not a transaction, but divergence is surfaced
  as an explicit persistence error.
- **PR-S4:** the production execution path feeds real contracts, scopes and
  risk predictions into scheduling. Missing safety data serializes
  conservatively with warnings instead of silently falling back to unsafe
  parallelism.
- **PR-S5:** every production wave selected by the web execution host appends
  `run.scheduling.wave_selected` before tasks are dispatched. The event records
  ready, selected and blocked tasks, reasons, risk summary, fallbacks and
  warnings.
- **PR-S6:** executable boundaries validate the approved graph plus leaf
  contracts before approval, replan, execution start/resume, node-run and
  execution-host dispatch. Invalid contract schemas, task id mismatch, unsafe
  repo paths and broken interface producer/consumer relations fail explicitly
  instead of becoming ambiguous scheduling/execution inputs.

Future PRs that change orchestration semantics should update `docs/DECISIONS.md`
with context, decision, justification, consequences/tradeoffs, and the relation
to replay/evaluation traceability.

## Removed Historical Surfaces

The deterministic Lab Mode, `/lab`, `/replay`, `/replay/demo`, benchmark
manifests, mock benchmark reports and old evaluator package are not part of the
current product. Any future quality-measurement strategy must be designed
freshly after product completion.

