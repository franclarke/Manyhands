# ManyHands — Context for AI coding agents

> Communication with Francisco: Spanish. Code and technical names: English.
> Start at [`PRODUCT.md`](PRODUCT.md) and [`docs/README.md`](docs/README.md).

## Product

ManyHands coordinates coding agents to turn a software goal into a verified,
integrated and delivered result. The run is the product unit. The graph is
central during planning/execution; evidence is central once a result exists.

The repository is in transition: documentation describes the target
architecture, while current code may be partial or incompatible. Never claim a
target capability is implemented without inspecting code, tests and persisted
runs.

## Documentation authority

1. `PRODUCT.md` — users and product principles.
2. `docs/DECISIONS.md` — target architecture decisions.
3. `docs/system/` — technical contracts.
4. `docs/design/` — product interaction and visual behavior.
5. `docs/adr/` — rationale and trade-offs.

When current code differs, record a transition gap. Do not silently rewrite the
target to match implementation.

## Target architecture summary

- Hybrid graph: goal root, integration-boundary composites, cohesive leaves.
- Canonical typed relations: parent ownership, `ArtifactRequirement`,
  `SeamBinding`, `ConflictConstraint`.
- Planner and Graph Compiler are separate responsibilities.
- Contracts version goal, scope, seams, artifacts and validation obligations.
- Attempts are immutable and identified by `InputFingerprint`.
- Execution bases materialize only declared artifacts.
- Failures recover by cause, not a universal retry count.
- Run domain events are canonical; snapshots are projections and traces are
  diagnostics.
- Human decisions block only affected readiness.
- Validation builds an Evidence Matrix on exact commits.
- Integration is bottom-up; delivery publishes the validated tree.
- LangGraph, React Flow and CLI executors are adapters, not domain types.
- The canvas never recenters in response to run events.

## Current repository boundaries

Dependency direction remains `apps -> specific packages -> shared` while the
transition is implemented. Do not add new dependencies to legacy
`@manyhands/core`.

| Area | Current location | Target direction |
|---|---|---|
| Graph | `packages/task-graph` | typed relations and revisions |
| Contracts | `packages/contracts` | scope/artifact/validation contracts |
| Planning | `packages/decomposer` | Planner + Graph Compiler boundary |
| Coordination | `packages/orchestrator-graph`, web hosts | framework-independent Run Coordinator |
| Execution | `packages/execution-core` | bases, attempts, validation, integration modules |
| Scheduling | `packages/scheduler`, `conflict-risk` | artifact readiness and constraints |
| Persistence | `packages/run-store`, `trace-store` | domain events separate from diagnostics |
| Grounding | `packages/repository-index` | versioned repository model |
| UI | `apps/web` | one graph/result run workspace |

## Working in the transition

1. Confirm the real Git root and inspect `git status --short` and `git diff HEAD`.
2. Preserve unrelated changes; never reset, clean or stash globally.
3. Trace the productive route and verify current behavior before changing it.
4. For behavioral work, start with a targeted failing regression.
5. Implement the smallest vertical slice that moves toward the target.
6. Do not introduce parallel representations of graph relations, lifecycle or
   evidence for convenience.
7. Update the applicable target docs and future transition ledger.
8. Run narrow checks first, then affected package/web typechecks or builds.

Current safety behavior such as worktree isolation, diff inspection, scope
enforcement, orchestrator-owned candidate commits, process supervision, leases
and fencing must not be weakened during migration. Their target contracts are in
`docs/system/05-worktree-layer.md` and `docs/system/security-boundary.md`.

## Product UI rules

- No primary Tasks/Planning/Integration/Interfaces destinations.
- No imperative node status overrides.
- No automatic `fitView`, focus or zoom on events.
- Decisions use contextual card + accessible dialog + global queue.
- Work independent from a pending decision keeps running.
- Distinguish candidate, verified, stale, failed and delivered.
- Meet WCAG 2.2 AA and support reduced motion.

## Verification

```bash
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
```

For documentation-only changes, verify relative links, obsolete terminology and
the final diff. Do not run expensive builds without a relevant code change.

## Key entry points

- `apps/web/src/lib/server/runs/`
- `apps/web/src/lib/run-model/`
- `apps/web/src/app/runs/[runId]/`
- `packages/task-graph/src/`
- `packages/contracts/src/`
- `packages/decomposer/src/`
- `packages/orchestrator-graph/src/`
- `packages/execution-core/src/`
- `packages/run-store/src/`
