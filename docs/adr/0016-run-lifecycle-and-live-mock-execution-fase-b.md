# 0016 · Run lifecycle and live mock execution (Fase B)

## Status

Accepted.

## Context

Hasta ADR 0015 ManyHands tenía un Command Center funcional (`/`) y persistencia de workspaces, pero el botón Start del prompt redirigía al canvas determinístico (`/replay/demo`) sin crear ningún run real. Los recent runs eran un fixture tipado.

Fase B introduce el primer **lifecycle real de runs**: cada Start crea un `RunRecord` persistido, dispara una pipeline de planning sobre un scenario determinístico, stream-ea la generación de nodos al canvas vía SSE, espera aprobación humana del plan, y recién entonces dispara la ejecución mock. La home muestra los runs reales persistidos.

El núcleo (`packages/*`) no se modifica: `runMockPlanningFlow` y `runMockExecutionFlow` se llaman tal cual y sus traceEvents alimentan la generación viva.

## Decision

Construir cuatro piezas aditivas sobre `apps/web/`:

1. **`RunRecord` + `JsonRunRecordStore`** — modelo de dominio Fase B (status lifecycle + scenario + userPrompt + planning + execution) detrás del interface `RunRepository` (espejo de `WorkspaceRepository`). Persistencia en `.manyhands/runs/<runId>.json` con Zod + atomic write + per-run mutex.
2. **In-process event bus + RunRunner** — `RunEventBus` mantiene historial in-memory por runId. `RunRunner` ejecuta `runMockPlanningFlow` (o `runMockExecutionFlow`) y dispatch-ea `node.added`/`edge.added`/`risk.added`/`agent.run.*` con latencia simulada. Cada transición de status actualiza el `RunRecord` en disco.
3. **API REST + SSE** — `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/events` (SSE replay + tail), `POST /api/runs/:id/{approve-plan,run,pause,resume}`. Errores tipados: `RunNotFoundError`→404, `RunValidationError`→400, `RunLifecycleError`→409.
4. **Canvas compartido** — `RunCanvasShell` consume un `RunCanvasSource = { kind: "persisted-run" } | { kind: "deterministic-replay" }`. `/runs/[runId]` (producto) y `/replay/demo` (lab) ambos lo montan. `DagWorkspace` aceptó dos slots opcionales (`headerSlot`, `actionSlot`) y un flag `showMethodologyBanner` para diferenciar contextos sin duplicar el canvas.

### Decisiones de UX bloqueadas en clarifying questions

- **Prompt + scenario picker**: el Command Center suma un dropdown `Scenario` arriba del prompt. El prompt es texto libre, se guarda como `userPrompt` (title/objetivo del run). El árbol se genera por `scenarioId` + `granularity`. Microcopy honesta visible en el RunHeader.
- **Rutas**: `/runs/[runId]` es canónica para producto. `/replay/demo` se conserva para Lab. El canvas se comparte vía `RunCanvasShell`.
- **Recent runs**: `GET /api/runs` lee de `JsonRunRecordStore`. Sin fallback al fixture (eliminado). Empty state honesto si no hay runs.
- **Gate manual**: `generating → needs_review → approved → running → completed`. `Run` solo se habilita después de `Approve plan`. `Pause` aplica a la generación/ejecución, no reemplaza el gate.

### Lifecycle enforced en `lib/server/runs/lifecycle.ts`

```
created → generating → needs_review → approved → running → completed | failed
                ↓                                    ↓
              paused ←──────── pause ─────────── paused
                ↓                                    ↓
              (any) ──── resume ─→ generating | running
```

Transiciones ilegales lanzan `RunLifecycleError` y el endpoint responde 409.

## Out of scope

- LLM real / agentes reales / worktrees git reales / SQLite / WebSockets.
- Schema changes en `packages/*` (RunSnapshot, DecompositionMode, TaskGraph quedan intactos).
- Edición del DAG, integrator nodes, conflict resolver UX.
- Cuarta granularidad (`ultraFine`).
- Auto-restart de runs huérfanos al reiniciar el server.

