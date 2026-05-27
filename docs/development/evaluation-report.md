# Evaluation Report

## Schema Version

Current schema:

```txt
manyhands.evaluation-report.v1
```

The schema lives in `@manyhands/evaluator` as `EvaluationReportSchema`.

## Contents

An evaluation report includes:

- report id;
- creation timestamp;
- evaluation mode;
- evaluated runs;
- optional granularity comparison table;
- methodological warnings;
- metadata with schema version, evaluator version, determinism flag and report hash.

## Hash

The report hash is deterministic over canonical JSON with volatile report timestamps excluded.

The hash is a reproducibility aid, not a security guarantee.

## Export

Reports are exported explicitly by the core demo command:

```bash
pnpm demo:compare:granularity -- --export .manyhands/comparisons/passwordless-login-granularity.mock-eval.json
```

The exported JSON is validated against `EvaluationReportSchema` before it is written.

## Relationship To RunSnapshot

`RunSnapshot` remains the complete artifact for one run. `EvaluationReport` is a derived artifact that summarizes one or more snapshots.

The report stores metrics, warnings, hashes and comparison rows. It does not replace snapshots or embed a full run history database.
