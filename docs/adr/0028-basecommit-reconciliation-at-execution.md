# 0028 · baseCommit reconciliation at execution time

## Status

Accepted. Implemented in `createDefaultExecutionEngine` (`apps/web/src/lib/server/runs/runner.ts`, Etapa 2A).

## Context

The `TaskGraph` carries `repo`, `baseBranch`, and `baseCommit`, but the decomposer fills them with mock values during planning. With real repo provisioning (ADR-0027), a run obtains a real `repoRoot` + 40-hex `baseCommit` only at execution time. Something must reconcile the graph's mock values with the provisioned reality. Two options: (a) planning writes the real base commit into the graph, or (b) execution overrides it.

## Decision

**Execution overrides.** Immediately before `RunExecutor.run`, the default engine spreads the provisioned values over the graph:

```ts
graph: { ...input.graph, repo: repoRoot, baseBranch, baseCommit }
```

Planning and the decomposer stay pure: they never receive or persist a concrete base commit. The graph's `repo`/`baseCommit` fields simply stop being load-bearing for real runs.

## Consequences

Positive:
- Provisioning is an execution-time concern (the working tree / SHA only need to exist when running, not when planning). A logical plan is not coupled to one disposable working tree.
- The decomposer stays deterministic; plan-shape and fixture tests are unaffected.
- It is a three-line spread with zero schema churn in `task-graph` or `decomposer`.

Negative / accepted:
- The persisted graph still shows mock `repo`/`baseCommit`. The real values live on the `RunRecord.provisioned` artifact, which is the correct place to inspect what a run actually executed against.

## Alternatives considered

- **Planning writes the real base commit** — rejected: couples a logical, re-runnable, serializable plan to a concrete disposable working tree, and would force the decomposer to depend on provisioning. Re-execution and plan editing become awkward.
