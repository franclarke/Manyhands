# Static Conflict Signals

## Purpose

Static conflict signals bridge the gap between declared task metadata and repository-informed conflict prediction.

They are generated from:

```txt
AgentTaskContract[] + RepositoryIndex
```

## Signals V0

The first version detects:

- contracts referencing symbols declared in the same indexed file;
- producer/consumer symbols with indexed locations;
- shared import dependencies;
- shared schema dependencies;
- shared test fixtures;
- critical file overlap;
- missing expected files;
- missing expected symbols;
- public API surface overlap.

Each signal includes task ids, severity and evidence. Pairwise signals can be converted into `ConflictEvidence` for the risk matrix.

## Determinism

Signals are sorted by deterministic ids. Given the same contracts and repository index, the output is stable.

## Limits

Signals V0 are intentionally conservative and auditable. They do not replace real merge validation, typechecking across branches or human review.
