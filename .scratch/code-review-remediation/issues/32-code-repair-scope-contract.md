---
title: "Code repair â€” scope contract and actionable rejection"
status: in-progress
labels: [execution, recovery, scope, successor]
blocked_by: [31]
---

# Code repair â€” scope contract and actionable rejection

## What to build

When exact-candidate validation requests a code repair, the repair executor
must receive the same canonical scope contract as the original execution. The
prompt must enumerate allowed paths, bounded output roots and forbidden paths;
the persisted failure must name the paths rejected by strict scope policy.

This ticket was opened from WC1 v2 run
`d190b07d-d31e-454a-b9ea-7b36ff96ec1b`, where the original candidate was
committed successfully but the repair ended in `scope_violation` and parked
the run on `resolve_conflict`.

## Acceptance

- [x] RED reproduces that the V2 code-repair prompt omitted the canonical scope.
- [x] GREEN includes allowed paths, output roots and forbidden paths in the
      repair prompt.
- [x] Strict-policy out-of-scope failures name the rejected paths in their
      durable reason.
- [ ] Add or verify an integrated regression using the productive validation
      and repair route with an out-of-scope repair edit.
- [ ] Independent Standards and Spec reviews pass at the fixed point.
- [ ] A new WC1 freeze is created only after this ticket and ticket 31 meet
      their acceptance criteria.

## Current verification

- `tests/execution-core-v2-node-executor.test.ts`: 40/40 PASS.
- `tests/execution-failure-cause-classification.test.ts`: 8/8 PASS.
- The WC1 v2 run remains preserved and is not retried or reinterpreted.