## Consequences

Positive:

- la home pasa a ser un producto real con lifecycle visible y persistido.
- el canvas se comparte entre producto (`/runs/[runId]`) y laboratorio (`/replay/demo`) sin duplicación.
- el `RunRepository` interface y el shape `RunPreview` aíslan a la UI de la storage choice; Fase C puede swappear a SQLite sin tocar el frontend.
- planning y execution se mantienen separados, lo cual permite registrar la granularidad como variable experimental de tesis con un gate humano antes de ejecutar.

Negative / accepted:

- **SSE in Next dev**: HMR puede cortar el stream durante rebuilds. Acceptable para dev.
- **Bus in-process**: deploys multi-worker no comparten estado. Mitigación: Fase C (SQLite + Postgres LISTEN/NOTIFY o Redis).
- **Runner muere si el server se reinicia**: si una pipeline está a la mitad, el `RunRecord` queda en `generating`/`running` sin owner. El usuario puede `POST /api/runs/:id/run` si está `approved`, o el run quedará en estado intermedio hasta una futura acción `Restart`.
- **`MockPlanningFlowResult` / `MockExecutionFlowResult` se persisten como `z.unknown()`**: la web no re-valida la shape interna del core para no acoplarse al schema. Tradeoff documentado.
- **El prompt sigue siendo decorativo** a nivel core. Microcopy honesta en RunHeader: *"el escenario seleccionado determina el plan determinístico. Tu prompt queda guardado como objetivo del run."*

## Alternatives considered

- **Persistir el RunRecord como `RunSnapshot` desde el inicio** (reusar `JsonRunStore` del core). Rechazado: el RunSnapshot del core es el artefacto final canónico, no maneja status lifecycle ni metadata Fase B (scenarioId, userPrompt, gate). Mantener stores separados es más limpio; Fase C los unificará detrás de un único interface SQLite.
- **WebSockets en lugar de SSE**. Rechazado: SSE es suficiente (server→client only), no requiere dependencias extra y Next.js lo soporta nativamente vía ReadableStream.
- **Re-correr planning en cada `POST /api/runs/:id/run`** (sin caché). Rechazado: redundante, además `runMockExecutionFlow` ya corre planning internamente; persistimos el resultado para que el canvas no se "rebuild-ee".
- **Auto-flow** (sin gate manual). Rechazado por decisión de producto: el valor del gate humano está en que el usuario puede inspeccionar y aprobar el plan antes de delegar trabajo, alineado con la idea de human-in-the-loop.
- **Streaming a cada cliente desde el runner directamente** (sin event bus). Rechazado: el bus permite múltiples subscribers, replay desde history para reconexiones, y separa el ciclo de vida del runner del de la conexión SSE.

## Migration path to Fase C

1. Reemplazar `JsonRunRecordStore` con `SqliteRunRecordStore` honrando la misma interface. Migrar `.manyhands/runs/*.json` con un script one-off.
2. Introducir un LLM-driven decomposer detrás de un feature flag; promover el `userPrompt` de decorativo a entrada real del decomposer.
3. Integrar real worktrees / real agent adapters para reemplazar `MockWorktreeRunner`.
4. Habilitar edición del DAG (split / merge / regenerate subtree) y el concepto de `integrator` node.
5. Surface conflicts UX más rica (bottom sheet con matriz task×task).

## References

- `apps/web/src/app/runs/[runId]/page.tsx`
- `apps/web/src/app/api/runs/`
- `apps/web/src/lib/server/runs/`
- `apps/web/src/components/dag/RunCanvasShell.tsx`
- `apps/web/src/lib/scenarios.ts`
- `apps/web/src/lib/live-graph.ts`
- ADR 0015 (Command Center y workspaces)
- ADR 0014 (DAG canvas read-only)
- ADR 0007 (JSON run store before SQLite)
