# Persistent Trace Store

## Goal

Phase 4 introduces persistent run artifacts for the deterministic mock flow. The system can now keep a complete `RunSnapshot` beyond process memory while preserving the existing `TraceStore` interface.

## Store Choice

The first persistent implementation is `JsonRunStore` in `@manyhands/run-store`.

It stores one JSON file per run under:

```txt
.manyhands/runs/
```

This directory is ignored by git. Explicit exports can still be written to `examples/runs/` or another path when a reproducible fixture artifact should be versioned.

## Interface

`JsonRunStore` implements the current trace methods:

- `append`;
- `list`;
- `findByType`;
- `findByTask`;
- `clear`.

It also supports persistent run operations:

- `saveRunSnapshot`;
- `getRunSnapshot`;
- `listRunSnapshots`;
- `exportRun`;
- `importRun`.

## Why Not SQLite Yet

SQLite remains the intended future backend for richer query history, dashboard support and evaluation. It is postponed because Phase 4 needs reproducible artifacts more than relational queries.

The JSON store avoids native dependencies and migration work while establishing the durable schema that a future SQLite adapter can persist.

## Limitations

- Listing runs scans JSON files.
- Query filters are intentionally basic.
- There are no migrations yet beyond `schemaVersion`.
- This store does not make mock execution empirical evidence of implementation quality.
