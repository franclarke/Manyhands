# 0017 · LLM decomposer + editable control plane (Fase C — Sprint 1)

## Status

Accepted. Sprint 1 implemented. Sprint 2 (DAG editing + conflict bottom sheet + Lab compare + Timeline) tracked separately and not yet shipped.

## Context

Fase B delivered a real run lifecycle with deterministic mock planning. The Command Center accepted free-text prompts but the decomposer ignored them — the tree was driven exclusively by the `scenarioId` picker. For ManyHands to behave like an Agentic Development Environment (ADE) rather than a benchmark visualizer, the prompt must drive the plan.

Fase C — Sprint 1 closes that gap: the user writes a prompt, an LLM-driven decomposer produces a typed `DecompositionResult`, strict guards reject malformed output, and a deterministic fallback ensures the canvas never breaks. The lifecycle gains an `interrupted` status with heartbeat detection so orphaned runs are explicit and recoverable. Workspaces gain optional hints (`repoPath`, `packageManager`, `defaultBranch`, `allowedPaths`, `testCommand`, `buildCommand`) that the LLM consumes — they are not yet executed; that lands in Fase D.

## Decision

Sprint 1 ships eight aditive pieces:

1. **`TaskNodeSchema.metadata` optional field** in `packages/task-graph`. Aditivo y retro-compatible (existing snapshots parse unchanged; tests untouched). Carries `authoredBy: "ai" | "human"`, plus reserved keys for integrator nodes (`integrator`, `integratesTaskIds`) consumed in Sprint 2.
2. **`AnthropicDecomposer`** in `packages/decomposer/src/llm/`. Implements the existing `Decomposer` interface so it slots into `runMockPlanningFlow` without touching call sites. Public surface:
   - `prompt-template.ts` (versioned: `manyhands.decomposer-prompt.v1`);
   - `output-schema.ts` (Zod: nodes, dependencies, summary, assumptions, risks);
   - `guards.ts` (caps por granularidad, IDs únicos, exactly-one-root, depth consistency, leaf criteria, dependency cycles);
   - `normalize.ts` (LLM output → `DecompositionResult` con `TaskGraph` + `AgentTaskContract[]`);
   - `errors.ts` (`DecomposerLlmError`).
3. **`decomposer-policy.ts`** in `apps/web/src/lib`. Decides Anthropic vs deterministic based on env (`ANTHROPIC_API_KEY`, `MANYHANDS_FORCE_FALLBACK`) and caller hints (`forceFallback`). CI runs always with the fallback because no API key is set.
4. **Runner uses the policy** + persists telemetry. The planning pipeline catches *any* `DecomposerLlmError` (or generic error) and transparently switches to the deterministic fallback while recording `validationErrors` and `fallbackReason` in the new `RunRecord.decomposition` metadata field. The canvas never crashes.
5. **`RunRecord.decomposition`** captures `{ provider, model, promptTemplateVersion, rawResponse, parsedOutput, validationErrors, fallbackUsed, fallbackReason, generatedAt, usage }`. `RunResponse` exposes a sanitized subset to clients.
6. **`heartbeatAt` + `interrupted` status** in the lifecycle. The runner writes `heartbeatAt` every ~4s. A sweeper invoked from `GET /api/runs` and `GET /api/runs/:id` marks any `generating`/`running`/`paused` run with a stale heartbeat (>10min) as `interrupted` and emits a `status.changed` event. `RunActionBar` shows a primary **Restart** CTA for `interrupted` and `failed`. The new endpoint `POST /api/runs/:id/restart` re-kicks the planning pipeline (or the execution pipeline if the run was interrupted mid-`running` and `planning` already exists).
7. **Workspace shape enriched** with optional hints (`repoPath`, `packageManager`, `defaultBranch`, `allowedPaths`, `testCommand`, `buildCommand`). The form dialog exposes them under a collapsible "Workspace hints" section. The `decomposer-policy` forwards them to the LLM as `WorkspaceHints`. They are NOT yet used to execute anything.
8. **Command Center**: scenario picker collapsed into `Advanced ▸`. The prompt is the dominant input. The `RunHeader` shows a provider badge (`LLM · <model>` or `fallback · <reason>`). `RunStatusKey` extended with `interrupted` in both DTO and tone palette.

