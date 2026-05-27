# Benchmark Runner Mock

Lab Mode note: this runner is a reproducible evaluation harness over the deterministic core. The product roadmap now prioritizes a web UI and API layer that can consume the same artifacts.

`runBenchmarkMockFlow` in `@manyhands/core` orchestrates the Phase 7 benchmark:

```txt
BenchmarkManifest
  -> load feature fixtures
  -> build repository index when needed
  -> run each feature/configuration
  -> produce RunSnapshot artifacts in memory
  -> evaluate aggregate metrics
  -> return BenchmarkReport
```

The runner reuses the existing deterministic execution flow. It does not execute agents, create worktrees, run real tests or write files unless an explicit export/save option is used.

## CLI

```bash
pnpm demo:benchmark:mock
pnpm demo:benchmark:mock -- --export .manyhands/benchmarks/mock-v0/reports/mock-v0.benchmark-report.json
pnpm demo:benchmark:mock -- --save-runs
pnpm demo:benchmark:mock -- --feature passwordless-login --config B3
```

By default the command prints an aggregate table and writes nothing.

## Decomposers

`SingleTaskDecomposer` models B0.

`MetadataDrivenMockDecomposer` uses benchmark metadata to generate deterministic coarse, balanced and fine task graphs for multiple feature fixtures.
