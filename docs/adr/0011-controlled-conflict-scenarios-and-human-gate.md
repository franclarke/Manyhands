# ADR 0011: Controlled Conflict Scenarios And Human Gate

> Superseded note (June 2026): `benchmarks/conflict-v0`, B4 and deterministic
> human-gate reports are retired. This ADR is historical context only.

## Status

Accepted.

## Context

Phase 7 introduced a mock benchmark with B0-B3, but the general fixtures did not always make naive parallel and risk-aware scheduling visibly different. ManyHands needs controlled conflict cases to evaluate whether risk-aware scheduling and human gating produce auditable structural differences.

## Decision

Create `benchmarks/conflict-v0` as a separate benchmark dataset focused on conflict scenarios. Add B4 `human_gated_mock` as a deterministic wrapper over `risk_aware` scheduling.

B4 does not add a scheduler policy. It applies a pure post-scheduling gate:

- high risk pairs are marked serialized;
- blocking pairs require simulated review;
- blocking tasks are serialized after mock review as singleton batches.

Benchmark reports include human gate metrics and warnings that the gate is mock-only.

## Consequences

The benchmark can now show observable differences between B2, B3 and B4 without real agents or worktrees.

`blocking` remains a heuristic orchestration signal. It must not be presented as proof of a real merge conflict or real human intervention.

## Deferred

Real human review UX, real runners, real worktrees, SQLite, UI and semantic typechecker support remain out of scope.
