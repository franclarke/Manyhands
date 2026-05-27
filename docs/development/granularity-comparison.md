# Granularity Comparison

Lab Mode note: this harness explores structural differences across decomposition granularities. It prepares the evaluation pipeline but does not prove which granularity yields better real code.

## Purpose

The granularity comparison harness runs the same feature through three deterministic decomposition modes:

```txt
coarse -> balanced -> fine
```

The goal is to compare structural and mock execution overhead across granularities, preparing the experimental pipeline for the thesis.

## Default Fixture

The default comparison uses:

```txt
examples/features/passwordless-login.json
examples/repos/aprobado-lite
```

Static conflict signals are enabled by default by indexing `aprobado-lite`.

## Command

```bash
pnpm demo:compare:granularity
```

The command:

- builds the monorepo;
- indexes the repository fixture;
- executes mock runs for `coarse`, `balanced` and `fine`;
- evaluates the three `RunSnapshot` artifacts;
- prints a comparison table and methodological warnings.

Optional export:

```bash
pnpm demo:compare:granularity -- --export .manyhands/comparisons/passwordless-login-granularity.mock-eval.json
```

Optional snapshot persistence:

```bash
pnpm demo:compare:granularity -- --save-runs
```

## Interpretation

The table is useful for inspecting:

- leaf count growth;
- dependency growth;
- risk prediction and static signal volume;
- batch count and average batch size;
- simulated duration and estimated mock wall-clock duration;
- trace event count;
- coordination overhead.

These results are structural and mock-only. They are not evidence that one decomposition produces better code quality.

## Limits

The harness does not run agents, create git worktrees, merge code, run app tests, use SQLite, execute a dashboard or perform statistical analysis.
