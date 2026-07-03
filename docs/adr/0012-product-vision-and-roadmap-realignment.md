# ADR 0012: Product Vision And Roadmap Realignment

> Current note (June 2026): this ADR is historical. Its references to Lab Mode, benchmark reports, mock datasets and thesis defense framing were superseded by the product-first direction in `docs/DECISIONS.md`.

## Status

Accepted.

## Context

Through Phase 8, ManyHands built a solid deterministic core and mock laboratory:

- task graphs;
- task contracts;
- repository indexing;
- static conflict signals;
- conflict risk;
- scheduling;
- mock execution;
- scope validation;
- run snapshots;
- evaluator;
- benchmark reports;
- `mock-v0`;
- `conflict-v0`;
- B0-B4 including B4 human-gated mock.

This foundation is useful, but the project needs to advance toward a real visual application for product clarity and thesis defense. The benchmark should remain a controlled Lab Mode, not the complete identity of the product.

The desired product direction is a web app, and eventually possibly a desktop app, that lets a developer describe a software goal, inspect a generated DAG, run atomic leaf tasks, visualize conflicts and gates, integrate bottom-up and export reproducible evidence.

The architecture should keep compatibility with a future desktop app by preserving clean boundaries between UI, API/core, runner adapters, repository/worktree effects and trace/evaluation artifacts.

## Decision

Reorient the roadmap toward product visualization and API-backed UI work.

Near-term priority becomes:

1. Product vision alignment.
2. Web App Foundation.
3. API layer over the existing core.
4. Benchmark/report viewer.
5. DAG Canvas read-only UI.
6. Task inspector and trace viewer.
7. Live Mock Execution UX.
8. Conflict/gate visualization.
9. Import/adapt the Claude Design DAG canvas and polish.

Real worktrees, validation command running, diff capture, agent adapters and bottom-up integration remain important, but they should follow the stable UI/API foundation.

SQLite remains deferred. JSON snapshots are sufficient until dashboard history, queryable exploration or larger evaluation workflows require a database.

Deep typechecker support remains deferred. Static conflict signals v0 are enough to support the next visual and mock execution phases.

Real agents remain deferred until UI, API and real-runner boundaries are stable. Initial agent support should be behind a feature flag and scoped to one-task or small multi-leaf pilots.

The thesis remains an evaluation of the artifact. Mock benchmarks validate structure and reproducibility; later real execution slices can add stronger evidence.

## Consequences

Positive consequences:

- The demo becomes visually stronger and easier to understand.
- The product has a clearer user-facing narrative.
- Lab Mode remains useful for controlled evaluation.
- Existing deterministic core work is preserved and reused.
- API and UI work can expose real artifacts instead of invented demo data.
- The thesis can distinguish product artifact, mock evaluation and real-agent pilot evidence.

Risks:

- UI work can consume time that might otherwise go to real execution.
- Visual polish could drift from core truth if static mock data is overused.
- A web app can imply product completeness before real agents exist.

Mitigations:

- Build read-only graph and report views first.
- Require API routes to consume existing core flows and artifacts.
- Keep methodological warnings visible.
- Add live mock execution before real execution.
- Introduce real worktrees without LLM before agent adapters.
- Keep real agents behind feature flags.

## Supersedes

This ADR supersedes the immediate priority implied by earlier roadmap notes that placed SQLite or deeper static analysis before UI. Those items are still valid future work, but they are no longer the next strategic step.

It does not supersede ADR 0007's JSON-before-SQLite decision; it reinforces it.
