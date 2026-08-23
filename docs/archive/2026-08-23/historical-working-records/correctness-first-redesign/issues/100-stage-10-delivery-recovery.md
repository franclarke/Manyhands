# CF-100 — Stage 10: adverse recovery and exact delivery

- **Status:** `ready-for-agent`
- **Blocked by:** CF-090
- **Gate:** GDel
- **Required cells:** R12 and the GDel portion of R13

## Outcome

Make delivery a durable intent over an exact validated source manifest and
expected destination, with compare-and-swap/fast-forward publication,
ambiguous-outcome reconciliation, and immutable receipt.

## Mandatory first action

Inspect the current delivery safety foundation and all publication paths. Split
intent/receipt, destination checks, CAS adapter, crash matrix, stale review,
diagnostics, clean-clone oracle, and legacy retirement.

## Acceptance

- Crashes before/during/after publication converge to one authoritative receipt
  and target state.
- Dirty, diverged, or unexpectedly advanced target fails closed (R12).
- A changed candidate invalidates review and cannot deliver (R13).
- Clean clone reproduces the delivered tree and product claim.

## Retirement

Delete all delivery routes without durable intent, CAS, exact tree verification,
and reconciliation.
