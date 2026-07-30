---
title: "Warehouse WC3 — durabilidad y cierre operativo"
status: ready-for-agent
labels: [warehouse, successor, wc3]
blocked_by: [29]
---

# Warehouse WC3 — durabilidad y cierre operativo

## What to build

Close the compact Warehouse demonstrator with durable event evidence and an
operable interface.

## Acceptance

- The journal is append-only; snapshots and replay reproduce the exact hash.
- Timeline, event-derived analytics and alerts are available.
- Corruption produces actionable errors and does not become a false PASS.
- Loading, empty, error and connected states are explicit.
- Keyboard operation is complete, reduced motion is respected, and status is
  not communicated by color alone.
- WC1 and WC2 contracts remain compatible and their tests stay green.
- A freeze, candidate execution, delivery receipt and oracle outcome are
  persisted; no candidate SHA means `not_run`.

## Evidence required

Replay/hash probes, corruption probes, accessibility checks, one candidate
execution and one delivery/oracle record. Update claims only from the exact
commit and durable evidence.
