# CF-003 — Register R0-R19 without fabricating baseline outcomes

- **Status:** `closed`
- **Stage / gate:** Stage 0 / input to G0
- **Blocked by:** none
- **Output owner:** `docs/audits/stage-0/required-cells.md`

## Objective

Create the authoritative execution-status register for all required real and
adverse cells while preserving the freeze on premature experiments.

## Acceptance criteria

- The registry contains exactly one row beginning `| R0 |` through `| R19 |`.
- Every G0 row contains the literal status `not_run`.
- Every row copies its earliest gate, primary dimension, and oracle from the
  canonical plan without strengthening or weakening it.
- Every reason explains the missing prerequisite; none implies PASS.
- The update protocol requires exact candidate/environment/oracle evidence and
  preserves adverse results.
- The registry links the canonical plan, transition ledger, and execution
  runbook; all links resolve.

## Verification

```powershell
rg -c '^\| R(?:[0-9]|1[0-9]) \|' docs/audits/stage-0/required-cells.md
rg '^\| R(?:[0-9]|1[0-9]) \|' docs/audits/stage-0/required-cells.md
git diff --check -- docs/audits/stage-0/required-cells.md
```

Expected count: `20`. Close only after an independent reviewer compares all
twenty rows with the canonical table.
