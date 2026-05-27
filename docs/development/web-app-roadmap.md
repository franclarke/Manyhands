# Web App Roadmap

This document turns the product and UI vision into concrete web phases. The web app must consume real APIs over the existing core. It should not become a separate mocked product that drifts away from the TypeScript packages.

## Web Phase C - Sprint 1: Semantic planning + interrupted lifecycle

Status: **implemented (Sprint 1 of Fase C)**. Sprint 2 (DAG editing, conflict bottom sheet, integrator actions, Timeline, `/lab/compare`) still pending.

Objective: the Command Center prompt drives a real LLM decomposer, with strict guards and a deterministic fallback that never breaks the canvas.

Delivered:

- `AnthropicDecomposer` implements `Decomposer` and slots into the existing planning flow; output validated via Zod schema + caps per granularity + no-cycle / leaf-criteria guards;
- `decomposer-policy.ts` chooses Anthropic vs deterministic based on `ANTHROPIC_API_KEY` and `MANYHANDS_FORCE_FALLBACK`; `forceFallback` knob for future Lab compare;
- runner persists `RunRecord.decomposition` metadata (`provider`, `model`, `promptTemplateVersion`, `validationErrors`, `fallbackUsed`, `fallbackReason`, `usage`);
- `TaskNodeSchema.metadata?: Record<string, unknown>` (additive, retro-compatible) — Sprint 2 uses for integrator/authorship;
- Workspaces grew optional hints (`repoPath`, `packageManager`, `defaultBranch`, `allowedPaths`, `testCommand`, `buildCommand`) surfaced under "Workspace hints" in the dialog;
- `heartbeatAt` written by the runner every ~4s; sweeper invoked from GET endpoints marks stale `generating`/`running`/`paused` runs as `interrupted`;
- `RunActionBar` shows **Restart** for `interrupted` and `failed`; `POST /api/runs/:id/restart` re-kicks the right pipeline;
- Command Center collapses scenario picker into `Advanced ▸`; the prompt is the dominant input;
- `RunHeader` shows a provider badge (`LLM · <model>` or `fallback · <reason>`);
- 7 new Vitest suites (~35 tests) cover the LLM guards, normalization, fallback orchestration, policy decisions, interrupted sweeper, lifecycle transitions, and workspace settings.

Out of scope (Sprint 2 of Fase C):

- DAG editing endpoints (rename / edit / regen subtree / mark manual);
- Conflict bottom sheet;
- Integrator node creation actions;
- `/lab/compare`;
- Timeline view;
- `RunRecord.patches[]` consumers.

See `docs/adr/0017-llm-decomposer-and-editable-control-plane-fase-c.md`.

## Web Phase B - Run lifecycle + live mock execution

Status: **implemented**.

Objective: introducir lifecycle real de runs sobre el Command Center y stream live de la descomposición + ejecución mock.

Delivered:

- `POST /api/runs` crea un `RunRecord` persistido en `.manyhands/runs/<runId>.json` y kickea la pipeline de planning en background;
- `GET /api/runs[?workspaceId&limit]` lista runs persistidos como `RunPreview`;
- `GET /api/runs/:id` devuelve el record completo;
- `GET /api/runs/:id/events` (SSE) replay-ea el history in-memory y tail-ea live events (`node.added`, `edge.added`, `risk.added`, `agent.run.started/completed`, `validation.completed`, `status.changed`, `heartbeat`);
- `POST /api/runs/:id/{approve-plan,run,pause,resume}` controlan el lifecycle;
- `/runs/[runId]` es la ruta canónica de producto; reusa el canvas vía `RunCanvasShell` con `RunCanvasSource = persisted-run`;
- `/replay/demo` ahora monta el mismo `RunCanvasShell` con `RunCanvasSource = deterministic-replay` (compartiendo el canvas sin duplicación);
- el Command Center suma un `ScenarioPicker` y el botón Start hace `POST /api/runs` → navega a `/runs/[id]`;
- la home consume runs reales (sin fixture), con empty state honesto;
- `RunRepository` interface + `JsonRunRecordStore` (atomic write + mutex per runId) listos para swap a SQLite en Fase C;
- 5 nuevos suites Vitest (`run-record-schema`, `run-record-repository`, `run-lifecycle`, `run-runner`, `scenarios`) sumando 30 tests.

Out of scope (Phase C+):

- LLM real / agentes reales / git worktrees reales;
- edición del DAG (split / merge / regenerate subtree);
- integrator nodes;
- conflict resolution UX rica;
- cuarta granularidad (`ultraFine`);
- SQLite + multi-worker safe lock.

See `docs/adr/0016-run-lifecycle-and-live-mock-execution-fase-b.md`.

## Web Phase A - Command Center

Status: **implemented**.

Objective: replace the placeholder landing with a Claude Cowork–style command center as the canonical entry point of the product.

Delivered:

- `/` (server component) hosts the Command Center: workspace picker, granularity selector (3 niveles), model picker (cosmético), prompt textarea, recent runs strip;
- `/workspaces` (server component) renders a client-driven CRUD list backed by JSON persistence at `.manyhands/workspaces.json`;
- `WorkspaceRepository` interface + `JsonWorkspaceRepository` (in-process mutex + atomic write) so Phase B can swap storage to SQLite without UI changes;
- `GET/POST /api/workspaces` and `GET/PATCH/DELETE /api/workspaces/:id`;
- `GET /api/runs` returns the typed `RecentRunPreview` fixture; client and server agree on the shape that Phase B will project from real persisted runs;
- `lib/granularity.ts` is the single source of truth for the Spanish ↔ `DecompositionMode` bijection;
- `lib/replay-url.ts` is the single source of truth for the Start button URL contract;
- `/build` removed; nav updated to `Home · Workspaces · Lab · Replay`;
- 5 new Vitest suites cover `workspace-repository`, `workspace-schema`, `workspace-slug`, `granularity-mapping`, `replay-url`.

