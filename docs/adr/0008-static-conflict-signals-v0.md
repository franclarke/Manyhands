# ADR 0008 - Static Conflict Signals V0

> Current note (June 2026): this ADR is historical. Repository indexing remains useful, but the thesis/evaluation framing below is no longer active.

## Status

Accepted.

## Context

ManyHands initially predicts conflicts from declared `AgentTaskContract` metadata. That made the deterministic mock flow testable, but the thesis needs a path toward repository-informed conflict prediction.

The knowledge base identifies TypeScript compiler signals as an important future differentiator. The project is not ready for a full typechecker or semantic analyzer yet.

## Decision

Introduce:

- `@manyhands/repository-index`;
- a deterministic `TypeScriptRepositoryIndexer`;
- `StaticConflictSignal` in `@manyhands/conflict-risk`;
- optional enhanced risk matrix construction.

The indexer uses `ts.createSourceFile` and simple AST traversal. It does not create a TypeScript `Program`, run the typechecker, execute tests or inspect real git worktrees.

## Consequences

- Conflict prediction can now incorporate repository structure.
- Baseline metadata-only risk remains compatible.
- The scheduler remains decoupled from the indexer.
- The implementation is defendible as TypeScript-aware without becoming a full analyzer too early.
- Static signals v0 must not be presented as complete semantic conflict detection.
