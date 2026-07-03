# 0014 · Read-only DAG canvas on `@xyflow/react`

> Current note (June 2026): this ADR is historical. The `/replay/demo`, `/lab/benchmarks`, `MethodologyBanner`, `mock-v0` and `conflict-v0` flow it describes was removed with the old Lab/benchmark direction.

## Status

Accepted.

## Context

The deterministic core (`@manyhands/core`, `@manyhands/evaluator` and friends) already produces `RunSnapshot` artifacts that contain a `TaskGraph`, `AgentTaskContract`s, risk predictions, static signals, trace events and (when applicable) mock execution and validation results. Phase 10 added a Next.js web app with API routes, a `RunSnapshot -> RunGraphViewModel` mapper and a placeholder `/replay/demo` page.

The next product-defining step is a visual DAG canvas. We need to decide how to render it without overcommitting to features that will not exist for several phases (live execution, real worktrees, real agents, persisted runs).

## Decision

We build the first DAG canvas as a **read-only React component tree backed by `@xyflow/react`**, mounted at `/replay/demo`. Real data comes from the existing deterministic mock flow.

Key choices:

1. **Library: `@xyflow/react`.** It is the actively maintained successor of React Flow, has good TypeScript support, a small surface for the read-only case (`ReactFlow`, `MiniMap`, `Controls`, `Background`, custom node types) and zero hard dependencies on a layout engine.
2. **Read-only first.** No dragging, no editing, no live mutations. The canvas is a viewer over a frozen `RunSnapshot`. Filtering, selection and inspector tabs are the only interactive surfaces.
3. **Data source: `RunSnapshot`.** The page calls the existing server helper `getDemoRunSnapshot()` (the same one that powers `GET /api/demo/run-snapshot`) at request time and maps it through `toRunGraphViewModel`. No new persistence or storage is introduced.
4. **Mapper between core and UI.** All snapshot → view-model translation lives in `apps/web/src/lib/graph-view-model.ts`. Components consume `GraphNodeView`, `GraphEdgeView`, `RunGraphViewModel` and `InspectorView` — never `RunSnapshot` directly. This keeps the canvas decoupled from schema changes and easy to test.
5. **Layout: manual depth-based phase columns.** A small helper in `apps/web/src/lib/dag-layout.ts` sorts each depth column by `(parentId, status, id)` and emits column headers as ghost nodes. We considered dagre / elkjs and rejected them for this phase to avoid an extra layout pipeline and animation jank; the current fixtures (B0–B4 across `mock-v0` and `conflict-v0`) read clearly without it.
6. **Visual language: `warm technical`.** Graphite surfaces, coral accent for action / running, sage / amber / terracotta semantic states, cool steel ring for the selected node. Newsreader serif for titles, Inter for UI, JetBrains Mono for ids and paths. The palette is loaded from `apps/web/src/app/globals.css` and includes a `.light` scope so a light variant can be enabled later without a rewrite.
7. **Methodology stays visible.** A `MethodologyBanner` sits above the toolbar on the canvas page, and every benchmark report row in `/lab/benchmarks` is paired with an `Open canvas →` link. Users see Lab Mode disclaimers wherever they see a graph.

## What is explicitly out of scope

- live mock execution UX (`Run ready tasks` is rendered disabled);
- WebSockets, streaming or any push transport;
- SQLite or persisted run storage;
- real git worktrees or real agent adapters;
- bottom-up integration / merge sequencing UX;
- graph editing (drag-to-rewire, rename, regen);
- authentication, billing, provider config;
- timeline view, board view and conflict predictor bottom sheet from the Claude Design bundle (deferred to later phases).

## Consequences

Positive:

- the canvas can be built and shipped without changing any core schema;
- because all data crosses through the mapper, the canvas is unit-testable against synthetic `RunSnapshot`s (see `tests/graph-view-model.test.ts`);
- the inspector, filter chips and selection model already match the shapes the future Build/Lab modes will need;
- Lab → Replay flow is end-to-end clickable, which is what the thesis defense needs.

Negative / accepted:

- manual layout will eventually require dagre or elkjs for larger graphs;
- the `RunSnapshot` is re-generated server-side on every request — fine for the deterministic mock flow, but not appropriate once runs are persisted (Phase 5+);
- the design includes screens (Plan, Merge Sequencer, Timeline, Board, Conflict Predictor) that this canvas does not yet implement — they are tracked in `web-app-roadmap.md` and the `ui-vision.md` import plan.

## References

- `apps/web/src/app/replay/demo/page.tsx`
- `apps/web/src/components/dag/*`
- `apps/web/src/lib/graph-view-model.ts`
- `apps/web/src/lib/graph-filters.ts`
- `apps/web/src/lib/dag-layout.ts`
- `docs/development/ui-vision.md`
- `docs/development/web-app-roadmap.md`
- `docs/development/frontend-implementation-handoff.md`
