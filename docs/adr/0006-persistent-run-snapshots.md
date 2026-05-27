# ADR 0006 - Persistent Run Snapshots

## Status

Accepted.

## Context

ManyHands now has a deterministic mock execution flow that emits graph, contracts, risk predictions, scheduled batches, simulated run results, scope validations and traces. Keeping that data only in memory prevents reproducible inspection and comparison.

## Decision

Introduce `RunSnapshot` as a versioned artifact in `@manyhands/run-store`.

The snapshot stores:

- feature request;
- graph snapshot;
- contracts;
- conflict predictions;
- schedule;
- simulated agent results;
- scope validations;
- trace events;
- summary;
- schema metadata and deterministic hashes.

The current schema version is `manyhands.run-snapshot.v1`.

## Consequences

- Mock runs can be exported, imported and compared without re-running the flow.
- Future UI and evaluator packages can consume a stable artifact shape.
- Schema changes must be explicit and versioned.
- Snapshots remain mock orchestration artifacts, not evidence of real code quality.
