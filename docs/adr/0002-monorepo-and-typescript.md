# ADR 0002 - Monorepo And TypeScript

> Current note (June 2026): this ADR is historical. The package list below includes removed packages such as `worktree-runner` and `evaluator`; use `AGENTS.md` and `docs/DECISIONS.md` for the current package map.

## Status

Accepted.

## Context

The knowledge base marks TypeScript end-to-end, Zod schemas and a monorepo as closed decisions for the MVP. The future conflict predictor will rely on TypeScript compiler APIs, so the core should already live in TypeScript.

## Decision

Use a pnpm TypeScript monorepo with strict compiler settings, Vitest, ESLint and tsup package builds.

Packages are split by responsibility:

- `shared`;
- `contracts`;
- `task-graph`;
- `conflict-risk`;
- `scheduler`;
- `trace-store`;
- `worktree-runner`;
- `core`;
- `evaluator`.

`apps/web` exists only as a placeholder in this phase. A Next.js app is deferred until the domain flow is stable.

## Consequences

- Package boundaries are explicit from the start.
- Tests can validate the core without a browser, database or agent backend.
- Adding a real UI later will not require moving domain logic out of app code.
