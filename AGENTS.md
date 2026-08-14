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

1. `PRODUCT.md` — users and stable product principles.
2. `docs/plans/2026-08-12-correctness-first-system-redesign.md` — the sole
   target architecture, domain language and implementation sequence.
3. `docs/tesis/` — academic material and attributable historical evidence.
4. Source, tests and persisted runs — evidence of current implementation.

When current code differs, record a transition gap. Never weaken the target to
match implementation or reinterpret historical evidence as current success.

## Target architecture summary

- Hybrid graph: goal root, integration-boundary composites, cohesive leaves.
- Canonical typed relations: parent ownership, `ArtifactRequirement`,
  `SeamBinding` and resource-indexed `ResourceClaim`.
- A queryable Repository Model grounds a progressive Planning Engine.
- `SemanticPlan` is the only planning output; Graph Compiler transforms it
  directly into one `GraphRevision`.
- Contracts version goal, change ownership, context, seams, artifacts,
  validation and composite integration.
- Attempts are immutable and identified by `InputFingerprint`.
- Commits are provenance; execution bases materialize only content-addressed,
  scoped artifact manifests.
- Failures recover by cause, not a universal retry count.
- Run domain events are canonical; snapshots are projections and traces are
  diagnostics.
- A dedicated local daemon owns run actors, processes and journal writes; the
  web application is a command/query client.
- Human decisions block only affected readiness.
- Validation builds a hierarchical Evidence Matrix on exact candidates.
- Composite integration is a first-class attempt with parent-owned shared work.
- Worktree isolation and execution sandboxing are separate capabilities.
- The canvas never recenters in response to run events.

## Current repository boundaries

Dependency direction remains `apps -> specific packages -> shared` while the
transition is implemented. Do not add new dependencies to legacy
`@manyhands/core`.

| Area | Current location | Target direction |
|---|---|---|
| Graph | `packages/task-graph` | typed relations, resource claims and revisions |
| Contracts | `packages/contracts` | all versioned domain obligations |
| Planning | `packages/decomposer` | Repository Query consumer, Planning Engine and Compiler |
| Coordination | current web hosts and `orchestrator-graph` | migrate to `packages/run-engine` + `apps/daemon` |
| Execution | `packages/execution-core` | deep attempt, artifact, validation, integration and sandbox modules |
| Scheduling | `packages/scheduler`, `conflict-risk` | frontier readiness; retire pairwise risk product |
| Persistence | `packages/run-store`, `trace-store` | canonical events separate from diagnostics |
| Grounding | `packages/repository-index` | exact Repository Model and budgeted query interface |
| UI | `apps/web` | daemon client and graph/result projection |

## Working in the transition

1. Confirm the real Git root and inspect `git status --short` and `git diff HEAD`.
2. Preserve unrelated changes; never reset, clean or stash globally.
3. Trace the productive route and verify current behavior before changing it.
4. For behavioral work, start with a targeted failing regression.
5. Implement the smallest vertical slice that moves toward the target.
6. Do not introduce parallel representations of graph relations, lifecycle or
   evidence for convenience.
7. Update the status of the active stage in the canonical redesign plan.
8. Run narrow checks first, then affected package/web typechecks or builds.

Current safety behavior such as worktree isolation, diff inspection, scope
enforcement, orchestrator-owned candidate commits, process supervision, leases
and fencing must not be weakened during migration. Remove a mechanism only when
the replacement invariant and crash/concurrency tests in the canonical plan are
already green.

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

## Agent skills

### Issue tracker

Work is tracked as local Markdown under `.scratch/`; never publish it remotely
without explicit authorization. See `docs/agents/issue-tracker.md`.

### Triage labels

Local ticket states use the canonical Pocock roles plus `closed`. See
`docs/agents/triage-labels.md`.

### Domain docs

This monorepo uses one canonical redesign plan rather than parallel subsystem
specifications. See `CONTEXT-MAP.md` and `docs/agents/domain.md`.

## Learned Operating Rules

- Keep each architecture gate bounded by its written definition of done. After
  the required evidence and one scoped independent review pass, record further
  theoretical hardening as follow-up debt unless it demonstrates a concrete
  violation of a gate invariant; do not recursively expand the evidence harness
  and delay the next implementation stage.
- For long-running clean-clone qualification on Windows, use explicit short
  paths outside `%TEMP%` for the clone, package store and tool shims, verify
  those targets do not exist before creation, and record candidate identity and
  Git cleanliness after the checks. A path under `%TEMP%` can disappear or
  change during an execution; a resulting `ENOENT` is inconclusive and does not
  by itself prove either a product defect or a host cleanup cause.
- For browser evidence of a generated target, start its declared Node entrypoint
  directly and set runtime data paths outside the target when supported. Stop
  that process before delivery, then move any generated untracked runtime files
  to a recoverable evidence directory; package installation or app-generated
  state in the target can make an otherwise valid delivery appear dirty.
- A thesis or showcase experiment intended to demonstrate graph scale or product
  quality must pre-register independent graph-topology and browser-level product
  oracles. A minimal standard-library target and source-pattern checks are only
  control-plane smoke evidence, never proof of rich decomposition or usable
  software.
- For sandboxed live workers, scope brokered credentials to the supervised
  process identity and remove that scope from the supervisor on every verified
  terminal outcome. A worker `finally` is not sufficient after timeout,
  cancellation or daemon crash; qualify the invariant with a live no-auth-file
  check after each path.
- In Windows PowerShell automation, never use the reserved `$PID` variable as a
  loop or task identifier; use a descriptive name such as `$processId` so cleanup
  commands execute rather than fail before acting.
- Before a live daemon/worker qualification, rebuild every changed workspace
  package imported by that worker. Vitest source tests do not prove the
  compiled `dist` dependency path used by the spawned process.
