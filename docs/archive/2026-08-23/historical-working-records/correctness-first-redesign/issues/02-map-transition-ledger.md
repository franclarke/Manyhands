# CF-002 — Map invariants and completion criteria to the transition

- **Status:** `closed`
- **Stage / gate:** Stage 0 / input to G0
- **Blocked by:** none
- **Output owner:** `docs/audits/stage-0/transition-ledger.md`

## Objective

Create the auditable crosswalk from every normative invariant I1-I43 and every
completion criterion 1-26 to current evidence, target ownership, implementation
stage, productive cutover, retirement, and final proof.

## Execution

For each invariant and completion criterion, record:

- prohibited false-success/corruption state or required result;
- current owner/path and direct evidence;
- starting status: implemented, partial, incompatible, missing, or unknown;
- precise gap without weakening the target;
- target package/module authority;
- implementation stage and gate;
- productive cutover and legacy retirement obligation;
- deterministic/real/adverse evidence required for closure;
- current G0 disposition.

Cross-reference shared rows rather than treating the completion list as proof of
itself. Preserve useful current safety foundations and identify the gate that
permits their retirement.

## Acceptance criteria

- Exactly 43 invariant rows and 26 completion-criterion rows exist.
- Every row has current owner/path, status/gap, target owner, stage/gate,
  cutover/retirement, and required evidence.
- `mapped` at G0 means only that the transition is attributable; it never means
  the target behavior is implemented.
- No similarly named legacy symbol is accepted as satisfying a target invariant
  without direct behavioral evidence.
- All paths and anchors resolve and `git diff --check` passes.

## Verification

Count I1-I43 and completion rows mechanically, compare them against sections 4
and 18 of the canonical plan, and review a sample of current-owner paths against
source. An independent G0 verifier reviews all rows before closure.
