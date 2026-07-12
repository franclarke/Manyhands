# ManyHands — Context for AI Coding Agents

> This file is for AI coding tools working in this repository (Codex, Cursor, and
> similar). It is NOT the context file read by Claude Code — that is
> `CLAUDE.md`.
> Communication with Francisco: Spanish. Code and technical terms: English.
> Current decision reference: `docs/DECISIONS.md`.
> System walkthrough: `docs/system/`.
> Agent-first UI/orchestration direction: `docs/design/`.

---

## What This Repository Is

ManyHands is an LLM agent orchestration system for software development. It
takes a feature in natural language, recursively decomposes it into a
hierarchical DAG with explicit inter-agent interface contracts
(`sharedInterface`), executes leaf tasks in isolated git worktrees, and
integrates results bottom-up with cherry-pick.

The current priority is product completion: a reliable agent-first run
workspace, durable orchestration state, isolated execution, semantic
integration, and clear human decision gates.

**Not:** a coding agent, a RAG system, an IDE plugin, a benchmark suite, a Lab
Mode replay app, or an organizational memory tool.

---

## Evaluation and Benchmark Status

There is no active benchmark/evaluation methodology in the current roadmap.
Past deterministic Lab Mode work (`mock-v0`, `conflict-v0`, `/lab`, `/replay`,
B0-B4, G3/G6/G9, old benchmark fixtures) is superseded history.

Do not reintroduce old benchmark runners, scenario pickers, deterministic Lab
routes, or thesis experiment matrices. If evaluation becomes relevant again,
surface it as a new design task after the product is stable.

The code still contains some legacy names such as `GranularityVector` and
fixture-based UI tests. Treat them as runtime metrics and regression fixtures,
not as an active thesis/benchmark plan.

---

## System Invariants — Do Not Change Without Discussing

| # | Invariant |
|---|-----------|
| D1 | `graph.dependencies` is canonical. `node.dependencies` is a synced shortcut. Mutation only via `addDependency` / `removeDependency` / `syncNodeDependencies`. |
| D2 | Canonical task intent field is `goal`, never `intent`. Normalize legacy `intent` in parsers; never persist it. |
| D3 | LLM failure → run FAILS with actionable error. No silent fallback to deterministic planning. |
| D4 | Agent execution goes through the `AgentExecutor` seam and configured executor profiles. Claude Code CLI is the primary/default executor and Codex CLI is the selectable alternative (Gemini CLI removed 2026-06-16, see ADR-0031); do not change the default executor policy or add new CLIs without discussing it. |
| D5 | `git diff HEAD` is the only source of truth for what an agent changed. stdout/stderr are diagnostic only (`stderrTail`/`stdoutTail`). |
| D6 | **The orchestrator commits.** Agents must never commit. If an agent commits unexpectedly, policy is explicit (`reject` default or `accept`). |
| D7 | Real isolation comes from the git worktree + `ScopeChecker`, not CLI approval mode. |
| D8 | Integration uses cherry-pick + semantic repair on conflict. Repair context includes parent goal, canonical `sharedInterface`, each child's `goal` and diff. |
| D9 | Parallelism is bounded by execution config and wave selection; default cap is `maxParallel = 6` unless a newer config overrides it. |
| D10 | Timeouts are explicit and configurable per execution/integration contract. |

## Run durability and terminal truth

- A run captures an immutable `RunTargetContext`; planning, provisioning and
  final-artifact reads must use it rather than a later mutable workspace value.
- Mutating background work owns a persisted operation lease. Use the mutation
  helpers/CAS and fencing token; a stale lease must not persist results, events
  or terminal status.
- Repository mutation is additionally guarded by the repository lease. Release
  and takeover are token/fencing scoped; do not replace it with a process-local
  boolean lock.
- Cancellation is two-phase: claim `cancelling`, invalidate the operation lease,
  abort/kill through `ProcessSupervisor`, verify `allDead`, then transition to
  `interrupted`. Do not accept late results or events from the invalidated lease.
- `completed` is reserved for a valid verified/delivered `FinalArtifactManifest`.
  Keep `executionOutcome`, `artifactOutcome`, and `deliveryOutcome` distinct;
  use `partial`, `unverified`, `needs_delivery`, `failed_artifact`, or
  `failed_delivery` when appropriate.

## Scheduling, events and approvals

- Normalize and persist the complete effective execution config before the
  execution host, scheduler or dispatch observes it. The product path remains
  `risk_aware`; absent overrides still enforce `maxParallel = 6`.
