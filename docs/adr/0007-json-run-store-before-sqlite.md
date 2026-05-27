# ADR 0007 - JSON Run Store Before SQLite

## Status

Accepted.

## Context

The original roadmap names SQLite as the trace persistence backend. SQLite is still a good fit for queryable run history, dashboards and evaluator workflows, but Phase 4 mainly needs reproducible artifacts and import/export.

Adding SQLite now would introduce native dependency and migration concerns before the snapshot schema has stabilized.

## Decision

Implement `JsonRunStore` first behind a persistent store interface.

SQLite is postponed to a later phase and should implement the same run snapshot contract when richer querying becomes necessary.

## Consequences

- Phase 4 remains portable and low-friction.
- Run artifacts are easy to inspect and version explicitly.
- Query capabilities are intentionally basic.
- The roadmap is adjusted from "SQLite now" to "persistent run snapshots now, SQLite adapter later".
