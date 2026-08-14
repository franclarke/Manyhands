# Stage 9 / GI — hierarchical integration and bounded parallelism

## Status

**Status:** `in_review`

This record does **not** close GI. The deterministic work is complete and the
handoff tree is green, but two things stand between it and a `pass`, and both
are stated here rather than argued away.

## Order exception

Stage 9 was implemented **ahead of the plan's normative order**, on the
operator's explicit instruction on 2026-08-14. The plan conditions Stage 9 on
GLeaf passing, and GLeaf is `in_review` with one deferred live R0 re-run
awaiting Codex quota. Nothing here substitutes for that evidence: no Stage 9
claim depends on the live path, and GI cannot close before GLeaf does.

## Candidate

Implementation candidate `97b4cea35c8245fce301da11cabfb4ac89e04eac`, tree
`05bea272556183d8f8a051e071a5154b0142879b`.

## What the stage changed

- **Parent-owned resources.** A `modify` claim names a resource; the path comes
  from the artifact that claim produces. A composite writing a path another node
  holds title over now fails with `ownership_violation` before adoption.
- **Repair routing.** A failure is addressed to the lowest authority that can
  fix it. A cause indicting two children routes to a plan amendment rather than
  guessing one.
- **Bounded parallel execution.** A ready wave now executes concurrently up to
  `maxParallel`, with journal appends serialized through one chain and every
  started attempt settled before the wave returns.
- **Exact child artifacts.** Commit replay is opt-in and off by default, with a
  named surviving consumer and a Stage 11 retirement.
- **Selection invariant.** The driver refuses a wave that would run two writers
  of one resource at once.

## Deviations from the written plan

The plan was written before the code was read. Three of its instructions turned
out to be wrong, and following them would have produced a weaker stage.

1. **The authority check lives in the driver, not the executor.** The plan put
   `checkParentResourceAuthority` in `execution-core`. Adoption is the act that
   grants a candidate standing, and a replaceable executor should not be what
   decides whether a node may change another node's resource. It is now
   `checkResourceAuthority` in `@manyhands/task-graph`, called from
   `recordOutcome` beside the existing evidence-authority check.
2. **Applying the leaf scope enforcer to composites would have caught nothing.**
   The plan's Task 2 step 4 assumed scope could express this. A probe of the
   compiled fixture showed `unit:root`'s `allowedPaths` are
   `["src/a.ts", "src/app/wire.ts", "src/b.ts"]` — a composite's scope
   legitimately spans the paths of the children it integrates. Scope and
   authority are different questions and needed different mechanisms.
3. **Deleting commit transport outright was out of scope.** It would have
   stranded the historical V2 replay path the plan keeps until Stage 11 and
   rewritten 13 legacy characterization tests. The capability is gated off by
   default instead, which achieves the stage's retirement without doing Stage
   11's deletion.

The approved design also said the no-two-writers invariant was enforced "at
readiness". It is enforced in the frontier selector (`concurrentHardConflict`);
readiness only blocks against already-active claims. The protection was real, so
the concurrency change was safe, but the design's wording was imprecise.

## One decision the tests forced

`affectedNodeIds` is the scope a pending decision blocks, which is not the same
as who should act on it. Routing repair to a child while blocking only that
child left the failed composite free for immediate re-selection, and the run
exceeded its wave limit. Decisions now carry `repairTargetNodeId` separately
from the blocked scope.

## Required adverse cells

| Cell | Evidence |
|---|---|
| R1 cross-package seam | `tests/stage9-adverse-cells.test.ts` — the composite consumes both children's artifacts and both seams bind to it |
| R2 independent leaves | two disjoint-resource leaves reach peak concurrency 2 and both adopt |
| R3 sequential rewrite | `unit:b` consumes `artifact:a` with an explicit contract revision and a distinct input fingerprint |
| R11 integration defect | the repair target is the indicted child, the composite attempt stays immutably failed, no parent artifact is adopted |
| R16 daemon crash during composite integration | a crash after a child's physical side effect but before it is journaled reconciles to one outcome and applies no child twice |

Plus a convergence property: the same graph at `maxParallel` 1 and 4 reaches the
same adopted artifact digests.

## Commands and results

Run with `corepack pnpm`, because the host's global `pnpm` is 7.29.3 and the
repository pins 11.21.0.

- `corepack pnpm test` on the exact handoff tree: **284 files / 1,870 tests
  passed** (one opt-in live suite and ten tests skipped by design).
- Workspace package typechecks: passed (13 packages).
- `@manyhands/web` `tsc --noEmit`: passed.
- `pnpm build:packages` and the production web build: passed.
- `git -c core.whitespace=cr-at-eol diff --check`: clean.

## Required evidence still missing

- **GLeaf must pass first.** Stage 8 is `in_review` pending one live R0 re-run
  under the corrected sandbox capability record. GI cannot close before it.
- **A bounded independent gate review.** The agent that implemented Stage 9
  cannot supply a review independent from its implementation.

## Limits

Concurrency lives inside the supervised worker. Per-attempt durable process
effects were deliberately deferred to Stage 10, so R16 is covered at the durable
integration-operation boundary with an injected crash rather than by killing a
daemon process mid-integration. No live model, delivery publication, longitudinal
experiment or thesis work was performed.
