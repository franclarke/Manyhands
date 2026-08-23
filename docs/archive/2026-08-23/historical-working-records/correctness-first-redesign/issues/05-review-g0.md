# CF-005 — Independently review and close G0

- **Status:** `closed`
- **Stage / gate:** Stage 0 / G0
- **Blocked by:** CF-000, CF-001, CF-002, CF-003, CF-004
- **Output owner:** `docs/audits/stage-0/g0-review.md`

## Objective

Audit the complete Stage 0 handoff on one exact candidate and decide whether
Stage 1 may begin. The verifier must not be an author of the artifacts under
review.

## Review procedure

1. Freeze candidate commit/tree and dirty inventory for the review.
2. Reproduce the clean baseline and compare commands/results with CF-000.
3. Walk the productive-route trace against current code and sample every major
   authority/side-effect claim.
4. Count and review I1-I43 plus completion criteria 1-26 in the transition
   ledger.
5. Count R0-R19 and confirm every outcome remains exactly `not_run` at G0.
6. Review harness roles, ownership, gate policy, failure policy, and freeze on
   premature experiments.
7. Confirm no redesign production implementation preceded G0 and no historical
   adverse evidence was removed or reinterpreted.
8. Classify each gate requirement and publish an explicit decision.

## G0 acceptance criteria

- Clean-clone baseline and productive-route characterization are reproducible.
- Every claim binds an exact candidate/evidence source or is `not_run`.
- Every invariant and completion criterion has current owner, target owner,
  stage, cutover, retirement, and closure evidence mapped.
- Required-cell and harness artifacts are internally consistent and linked.
- No target implementation claim relies on design prose, legacy naming, or
  historical experiment success.
- `git diff --check` and documentation link checks pass on the handoff tree.

## Failure behavior

Any failed or inconclusive requirement creates a causal remediation ticket and
leaves CF-005 open. Do not weaken G0 or mark the stage complete by majority.

## Handoff

Record candidate/tree, reviewer identity, commands, per-requirement outcomes,
findings, residual limitations, and one decision: `G0 satisfied` or
`G0 not satisfied`. Only the first unblocks CF-010.
