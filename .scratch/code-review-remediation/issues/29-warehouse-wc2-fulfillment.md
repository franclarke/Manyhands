---
title: "Warehouse WC2 — fulfillment"
status: ready-for-agent
labels: [warehouse, successor, wc2]
blocked_by: [28]
---

# Warehouse WC2 — fulfillment

## What to build

Extend the WC1 demonstrator with reproducible fulfillment planning while
keeping the data path observable and deterministic.

## Acceptance

- Picking routes are connected, reproducible and shown in visual and textual
  overlays.
- Waves respect a bounded picker capacity.
- Every unassigned order has an actionable explanation.
- The cost model is sensitive to congestion and exposes its inputs.
- Existing WC1 behavior and event ordering remain green.
- A pre-registered freeze, candidate SHA, receipt and oracle outcome exist;
  absent candidate evidence remains `not_run`.

## Evidence required

Deterministic probes for route connectivity, capacity, unassigned explanations
and congestion sensitivity, plus one candidate execution and delivery/oracle
record. Any defect gets a regression and a documented successor protocol.