### Sprint 2 — explicitly out of scope here

DAG editing endpoints (rename / edit / regen subtree / mark manual), conflict bottom sheet, integrator node creation actions, Timeline view, Lab `/lab/compare`, runs filters UI, patch model consumers, and `RunRecord.patches[]` writes all land in Sprint 2. The schema reserves `patches: z.array(z.unknown()).default([])` so Sprint 2 doesn't bump the run file version.

## Consequences

Positive:

- the prompt finally drives the plan when a key is configured; ManyHands earns the ADE framing without taking on agent-execution risk;
- the LLM can never break the canvas — every failure path lands in the deterministic fallback with persistent telemetry;
- CI stays free of LLM costs (no key, no calls);
- orphaned runs become explicit (`interrupted`) and recoverable (`Restart`), eliminating silent limbo;
- workspaces hold the model fields that Fase D needs without committing to execution semantics;
- `TaskNodeSchema.metadata` becomes the home for Sprint 2 integrator metadata and future authorship tracking.

Negative / accepted:

- **LLM cost on runs**: each user-driven Start can spend tokens. Mitigation: `MANYHANDS_FORCE_FALLBACK=1` and the per-caller `forceFallback` knob;
- **Single-process bus** carries over from Fase B; multi-worker / SQLite migration deferred to Fase D;
- **No streaming from the LLM yet**: the canvas waits for the full LLM response before dispatching `node.added` events. Acceptable for Sprint 1 (LLM responses < 15s for current prompts);
- **`scenarioId` is now optional in `POST /api/runs`**: when missing, the server picks the first catalog scenario as the feature fixture seed (the LLM rewrites contents). Documented as a Sprint 1 limitation;
- **`RunRecord.heartbeatAt`** is best-effort; failures during heartbeat writes are swallowed and the sweeper acts as the safety net.

## Alternatives considered

- **Schema-breaking `TaskNodeKind = "integrator"`** instead of metadata. Rejected: would require migrating every existing snapshot and test fixture; Sprint 1 explicitly avoided this.
- **Streaming token-by-token from Anthropic**. Deferred: significant added complexity for marginal UX improvement at current prompt sizes.
- **`POST /api/runs/:id/restart` that bypasses the lifecycle**. Rejected: violates the state machine. The endpoint instead leaves the run in `interrupted` and lets the runner re-transition through `interrupted → generating` (or `interrupted → running` if planning already exists and the interrupt was during execution).

## Migration path to Sprint 2

1. Wire the `patches[]` field: add the `RunPatch` discriminated union (`patches.ts`), the per-action `editing.ts`, and the typed endpoints under `/api/runs/:id/nodes/:taskId/*`, `/api/runs/:id/integrator`, `/api/runs/:id/serialize`.
2. `RunCanvasShell` adds a `bottomSheetSlot` for the Conflict UX. The shell already shows `headerSlot`/`actionSlot`; this is an additive prop.
3. `applyPatches(snapshot, patches)` projects the live view-model.
4. `/lab/compare` reuses `pickDecomposer({ forceFallback: true })` so granularity comparisons run deterministically without LLM cost.

## References

- `packages/task-graph/src/index.ts` — `TaskNodeMetadataSchema`, `TaskNodeSchema.metadata`.
- `packages/decomposer/src/llm/` — full LLM decomposer.
- `apps/web/src/lib/decomposer-policy.ts` — provider decision.
- `apps/web/src/lib/server/runs/runner.ts` — pipeline with transparent fallback.
- `apps/web/src/lib/server/runs/interrupted.ts` — sweeper.
- `apps/web/src/app/api/runs/[id]/restart/route.ts` — Restart endpoint.
- `apps/web/src/app/(command-center)/_components/command-center-shell.client.tsx` — Advanced collapsible.
- `apps/web/src/app/runs/[runId]/_components/run-header.tsx` — provider badge.
- ADR 0016 (Fase B run lifecycle), ADR 0015 (workspaces + Command Center), ADR 0007 (JSON store before SQLite).
