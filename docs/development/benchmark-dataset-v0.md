# Benchmark Dataset v0

Lab Mode note: this dataset exists to validate orchestration behavior under controlled mock conditions. It is not the product surface and should not be read as final empirical evidence.

Phase 7 introduces a controlled mock benchmark under `benchmarks/mock-v0`.

The dataset contains five small feature fixtures for the `aprobado-lite` repository fixture:

- `passwordless-login`
- `quote-approval-flow`
- `payment-deposit-tracking`
- `customer-follow-up-reminders`
- `public-proposal-link`

Each feature extends the base `FeatureRequest` with experimental metadata:

- `tags`
- `expectedModules`
- `expectedRiskAreas`
- `expectedConflictNotes`
- `fixtureVersion`

These fixtures are not product requirements for a real app. They are deterministic benchmark inputs used to compare orchestration configurations over the same structural pipeline.

## Manifest

The benchmark manifest lives at:

```txt
benchmarks/mock-v0/benchmark.json
```

It uses schema version:

```txt
manyhands.benchmark-manifest.v1
```

The manifest declares the repository fixture, feature fixture paths and benchmark configurations B0-B3.

## Limits

Benchmark v0 measures structure, scheduling, static signal counts, mock execution metrics and coordination overhead. It does not measure real code quality, real agent behavior or real test outcomes.
