# CF-020 — Stage 2: durable daemon kernel and effect protocol

- **Status:** `closed`
- **Blocked by:** CF-010
- **Gates:** GD0 and GD1
- **Required cell:** R9

## Outcome

Create `packages/run-engine` and `apps/daemon` with one fenced actor per run,
authenticated local IPC, durable effect intent, immutable physical receipts,
kind-specific reconciliation, process supervision, and journal-corruption
handling. Use deterministic fakes; this stage does not authorize live execution.

## Mandatory first action

Reinspect current journal, leases, process receipts, operation journals, and web
ownership. Split into actor/event, IPC/security, effect adapters, process
supervision, crash injection, and startup-recovery tickets with disjoint owners.

## Acceptance

- Replay, duplicate commands, fences, and two-daemon exclusion prove GD0.
- Every current physical effect kind passes the before/after-intent, physical
  success, reconciliation, and terminal-append crash matrix for GD1.
- R9 reconciles physical success without duplicate effect or exactly-once claim.
- Browser/web restart is not a lifecycle event in the new kernel.
- Full package/typecheck/build/test gates pass.

## Retirement

No new `globalThis` run owner or web background runner may be introduced. Close
only after independent GD0 and GD1 reviews.
