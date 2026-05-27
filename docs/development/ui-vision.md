# UI Vision

## UI Goal

ManyHands should provide a visual workspace where the user can see the execution DAG, task states, dependencies, conflicts, batches and traces. The interface should make multi-agent orchestration understandable at a glance while preserving detailed inspection for each task.

The visual direction should build on the DAG canvas generated in Claude Design, then adapt it into real React components connected to ManyHands data.

## Main Views

- Graph view: primary DAG canvas for Build, Lab and Replay modes.
- Timeline view: chronological trace of planning, scheduling, execution, gate and validation events.
- Board view: task status columns for planned, ready, running, gated, done and failed work.
- Run inspector: selected run, task, contract, diff, validation and trace details.
- Benchmark comparison: B0-B4 metrics and methodological warnings.
- Report viewer: `BenchmarkReport` and `EvaluationReport` artifacts with hashes and export context.

## DAG Canvas

The canvas should show:

- nodes by phase, depth or logical column;
- task cards for composite and leaf tasks;
- dependency edges;
- risk/conflict edges as a separate visual layer;
- high and blocking risk emphasis;
- gate-required indicators;
- minimap;
- zoom and pan;
- filters by status, risk, phase and runner;
- search by task id, title, file, symbol or status;
- status counters;
- `Run ready tasks` button.

Initial implementation should be read-only. Interactions can become writable after the API and core state model are stable.

## Task Card

Each task card should be compact but informative:

- id;
- title;
- status;
- phase or depth;
- assigned runner or agent;
- touched files or expected files;
- risk level;
- cost and duration when available;
- progress;
- blocked reason.

Cards should avoid long prose. Details belong in the inspector.

## Inspector

Selecting a node should reveal:

- task contract;
- objective and definition of done;
- allowed paths;
- forbidden paths;
- dependencies;
- relevant symbols;
- static conflict signals;
- conflict evidence;
- scheduler decision;
- trace events;
- mock or real diff;
- validation results;
- scope validation;
- run snapshot metadata.

The inspector is the bridge between visual product demo and technical thesis evidence.

## Interaction Model

The product should support:

- generate DAG;
- approve plan;
- run next batch;
- run ready tasks;
- pause;
- reset;
- export snapshot;
- import snapshot;
- compare configs;
- open benchmark report;
- inspect conflicts and gate decisions;
- replay trace.

Early web phases can implement only the read-only and mock-backed subset:

- load report;
- load snapshot;
- render DAG;
- inspect node;
- simulate batch progress;
- export snapshot.

## Run canvas + lifecycle

`/runs/[runId]` es la ruta canónica de producto a partir de Fase B. El canvas se monta sobre el mismo `RunCanvasShell` que `/replay/demo`, pero:

- recibe un `RunCanvasSource = { kind: "persisted-run" }`;
- abre un `EventSource` a `/api/runs/:id/events` (SSE) y acumula `node.added` en un `Set<string>` que filtra el canvas durante `generating`;
- arriba del toolbar muestra un `RunHeader` con workspace, scenario, granularidad, modelo y un badge de status (tone semántico por status);
- entre el toolbar y el canvas inserta un `RunActionBar` contextual: `Pause`, `Resume`, `Approve plan`, `Run ready tasks` según `status`;
- omite el `MethodologyBanner` (que sigue activo en `/replay/demo`);
- cuando el status pasa a `needs_review` o más, el filtro de visibilidad se levanta y se muestra el DAG completo.

Status lifecycle en la card del nodo: `generating` y `running` activan el `coral-pulse`; `needs_review` y `approved` usan el palette de `ready` / `done`; `integrated` queda reservado para Fase C.

## Command Center surface

`/` is the entry point of the product as of Fase A. It mirrors the Claude Cowork layout:

- short serif headline + descriptive subtitle;
- workspace picker (combo + `manage →` link to `/workspaces`);
- model picker (cosmetic, flagged `preview`);
- 6-row prompt textarea with `⌘+↵` submit;
- 3-segment granularity control (baja/media/alta) with mode footnote and explainer copy;
- recent runs strip — 3 cards from a typed fixture; the first opens the existing `/replay/demo`;
- the Start button calls `buildReplayDemoUrl(...)` and navigates to the canvas with the selection encoded in the querystring.

Workspaces are managed at `/workspaces` (server component + client CRUD list with dialog). They persist in `.manyhands/workspaces.json`, validated with Zod and protected by an in-process mutex and atomic write. The repository hides the storage choice behind a `WorkspaceRepository` interface so SQLite (ADR 0007) can land later without touching the UI.

`/build` was retired; visits redirect to `/`.

## Current Implementation Status

The first DAG canvas iteration is live at `/replay/demo` (see `apps/web/README.md`). It is read-only, consumes real `RunSnapshot` artifacts from the deterministic mock flow, and follows the `warm technical` design language:

- graphite surfaces, coral accent for action and running, sage/amber/terracotta semantic states, cool steel ring for selection;
- Newsreader serif for titles, Inter for UI text, JetBrains Mono for ids, paths and counts;
- phase columns with depth labels and status-aware row ordering;
- filter chips (status, risk, kind, gate-required, text);
- tabbed inspector with Overview, Contract, Risks, Trace, Validation, Diff;
- minimap, controls, dimmed non-matching nodes.

What is intentionally not yet implemented: live mock execution UX (`Run ready tasks`), saved run replay by id, timeline/board views, and the conflict-predictor bottom sheet. See `web-app-roadmap.md` and `docs/adr/0014-dag-canvas-read-only.md`.

## Design Import Plan

The Claude Design DAG canvas should be imported or adapted progressively:

```txt
static design
  -> React components
  -> typed props
  -> API data
  -> live state
```

Guidelines:

- preserve the visual clarity of the generated DAG canvas;
- separate visual components from orchestration logic;
- make node and edge data typed from core artifacts;
- start read-only;
- connect live mock state only after static rendering is stable;
- avoid claiming that real agents or worktrees exist before they do.

Implementation handoff: see `docs/development/frontend-implementation-handoff.md` for the current `/api/demo/run-snapshot` endpoint, `RunSnapshot -> RunGraphViewModel` mapper and `/replay/demo` placeholder route.

## Data Sources

Near-term UI views should consume:

- `BenchmarkReport`;
- `EvaluationReport`;
- `RunSnapshot`;
- `TaskGraph`;
- `AgentTaskContract`;
- risk matrix and conflict evidence;
- trace events;
- mock runner results;
- scope validation results.

Future views can add:

- real worktree metadata;
- real diffs;
- command validation output;
- agent adapter output;
- bottom-up integration steps.
