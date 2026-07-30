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
- [x] Add or verify an integrated regression using the productive validation
      and repair route with an out-of-scope repair edit.
- [ ] Independent Standards and Spec reviews pass at the fixed point.
- [ ] A new WC1 freeze is created only after this ticket and ticket 31 meet
      their acceptance criteria.

## Current verification

- `tests/execution-core-v2-node-executor.test.ts`: 41/41 PASS, including the
  productive out-of-scope repair regression.
- The repair prompt describes `outputRoots` as recursive subtrees, matching the
  canonical scope checker semantics.
- `tests/execution-failure-cause-classification.test.ts`: 8/8 PASS.
- The WC1 v2 run remains preserved and is not retried or reinterpreted.

## Checkpoint retry event-id repair - 2026-07-30

The WC1 v4 run exposed a separate planning lifecycle defect when provider
capacity retry reused logical attempt `1`: `planning-host` attempted to persist
the same event id with a new timestamp. Commit `b8dea56` fixes this by adding
the durable event sequence to planning attempt/node ids while preserving the
payload attempt number. The productive regression passes as part of 34/34
focal tests, and web/decomposer typechecks pass. The two independent review
acceptances remain open because the delegated review threads terminated with
system errors; ticket 32 is not closed.
