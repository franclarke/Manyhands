# CF-050 — Stage 5: offline semantic planner and compiler

- **Status:** `ready-for-agent`
- **Blocked by:** CF-040
- **Gates:** GP0 and GP1
- **Required cells:** R4 and R5

## Outcome

Prove a progressive, budgeted Planning Engine; structured Granularity Policy;
deterministic Plan Verifier; and direct `SemanticPlan -> GraphRevision`
compiler offline, without productive cutover.

## Mandatory first action

Inspect the productive planner and offline fixtures, freeze recorded model
replays and pre-register topology/browser product oracles. Split planning query
loop, granularity, verifier, compiler, no-progress termination, real-repository
evaluation, and independent oracle review.

## Acceptance

- GP0 proves deterministic, lossless compilation and rejects ownership, proof,
  artifact, seam, and cycle defects before compilation.
- GP1 passes pre-registered real-repository topology and browser-product oracles;
  minimal standard-library fixtures count only as control-plane smoke.
- R4 rejects/asks; R5 produces `needs_input`, never false success.
- Model criticism is advisory and no-progress revisions terminate explicitly.

## Retirement

None until CF-060 moves the productive caller. Keep old/new comparison offline
and prohibit bidirectional domain synchronization.