Out of scope (Phase B+):

- `POST /api/runs` (live or persisted);
- workspace-level configuration (repo path, branch, commands, constraints);
- SQLite migration;
- fourth granularity level (`ultraFine`);
- live decomposition streaming.

See `docs/adr/0015-command-center-and-workspaces-fase-a.md`.

## Web Phase 1 - App Shell

Status: implemented.

Objective: establish the web app foundation.

Proposed stack:

- Next.js App Router;
- Tailwind;
- shadcn/ui if it fits the local setup;
- React components with typed props;
- no complex canvas yet.

Deliverables:

- main layout;
- navigation for Build, Lab and Replay;
- placeholder screens for runs, reports and graph;
- basic empty/loading/error states;
- local design tokens or theme setup;
- README notes for running the app.

Out of scope:

- live execution;
- React Flow integration;
- agent configuration;
- production authentication.

## Web Phase 2 - API Routes Over Core

Status: partially implemented.

Objective: expose existing core behavior to the web app.

Suggested endpoints:

```txt
GET  /api/health
GET  /api/benchmarks
GET  /api/benchmarks/:id
POST /api/benchmarks/:id/run
GET  /api/runs
GET  /api/runs/:id
GET  /api/reports/:id
```

Implemented now:

- `GET /api/health`
- `GET /api/benchmarks`
- `GET /api/benchmarks/:id`
- `POST /api/benchmarks/:id/run`
- `GET /api/demo/run-snapshot`

Deferred:

- run listing/detail endpoints;
- report listing/detail endpoints;
- persisted report storage.

Current DAG handoff note: `/api/demo/run-snapshot` returns a single deterministic `RunSnapshot` generated from the existing benchmark flow. By default it uses `conflict-v0`, `B4` and `shared-schema-conflict`. This endpoint is a bridge for the first read-only canvas, not a persisted run API.

Design rules:

- API routes call `@manyhands/core`, `@manyhands/run-store` and `@manyhands/evaluator`;
- responses should preserve schema-compatible artifact shapes when practical;
- UI-specific derived fields should be explicit view models;
- no schema changes just to make the first UI easier;
- errors should explain whether the issue is missing artifact, invalid report or unsupported operation.

Out of scope:

- WebSockets;
- background queue;
- real runner execution;
- authentication.

## Web Phase 3 - Report Viewer

Objective: make `BenchmarkReport` readable in the browser.

Deliverables:

- load report by id or path;
- B0-B4 table;
- aggregate metrics;
- benchmark metadata;
- selected feature/configuration display;
- methodological warnings;
- report hash;
- links to run snapshots when available.

Out of scope:

- changing evaluator metrics;
- charts that imply unsupported statistical significance;
- real code quality claims.

## Web Phase 4 - DAG Canvas Read-only

Status: **implemented (read-only)**.

Objective: render graph structure from `RunSnapshot`.

Library: `@xyflow/react`. See `docs/adr/0014-dag-canvas-read-only.md` for the rationale.

Delivered:

- nodes from `TaskGraph` with serif titles, monospace ids, status pills;
- dependency edges (solid), risk edges (dashed by level, animated for high/blocking), gate edges (amber dashed);
- minimap, controls, dot background;
- multi-axis filter chips on the toolbar: status, risk, kind, gate-required, text search;
- depth-based phase columns with status-aware row ordering and column labels;
- tabbed selected-node inspector (`Overview` / `Contract` / `Risks` / `Trace` / `Validation` / `Diff`);
- methodology banner that keeps Lab Mode warnings visible inside the canvas;
- Lab → Replay navigation: every benchmark configuration links to its canvas.

Out of scope (Phase 5+):

- graph editing;
- drag-to-rewire dependencies;
- live mock execution UX;
- automatic graph refinement.

## Web Phase 5 - Live Mock Execution

Objective: make deterministic mock execution visible as a product workflow.

Deliverables:

- `Run ready tasks` button;
- simulated batches;
- node state transitions;
- trace viewer;
- execution summary;
- snapshot export;
- replay/reset behavior.

Implementation note: this may start as a server action or API call that runs the deterministic flow and streams or steps through already-known trace events. True streaming can come later.

Out of scope:

- real worktree execution;
- LLM adapters;
- concurrent background workers beyond demo needs.

## Web Phase 6 - Conflict/Gate UX

Objective: make conflict-aware scheduling and B4 gate behavior understandable.

Deliverables:

- high and blocking risk visualization;
- conflict evidence panel;
- B4 decisions;
- serialized-by-gate indicators;
- mock human review display;
- comparison between B2, B3 and B4 schedules.

Out of scope:

- real human approval workflow;
- real merge conflict UI;
- modifying scheduler policies.

## Web Phase 7 - Polish / Desktop-like UX

Objective: make the app feel like a serious local developer tool.

Deliverables:

- command palette or command surface;
- keyboard shortcuts;
- search by task, file and symbol;
- minimap polish;
- terminal-like event stream;
- collapsible inspector panels;
- visual style aligned with the Claude/Codex desktop direction;
- responsive layout for defense demo screens.

Out of scope:

- shipping desktop packaging;
- multi-user collaboration;
- production auth and billing;
- provider marketplace.

## Technical Guardrails

- Keep core logic in packages, not in React components.
- Prefer typed data mappers from core artifacts to UI props.
- Render real snapshots before adding live state.
- Keep Lab Mode warnings visible in reports.
- Do not imply real agents, real worktrees or real empirical results until those phases exist.
