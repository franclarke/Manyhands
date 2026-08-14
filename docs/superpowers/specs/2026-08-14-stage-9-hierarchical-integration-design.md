# Stage 9 / GI — hierarchical integration and bounded parallel selection

**Date:** 2026-08-14
**Status:** approved design, not yet implemented
**Authority:** this document refines
[`the redesign plan`](../../plans/2026-08-12-correctness-first-system-redesign.md)
Stage 9. Where the two disagree, the plan wins.

## Purpose

Integrate children without an unrestricted super-agent, and select among ready
leaves with real, bounded parallelism.

## Entry state

Stage 9 is **not authorized to start**. Stage 8 / GLeaf is `in_review` with one
open finding: a live R0 re-run under the corrected sandbox capability record,
deferred for Codex quota. This design may be written and reviewed now;
implementation waits for GLeaf to pass.

## What already exists

Stage 9 is mostly a cutover, not new construction.

- `ResourceClaim` is a canonical graph relation
  (`packages/contracts/src/canonical-graph-relations.ts`), and
  `canonical-frontier.ts` already computes readiness against active claims.
- `wave-selector-v2.ts` already selects up to `effectiveConfig.maxParallel`
  ready nodes.
- `canonical-execution-driver.ts` already distinguishes leaf from integration
  attempts, emits `integration.started` with required artifact ids, and demands
  a complete final manifest at the root.
- `V2NodeExecutor` already has an integration path with a child-artifact input,
  an integration timeout, an integration manifest and an
  `IntegrationOperationJournal`.
- Stage 7 already delivered Git-native change-set manifests, exact
  materialization without cherry-pick, retained refs and evidence staleness.

## The gap

1. **Selection is parallel; execution is serial.** The wave loop in
   `canonical-execution-driver.ts` iterates its selected attempts one at a time.
2. **The composite attempt has no parent-owned resource model.** Nothing stops a
   composite from producing a manifest that touches a resource a child owns.
3. **The legacy integration agent survives.** `integration/agent.ts` cherry-picks
   child commits and runs a universal repair — the unrestricted super-agent and
   universal integration repair Stage 9 retires. `V2NodeExecutor` still carries
   commit-as-transport reasoning in its integration repair path.
4. **There is no repair routing.** Any failure raises a generic
   `resolve_conflict` decision regardless of which authority can actually fix it.

## Design

### Ownership

| Concern | Owner |
|---|---|
| Readiness and bounded selection | `scheduler` (pure; unchanged responsibility) |
| Wave orchestration and concurrency | `orchestrator-graph/canonical-execution-driver` |
| Composite attempt execution and scope enforcement | `execution-core` `CanonicalNodeExecutor` |
| Which authority repairs a failure | `run-coordinator` domain |

The executor reports a classified cause. It never chooses who repairs.

### Composite data flow

A child leaf produces a change-set manifest, which is adopted as an artifact.
The composite attempt consumes those exact manifests as declared inputs,
materializes the children's declared OIDs onto its own base tree — no
cherry-pick, no commit ancestry, no text patch — performs its own integration
work inside its own `ResourceClaim` set, and produces its own change-set
manifest, which is validated exactly and adopted.

The composite still invokes an executor for genuine integration work such as
seam glue; the change is what bounds it. Its writes are confined to resources
the composite itself claims, checked by the same enforcer that checks a leaf,
so "integrator" stops being a role with extra reach.

The same `ScopeChecker` and the same scope policy apply to leaves and
composites. A composite is a node with children, not a node with privileges.

### Parent authority

If a composite's produced manifest touches a path covered by a child's
`ResourceClaim` that the composite does not own, that is `ownership_violation`.
It routes to a plan amendment, never to a repair. A parent does not acquire
authority by being above.

### Concurrency (approach A)

Concurrency lives inside the supervised worker, not in the daemon.

1. Ready attempts run concurrently up to `maxParallel`.
2. Each concurrent attempt takes its own worktree from the existing ephemeral
   workspace provider.
3. Every journal append passes through one serialized point, so the
   `expectedSequence` single-writer contract is unchanged.
4. Two unordered nodes never hold `modify` claims on the same resource. This is
   already enforced at readiness; selection asserts it again defensively,
   because a readiness bug must fail loudly rather than corrupt a tree.
5. A failing attempt fails only itself. Siblings continue.
6. Cancellation propagates to every in-flight attempt through the existing
   `AbortSignal`.

**Why not per-attempt process effects.** Attempt-level durable effects are the
architecturally stronger option and are where Stage 10's restart matrix wants to
go, but they pull attempt-level fencing, leases and reconciliation with them.
That is a second stage of work, and Stage 9's gate is about hierarchy and
resource correctness, not process custody. Stage 8 already proved supervised
custody at the run level.

**R16 is still reachable.** A daemon crash during composite integration kills
the run's worker, and reconciliation happens at run level through the existing
`IntegrationOperationJournal` and the Stage 8 restart path — one reconciled
integration attempt and outcome. Approach A does not forfeit the cell.

### Repair routing

A failure is classified and routed to the lowest authority that can fix it:

| Cause | Route |
|---|---|
| Child defect (evidence indicts one child artifact) | new attempt on that child |
| Seam mismatch | attempt on the boundary owner |
| Ownership or topology error | `amend_plan` decision |
| Environment | effect policy; no attempt |

A new candidate makes downstream evidence stale through the Stage 7 mechanism.

### Soft risk

`estimateIntegrationRisk` stays a recorded observation with no authority over
selection. Learned weights stay disabled, with a test proving they cannot
influence selection while unattributed.

### Retirement

`integration/agent.ts` leaves the productive route. It survives only if a named
legacy replay consumer needs it, with retirement at Stage 11.

## Testing

Deterministic throughout: fixtures, real temporary Git, controlled processes. No
model calls, no network, no browser.

Required adverse cells:

- **R1** cross-package seam — typed seam and parent integration evidence.
- **R2** independent leaves — parallelism without resource conflict.
- **R3** sequential rewrite — explicit artifact/version chain.
- **R11** integration defect — repair at the lowest authority.
- **R16** daemon crash during composite integration — one reconciled attempt.

Plus a convergence property: parallel and sequential execution of the same graph
reach the same adopted artifacts when the graph permits both orders.

## Out of scope

Delivery publication, the Stage 10 restart matrix, per-attempt process effects,
live-model benchmarks, the longitudinal study and thesis work.
