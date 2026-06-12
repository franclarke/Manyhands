# ADR 0013: Web App Foundation

> Current note (June 2026): this ADR records the removed Lab/benchmark web foundation. The current web app no longer exposes `/api/benchmarks` as an active product surface.

## Status

Accepted.

## Context

ManyHands reached Phase 8 with a deterministic core, mock execution, snapshots, evaluator and benchmark reports. ADR 0012 realigned the project toward a visual orchestration product while preserving the benchmark as Lab Mode.

The next step needs to make ManyHands runnable as an application, not only as CLI demos, without prematurely adding DAG canvas complexity or real agent execution.

## Decision

Create `apps/web` as a real Next.js App Router application using:

- Next.js 15.5.7;
- React 19.2.6;
- TypeScript;
- Tailwind CSS 4;
- minimal local components.

Expose the existing deterministic core through API routes before building a complex canvas:

- `GET /api/health`;
- `GET /api/benchmarks`;
- `GET /api/benchmarks/[id]`;
- `POST /api/benchmarks/[id]/run`.

Start with Lab Mode because it already has stable artifacts: `BenchmarkManifest` and `BenchmarkReport`. The UI can list manifests, run deterministic benchmark flows and show report summaries without inventing product data.

Do not import the Claude Design DAG canvas yet. The canvas should come after the app shell and API contract are stable.

Add `workspaceRoot` to `runBenchmarkMockFlow` so web route handlers can resolve benchmark manifests and repository fixtures correctly even when the web process runs from `apps/web`.

## Consequences

Positive consequences:

- ManyHands now has a real web app entrypoint.
- The first UI consumes real core data rather than static mock data.
- Lab Mode warnings remain visible to avoid overstating mock evidence.
- The next phase can focus on read-only DAG rendering from snapshots.

Tradeoffs:

- The UI is intentionally plain and foundation-focused.
- Reports are not persisted yet.
- The app has no React Flow canvas yet.
- The API layer only covers benchmark endpoints so far.

Out of scope:

- shadcn/ui;
- React Flow;
- WebSockets;
- SQLite;
- real git worktrees;
- real subprocess runners;
- real LLM agents;
- bottom-up integration.
