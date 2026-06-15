# ADR 0001 - Project Scope For Phase 0 And Phase 1

## Status

Accepted.

## Context

The repository started with two root-level source documents:

- `ManyHands_KB_Codex.md`;
- `Manyhands_propuesta.pdf`.

The requested path `docs/manyhands-knowledge-base.md` did not exist. The source documents agree that ManyHands should first build a narrow, testable core before investing in UI, real agents, real worktrees or experiments.

## Decision

This iteration implements only Phase 0 and Phase 1:

- TypeScript monorepo setup;
- pure task graph model;
- pure contract model;
- deterministic conflict risk model;
- basic scheduler;
- in-memory trace store;
- stub runner boundary.

The original root knowledge base is preserved unchanged. A small documentation pointer now exists at `docs/manyhands-knowledge-base.md`.

## Consequences

- The project is immediately testable and extensible.
- No secrets, external agents, subprocesses or real worktrees are used.
- UI and empirical evaluation remain intentionally outside this iteration.
