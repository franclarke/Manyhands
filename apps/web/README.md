> **Note:** This is a fixture repository for the ManyHands project. It is used for testing and development purposes.

# ManyHands Web

`apps/web` is the Phase 10 web app foundation for ManyHands.

It is a real Next.js App Router app connected to the existing deterministic core through API routes. It intentionally starts with Lab Mode and benchmark reports before adding DAG canvas, live mock execution, real worktrees or real agents.

## Stack

- Next.js 15.5.7
- React 19.2.6
- TypeScript
- Tailwind CSS 4
- App Router route handlers

No shadcn/ui, React Flow, WebSockets, SQLite, real worktrees or real agent adapters are included in this phase.

## Commands

From the repository root:

```bash
pnpm web:dev
pnpm web:typecheck
pnpm web:lint
pnpm web:build
```

The root web scripts build the workspace packages first so the app can import `@manyhands/core` and `@manyhands/evaluator` from their package entrypoints.

## Routes

- `/` - Command Center: prompt + workspace + granularity + model + recent runs.
- `/workspaces` - CRUD over `.manyhands/workspaces.json`.
- `/lab` - Lab Mode landing page.
- `/lab/benchmarks` - benchmark runner over real API routes.
- `/lab/reports` - report persistence placeholder.
- `/replay` - entry cards for the deterministic canvases.
- `/replay/demo` - read-only DAG canvas over a deterministic RunSnapshot.

## API Routes

