# Stage 10 / GDel — Crash-Safe Exact Delivery

**Status:** `in_review`

**Implementation candidate:** `f9ddecc1625c1f687f562ac37148b9d20e22651e`
**Tree:** `e7a0990bea99e7af58427f2cb8b3fa45da69af28`
**Plan:** [`../../plans/2026-08-15-stage-10-crash-safe-exact-delivery.md`](../../plans/2026-08-15-stage-10-crash-safe-exact-delivery.md)
**Design:** [`../../superpowers/specs/2026-08-14-stage-10-exact-delivery-design.md`](../../superpowers/specs/2026-08-14-stage-10-exact-delivery-design.md)

## What this stage was for

Publication was a check followed by `git merge --ff-only`. Two processes, a
window between them, and a write whose only condition is reachability — so a
branch that advanced to any ancestor of the candidate could be published onto
while the receipt still named the head that was approved. Around that write,
neither a crash nor a refusal had a defined outcome.

Stage 10 makes publication one conditional ref update with an immutable receipt
for the exact delivered tree.

## Entry state, and why it was re-derived

The first plan draft (2026-08-14) was written before delivery had ever run. Run
`run:e57c00763674f0ca0520253ac976d2b552c5dac26df609f6f2384d2588674450` planned,
executed, integrated, verified and delivered on 2026-08-15 — the target's `main`
moved `00273f0` → `3b84716` and the delivered tree passed its own 14 tests. That
run is what made two defects visible, and the plan was redrawn against it
before any code moved.

## Evidence per invariant

| Invariant | Where | Result |
| --- | --- | --- |
| 1. Publication is one conditional ref update; a target that no longer holds the approved old OID fails closed, ancestors included | `tests/stage10-delivery-boundary.test.ts`, `tests/stage10-adverse-delivery-cells.test.ts` R12a/R12b | pass |
| 2. A crash converges to exactly one receipt and one target state, never to a receipt nobody observed | `tests/stage10-delivery-restart-matrix.test.ts`, five cells | pass |
| 3. The receipt records the exact delivered tree, ref and cleanliness policy | `tests/stage10-delivery-receipt.test.ts` | pass |
| 4. An approval is invalid once its candidate changed | `tests/stage10-stale-approval.test.ts` | pass, already held |
| 5. Every recovery failure carries a typed diagnostic that reaches the journal | `tests/stage10-recovery-diagnostics.test.ts`, `tests/stage10-delivery-failure-visibility.test.ts` | pass |
| 6. A dirty or diverged target publishes nothing | `tests/stage10-adverse-delivery-cells.test.ts` R12c ×3 | pass |
| 7. A clean clone reproduces the exact tree | `tests/stage10-clean-clone-reproduction.test.ts` | pass |

The restart matrix measures "published once" with the ref's reflog rather than
by comparing OIDs: two publications that land on the same commit are
indistinguishable by OID and distinguishable by reflog entry.

## Defects found and fixed

**A delivery failure was unreachable.** The delivery adapter threw when
publication rejected. Nothing caught it — the error only reaches a queue
`drainEffects()` reads, and the IPC-serving daemon never drains — so a diverged
target parked the run at `effect.requested` forever with no `delivery.failed`
and no diagnostic. This is the defect fixed for `model_call` in `fb16e5ac`;
delivery was not fixed with it. Until this landed, every fails-closed cell in
this stage could be asserted only at unit level, because a real run would hang
rather than fail.

**A missing durable result fabricated a success.** A completed effect whose
durable receipt was absent synthesized one from the approval, claiming
`confirmed: true` and `targetHeadAfter: finalSha` for a head nobody observed —
in exactly the crash window this stage exists to close. The planning branch
beside it already failed closed.

## Findings recorded rather than fixed

- **`approve_delivery` has no productive producer.** The decision kind exists in
  the vocabulary and nothing raises it; delivery is authorized by the durable
  `deliver_run` command, whose approval the reducer checks. Writing a
  decision-path guard would have manufactured the thing under test.
- **R13's window closes earlier than the plan assumed.** A run that reached
  `result_ready` refuses new validation evidence outright, and so does one that
  is `delivering`, so an approved candidate cannot be superseded while an
  approval is outstanding. Producing a different candidate requires returning
  the run to `running` first.

## Deviations from the plan

1. **The write uses the delivery port's own Git helper, not `GitRunner.updateRef`.**
   Both shell to `git update-ref <ref> <new> <old>`. `GitRunner` applies the
   artifact policy — `core.autocrlf=false`, `core.eol=lf` — and delivery
   operates on the user's checkout, which `deliveryTargetGitPolicy` exists to
   judge under its own line-ending rules.
2. **The draft's legacy-retirement task was deleted, not performed.** The search
   for a second delivery writer found exactly one, so there was no legacy
   publisher to retire; the reachability guard moved into the task that replaced
   the write (`tests/stage10-delivery-write-reachability.test.ts`).
3. **The draft's separate "pin the boundary" task was dropped.** Its three RED
   tests would have stayed red across two commits; each now lands red in the
   task that turns it green.

## Sequencing deviation

Stage 8 / GLeaf is `in_review` with a `NO-GO` gate review pending one live Codex
re-run, and Stage 9 / GI is `in_review` pending a bounded independent review.
The redesign plan does not authorize Stage 10 before both pass. Francisco
directed this stage to proceed on 2026-08-15, after the live composite run
exercised the GLeaf and GI surfaces end to end with `claude-code-cli`. This is a
sequencing deviation, not a passed gate: **Stage 10 cannot close before Stages 8
and 9 close.**

## Limitations

- No live model run was performed for this stage. Every cell uses real Git
  repositories, real processes and real journals, and no model.
- The crash cells simulate a crash by restarting the transaction from the
  repository state a crash would leave. They do not kill a live daemon
  mid-write; the process-level crash matrix remains
  `tests/run-engine-effect-crash-matrix.test.ts`.
- Delivery to a remote is out of scope. Every cell delivers to a local checked
  out branch, which is what the productive path does today.
- The `.manyhands/` cleanliness exemption is asserted for a file directly under
  the runtime directory. A repository that keeps unrelated work under that name
  would be misjudged, and nothing detects that.

## Verification on the exact tree

```
corepack pnpm test                                      300 files passed, 1 skipped; 1952 tests passed, 10 skipped
corepack pnpm -r --filter "./packages/*" build          13 packages, all Done
corepack pnpm -r --filter "./packages/*" typecheck      13 packages, all Done
corepack pnpm --filter @manyhands/web exec tsc --noEmit exit 0
corepack pnpm --filter @manyhands/web build             exit 0
git -c core.whitespace=cr-at-eol diff --check           clean
```

The dev stack was stopped before the suite: a live daemon holds the installation
lease and fails four suites by contention.

## What remains before GDel closes

1. Stage 8 / GLeaf and Stage 9 / GI must pass.
2. A bounded independent gate review by someone who did not implement Stage 10,
   recorded in `evidence/review-gate.md`.
