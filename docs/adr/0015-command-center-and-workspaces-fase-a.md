# 0015 · Command Center landing and JSON-backed workspaces (Fase A)

> Historical note: this ADR records the transition away from benchmark-inspector
> UI. Mentions of `/replay/demo`, benchmark fixtures or experimental
> requirements are not current product guidance.

## Status

Accepted.

## Context

Up to ADR 0014 ManyHands presented itself as a benchmark inspector: `/` was an informational landing, `/build` was a disabled placeholder, and the polished surface lived at `/replay/demo` (read-only DAG canvas over deterministic `RunSnapshot` artifacts). The user stories drafted alongside this ADR re-center the product on a **Command Center**: a Claude Cowork–style entrypoint where a developer describes a task in natural language, picks a workspace, picks a granularity, and starts an orchestration run.

Fase A is the first installment of that shift. It must land without touching the deterministic core, without introducing live execution, and without committing to SQLite. Persistence of user-authored state (workspaces) starts here so that Fase B can layer real runs on top.

## Decision

Build the Command Center landing, `/workspaces` CRUD, granularity selector and a recent-runs preview rail as a purely additive layer in `apps/web/`.

Key choices:

1. **Granularity exposes 3 UI levels mapped to existing `DecompositionMode` literals.** `baja → coarse`, `media → balanced`, `alta → fine`. The mapping lives in a single module (`apps/web/src/lib/granularity.ts`) and is the only place that knows the Spanish ↔ core bijection. A fourth `ultraFine` level is reserved at the type level (used by the runs fixture) but not exposed in the selector; promoting it is deferred to Fase B together with the core schema change.
2. **Workspaces persist server-side in `.manyhands/workspaces.json`** with Zod validation and atomic writes (temp file + rename). Multi-process locking is explicitly out of scope; the repository keeps an in-process mutex (a Promise chain) and the deployment story is single-instance until Fase B introduces SQLite.
3. **`WorkspaceRepository` interface decouples storage from API.** Route handlers and server components depend on the interface. A future `SqliteWorkspaceRepository` only needs to satisfy the same contract; the UI does not change.
4. **Recent runs are a typed fixture, not hardcoded JSX.** `apps/web/src/lib/fixtures/recent-runs.ts` exports a `RecentRunPreview[]` matching the future domain shape. `GET /api/runs` serves the fixture. Fase B will swap this server-side without touching the client.
5. **Submit (Start) in Fase A navigates to the existing `/replay/demo` canvas** via `lib/replay-url.ts`. The URL contract carries `workspace`, `granularity`, `model` for traceability — the canvas ignores them today but they are guaranteed-stable for Fase B. The prompt itself is persisted in `sessionStorage` (`manyhands:lastPrompt`) for the same reason.
6. **`/build` becomes a server redirect to `/`.** The nav removes "Build" and adds "Workspaces". Visual language continues with the warm-technical palette established in ADR 0014.
7. **Tests cover the contract surfaces, not the components.** Five new Vitest suites at the repo root (`workspace-repository`, `workspace-schema`, `workspace-slug`, `granularity-mapping`, `replay-url`) exercise the layers Fase B will depend on.

## What is explicitly out of scope

- `POST /api/runs` and any real run persistence (Fase B).
- Live mock execution UX / SSE / WebSockets.
- SQLite or multi-process safe locking.
- Workspace-level configuration (repo path, branch, command list) — workspaces in Fase A hold name/slug/description/color only. Richer config lands in Fase B together with run wiring.
- Model selector wired to real adapters; the picker is cosmetic and flagged `preview`.
- Auto-detection of workspaces from the host filesystem.

## Consequences

Positive:

- the product opens with a strong product narrative — input + workspace + granularity — without depending on any core work;
- the `WorkspaceRepository` interface and `RecentRunPreview` DTO make Fase B's storage migration a server-only refactor;
- granularity is captured as a tracked variable from day one, satisfying the experimental requirement of the thesis;
- the existing canvas at `/replay/demo` remains untouched and continues to render regression-free.

Negative / accepted:

- single-process lock only; multi-worker deployments race on the JSON file. Documented as a Fase B mitigation.
- the prompt is dropped on submit (the URL goes to a deterministic canvas). Surfaced in the UI copy ("fase A · prompt opens deterministic demo").
- model selection is cosmetic and could mislead. The picker carries a `preview` badge.
- workspaces store only metadata; running a benchmark from Lab doesn't yet associate to a workspace. Fase B will join the two domains explicitly.

## Alternatives considered

- **`localStorage` persistence** for workspaces. Rejected: not server-renderable, fragile across browsers, no Server Action path. The user explicitly required server-side persistence.
- **In-memory seed only** (no JSON file). Rejected: cannot model CRUD honestly and would force a UI rewrite when persistence lands.
- **SQLite now** (ADR 0007). Rejected for Fase A: introduces tooling weight not justified by the data model and not required by any other surface in this phase.
- **Add `maximum/ultraFine` to `DecompositionMode` now.** Rejected: schema-breaking, with ripple effects through `@manyhands/decomposer`, `@manyhands/evaluator`, benchmark manifests and existing run snapshots. Deferred until there is a concrete decomposer template behind it.

## Migration path to Fase B

1. Replace `JsonWorkspaceRepository` with `SqliteWorkspaceRepository` honoring the same interface. Provide a one-off migration script that imports `.manyhands/workspaces.json`.
2. Introduce `POST /api/runs` writing to the run store. Replace `getRecentRunsPreview()` with a server-side adapter that projects `RecentRunPreview` from real persisted runs; keep the DTO untouched.
3. Wire the prompt to the new endpoint and surface live decomposition events on the canvas; remove the `sessionStorage` workaround.
4. Promote the model picker behind a feature flag once at least one real provider adapter exists.
5. Re-introduce a fourth granularity level once `@manyhands/decomposer` has a template for it.

## References

- `apps/web/src/app/page.tsx`
- `apps/web/src/app/(command-center)/_components/*`
- `apps/web/src/app/workspaces/`
- `apps/web/src/app/api/workspaces/` and `apps/web/src/app/api/runs/`
- `apps/web/src/lib/server/workspaces/`
- `apps/web/src/lib/granularity.ts`
- `apps/web/src/lib/replay-url.ts`
- `apps/web/src/lib/fixtures/recent-runs.ts`
- `docs/development/web-app-roadmap.md`
- ADR 0014 (DAG canvas read-only)
- ADR 0007 (JSON run store before SQLite)