- `GET /api/health`
- `GET /api/benchmarks`
- `GET /api/benchmarks/[id]`
- `POST /api/benchmarks/[id]/run`
- `GET /api/demo/run-snapshot`
- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/[id]`
- `PATCH /api/workspaces/[id]`
- `DELETE /api/workspaces/[id]`
- `GET /api/runs[?workspaceId&limit]` — lists persisted runs as `RunPreview`
- `POST /api/runs` — creates a run (body: `{ workspaceId, scenarioId, granularity, model, userPrompt? }`) and kicks the planning pipeline
- `GET /api/runs/[id]` — full `RunRecord`
- `GET /api/runs/[id]/events` — SSE replay + tail (`node.added`, `edge.added`, `risk.added`, `status.changed`, `agent.run.started/completed`, `validation.completed`, `heartbeat`)
- `POST /api/runs/[id]/approve-plan` — `needs_review → approved`
- `POST /api/runs/[id]/run` — `approved → running`, kicks the execution pipeline
- `POST /api/runs/[id]/pause` — pauses `generating` or `running`
- `POST /api/runs/[id]/resume` — resumes a paused run

## Workspaces

Workspaces persist at `.manyhands/workspaces.json` in the repository root. If the file is missing on first read, the JSON repository seeds it with `ManyHands` and `Aprobado`. Delete the file to re-seed.

The persistence layer is encapsulated in `WorkspaceRepository` (`src/lib/server/workspaces/repository.ts`). Fase C will swap the JSON implementation for SQLite without touching the UI.

Override the file path with `MANYHANDS_WORKSPACES_FILE=/abs/path/workspaces.json`. See `docs/adr/0015-command-center-and-workspaces-fase-a.md`.

## Runs

Runs persist at `.manyhands/runs/<runId>.json`. Each file is a `{ version: 1, run: RunRecord }` envelope validated with Zod and written atomically. Delete the directory to start fresh.

The persistence layer is encapsulated in `RunRepository` (`src/lib/server/runs/repository.ts`). The lifecycle (`created → generating → needs_review → approved → running → completed | failed`, plus `paused`) is enforced in `src/lib/server/runs/lifecycle.ts`.

Live progressive rendering uses an in-process event bus (`src/lib/server/runs/event-bus.ts`) and SSE. The runner writes `heartbeatAt` every few seconds while generating or running; a sweeper invoked from the GET endpoints marks runs with a stale heartbeat (>10 min) as `interrupted`. The UI surfaces a primary **Restart** action on those runs via `POST /api/runs/:id/restart`. See `docs/adr/0016-run-lifecycle-and-live-mock-execution-fase-b.md` and `docs/adr/0017-llm-decomposer-and-editable-control-plane-fase-c.md`.

## LLM decomposer (Fase C — Sprint 1)

The Command Center prompt feeds an LLM-driven decomposer when `ANTHROPIC_API_KEY` is set. Failures (no key, schema violation, guard rejected, request error) transparently fall back to the deterministic `MetadataDrivenMockDecomposer`. Telemetry (provider, model, validationErrors, usage) is persisted under `RunRecord.decomposition`.

Environment variables:

- `ANTHROPIC_API_KEY` — enables the LLM decomposer. **Never commit.** CI must run without it.
- `MANYHANDS_FORCE_FALLBACK=1` — forces the deterministic fallback even when a key is set. Use it for tests and reproducible Lab comparisons.
- `MANYHANDS_RUNS_DIR=/abs/path/runs` — overrides the runs directory.
- `MANYHANDS_WORKSPACES_FILE=/abs/path/workspaces.json` — overrides the workspaces file.
- `MANYHANDS_REPO_ROOT=/abs/path` — anchors `.manyhands/` to a custom root.

Workspaces grew optional hints (`repoPath`, `packageManager`, `defaultBranch`, `allowedPaths`, `testCommand`, `buildCommand`) consumed by the LLM as planning context. They are NOT executed yet — worktrees and real agents land in Fase D.

Override the runs directory with `MANYHANDS_RUNS_DIR=/abs/path/runs`.

Supported benchmark ids:

- `mock-v0`
- `conflict-v0`

Example run request:

```json
{
  "config": "B4"
}
```

Omit `config` to run all configurations declared by the manifest.

Demo snapshot request:

```txt
GET /api/demo/run-snapshot?benchmark=conflict-v0&config=B4
```

The demo endpoint returns one real deterministic `RunSnapshot` generated through the core benchmark flow. It defaults to `conflict-v0`, `B4` and the `shared-schema-conflict` feature. It does not persist the snapshot.

## Graph Handoff

`src/lib/graph-view-model.ts` maps a `RunSnapshot` into a small UI-facing graph contract:

- `GraphNodeView`
- `GraphEdgeView`
- `RunGraphViewModel`
- `InspectorView` via `buildInspectorView(snapshot, taskId)`

The mapper is intentionally independent from React Flow. The DAG canvas in `/replay/demo` consumes it.

Companion modules:

- `src/lib/graph-filters.ts` — multi-axis filter state (text / status / risk / kind / gate) and helpers.
- `src/lib/dag-layout.ts` — depth-based phase column layout with status-aware ordering.

## DAG Canvas

`/replay/demo` renders a read-only DAG canvas with `@xyflow/react`:

- phase columns with depth labels;
- task cards with serif titles, monospace task ids, status pill, risk/gate tags, expected files preview, footer with dependencies/trace counts and duration/cost;
- dependency edges (solid), risk edges (dashed, color by level, animated for high/blocking) and gate edges (amber dashed);
- minimap, controls, dot background;
- filter chips on the toolbar: status, risk level, kind, gate-required, text search; non-matching nodes are dimmed and edges crossing the filter boundary are dimmed too;
- side inspector with `Overview`, `Contract`, `Risks`, `Trace`, `Validation` and `Diff` tabs.

Visual direction follows the `warm technical` design language: graphite surfaces with coral accents, Newsreader serif for titles, Inter for UI, JetBrains Mono for code/ids.

Components live in `src/components/dag/`:

```
DagWorkspace.tsx
DagCanvas.tsx
TaskNodeCard.tsx
TaskInspector.tsx
GraphToolbar.tsx
RiskLegend.tsx
MethodologyBanner.tsx
```

## Lab → Replay

`/lab/benchmarks` shows an `Open canvas →` link in each report row and a row of pill links pointing at `/replay/demo?benchmark=<id>&config=<C>`. Running a benchmark and opening its canvas is one click apart.

## Tests

Vitest tests for the mapper live at `tests/graph-view-model.test.ts` (16 tests). They exercise `toRunGraphViewModel`, gate detection, status normalization, risk edges, `buildInspectorView` and the filter helpers. They run from the repo root via `pnpm test`.

## Limits

Current benchmark runs are deterministic and mock-only. They do not run real agents, create real git worktrees, execute target repository tests, persist reports or claim final empirical evidence. The `Run ready tasks` button is intentionally disabled — live mock execution lands in a later phase.
