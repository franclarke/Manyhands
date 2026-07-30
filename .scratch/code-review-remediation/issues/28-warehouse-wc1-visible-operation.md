---
title: "Warehouse WC1 — operación visible"
status: ready-for-agent
labels: [warehouse, successor, wc1]
blocked_by: [02]
---

# Warehouse WC1 — operación visible

## What to build

Implement the compact successor slice for orders, reservations and visible
operation. Preserve the approved W1 result as historical `1/8`; WC1 is a new
claim and must not be presented as a continuation of W1 evidence.

## Acceptance

- Orders and reservations are atomic and reject invalid state transitions.
- The API is versioned and emits monotonic SSE events.
- The SVG tower exposes heatmap information plus a textual detail equivalent.
- The deterministic simulation supports `play`, `pause`, `step` and `reset`.
- A freeze records commit, prompts, probes, budgets, cut rules and oracle
  hashes before the candidate execution.
- Candidate SHA, receipt and oracle outcome are persisted; without a candidate
  SHA the oracle is `not_run`.
- Tests cover success, invalid transitions, atomic conflicts, event ordering,
  simulation controls, keyboard access and non-color status communication.

## Evidence required

One candidate execution, one delivery/oracle record, test output, exact commit
and a claim update. Productive defects require TDD and an explicit successor
protocol; never repeat a measurement silently.

## Verification checkpoint - 2026-07-30

Implementation verified in external successor commit `8ce6e98` over W1
`71f61c9`: the compact repository passes its cumulative tests, typecheck, build,
WC1 probe and HTTP smoke. The ManyHands-attributed WC1 v4 candidate
(`bf9926e4-0edf-4e94-949d-8ac27b183cef`) failed during planning because Codex
provider capacity was exhausted; it has no candidate SHA, receipt, delivery or
oracle and is preserved as `not_run`. The ticket remains open because the
candidate/delivery acceptance is not met.