- Every selected wave has a durable `waveId`. Persist the required
  `run.scheduling.wave_selected` event, including the effective relevant config,
  before dispatching its tasks.
- The canonical run event log is the durable UI source. Emit facts at their real
  side-effect boundary; executor `exitCode === 0` is never validation success.
  Human gates use `decision.raised`/`decision.resolved`, and visual `gated` is
  derived from pending decisions.
- Semantic plan edits require `expectedVersion` CAS, increment `planRevision`,
  invalidate approval and create the revision-specific approval decision.
  Dispatch requires `approvedPlanRevision === planRevision` plus strict DAG
  validation. Critic-error overrides must be explicit and auditable.

## Safe investigation in a dirty checkout

Before editing, confirm the Git root, inspect `git status --short` and
`git diff HEAD`, then trace the productive route and its tests. Preserve
unrelated changes: never reset, destructive checkout/clean, or global stash.
For a behavioral fix, start with a failing regression, run the narrow test,
then consumer suites/typechecks, and inspect the diff. Update the applicable
progress record without rewriting prior evidence.

---

## Package Boundaries

Dependency direction: `apps → specific packages → shared`. Never import from
`apps` inside packages. `@manyhands/core` is legacy; do not add new dependencies
to it.

| Package | Purpose | Status |
|---------|---------|--------|
| `task-graph` | TaskNode, TaskGraph, DAG validation, topo sort | Active |
| `contracts` | AgentTaskContract, InterfaceContract | Active |
| `decomposer` | Recursive decomposer and LLM planning schemas | Active |
| `orchestrator-graph` | LangGraph StateGraphs and checkpointing | Active |
| `execution-core` | Worktrees, executors, scope, recorder, integration | Active |
| `scheduler` | Wave selection and scheduling policies | Active |
| `run-store` | RunSnapshot, patches, JSON persistence | Active |
| `trace-store` | TraceEvent (planning + execution) | Active |
| `conflict-risk` | Pairwise conflict risk prediction | Active |
| `repository-index` | Structural repo index (feeds conflict-risk) | Active |
| `shared` | EntityId, IsoTimestamp, helpers | Active |
| `core` | Legacy barrel; consumed by apps/web only | Legacy |

---

## Operational Rules

1. Do not re-argue D1-D10 casually. If a change conflicts with an invariant,
   flag it first.
2. Do not use agent stdout to determine changed files. Use `git diff HEAD`.
3. Do not let agents commit. The orchestrator commits.
4. Do not add silent fallbacks for LLM failure.
5. Do not reintroduce Lab Mode, deterministic benchmark routes, old replay
   flows, or old scenario manifests.
6. Use specific packages for new code; avoid `@manyhands/core`.
7. UI/orchestration work follows `docs/design/`: event log as source of truth,
   reducer + selectors for derived state, no imperative node status overrides.
8. If touching core behavior, run the narrow relevant tests first, then broader
   checks as appropriate.

---

## Verification Commands

```bash
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
pnpm web:dev
```

Environment variables:

- `MANYHANDS_CLAUDE_BIN` — path to Claude Code CLI binary (default `claude`).
- `MANYHANDS_CODEX_BIN` — path to Codex CLI binary (default `codex`).
- `MANYHANDS_DECOMPOSER` — optional decomposer override for development.

---

## Key Files

| File | Description |
|------|-------------|
| `packages/task-graph/src/index.ts` | TaskNode, TaskGraph, topo sort |
| `packages/contracts/src/index.ts` | AgentTaskContract + InterfaceContract |
| `packages/decomposer/src/llm/recursive/` | Recursive decomposer implementation |
| `packages/orchestrator-graph/src/` | Planning/execution StateGraphs and checkpointing |
| `packages/execution-core/src/run/executor.ts` | Low-level node execution engine |
| `packages/execution-core/src/integration/agent.ts` | IntegrationAgent / Composer |
| `apps/web/src/lib/server/runs/runner.ts` | Planning + execution pipeline wiring |
| `apps/web/src/lib/server/runs/execution-host.ts` | Web host for execution graph dependencies |
| `apps/web/src/lib/run-model/` | Agent-first client model, reducer, selectors |
| `apps/web/src/app/runs/[runId]/` | Run workspace route |

---

## Reference Documentation

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — current decision synthesis.
- [`docs/system/`](docs/system/) — component-by-component walkthrough.
- [`docs/design/`](docs/design/) — agent-first model and UX/orchestration direction.
- [`docs/development/architecture.md`](docs/development/architecture.md) — architecture overview.
- [`docs/adr/`](docs/adr/) — historical decision record; superseded ADRs are history.

