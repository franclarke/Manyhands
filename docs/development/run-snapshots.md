# Run Snapshots

## Purpose

A `RunSnapshot` is the stable artifact for a ManyHands planning/execution run. It captures enough information to audit, reload, compare and inspect a deterministic mock run without re-running the pipeline.

## Schema Version

Current schema:

```txt
manyhands.run-snapshot.v1
```

Every exported snapshot includes this value in `metadata.schemaVersion`.

## Contents

A snapshot includes:

- run id, feature id, status and decomposition mode;
- original `FeatureRequest`;
- task graph snapshot;
- leaf task contracts;
- conflict risk predictions;
- optional repository index summary and hash;
- optional static conflict signals;
- scheduled batches and blocked tasks;
- simulated agent run results;
- scope validation results;
- trace events;
- execution summary;
- metadata such as timestamps, deterministic flag, fixture version and hashes.

## Hashes

Phase 4 computes deterministic SHA-256 hashes over canonical JSON:

- `inputHash`: feature request plus decomposition mode;
- `outputHash`: full snapshot with volatile timestamps excluded.

These hashes are for reproducibility checks and artifact comparison. They are not security guarantees.

## Mock Limits

Snapshots produced by `MockWorktreeRunner` contain simulated diffs and validation results. They validate orchestration, traceability and schema stability, not the quality of generated application code.
