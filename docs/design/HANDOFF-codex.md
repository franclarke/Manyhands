# HANDOFF — Finalizar el rediseño agent-first (para Codex 5.5)

> **Propósito.** Sos el agente que termina el rediseño agent-first de ManyHands. Este documento es **autocontenido**: con él (más el repo) podés implementar **todo lo que falta** sin contexto previo. Está escrito el 2026-06-06 tras cerrar PR-N1, U-A y U-B.
>
> **Cómo usarlo:** leé las secciones 0–4 una vez (reglas + estado + arquitectura), después tomá las unidades pendientes de la §5 **en orden** (`G-1 → G-2 → cierres backend → doc-drift`). Cada unidad trae objetivo, archivos, enfoque, gotchas, verificación, aceptación y rollback. No reimplementes lo ya hecho.
>
> **Idioma:** Francisco trabaja en español; comunicá en español. Comentarios de código en inglés (seguí el estilo del repo).

---

## 0. Reglas innegociables (NO renegociar)

1. **Decisiones D1–D10 cerradas** — ver [`CLAUDE.md`](../../CLAUDE.md) y [`docs/DECISIONS.md`](../DECISIONS.md). Las que más te tocan:
   - **D3:** si el LLM falla → el run **falla con error accionable**. Sin fallback silencioso.
   - **D4:** **Gemini CLI** es el único executor de planning; ejecución/repair vía registry (ADR-0030, Claude Code CLI opt-in). No agregar executors ni cambiar el default.
   - **D5:** `git diff HEAD` es la verdad, no el stdout del agente.
   - **D6:** el orquestador commitea; el agente nunca.
2. **El modelo operativo está CONGELADO** — [`docs/design/run-operative-model.md`](run-operative-model.md) (refinamientos A–P). Podés **extenderlo de forma aditiva** (nuevos `type` de evento forward-compat, como hicimos con `plan.node.status` y `run.metrics.ready`), pero **no** cambiar las entidades/invariantes congelados.
3. **Estado de nodo SIEMPRE derivado** — el reducer guarda entidades; fase/salud/freshness/display salen de **selectores**. Nunca setees estado de nodo imperativamente. `nodeStatusOverrides` (legacy) está **prohibido para código nuevo** y hay que **eliminarlo** en G-1.
4. **Fixture-first / no big-bang** — el carril autónomo se valida con fixtures golden (`RunEvent[]`), sin backend. El run real se conecta al final, **detrás de flag de rollback**.
5. **Invariantes que no se rompen** (testeados en `tests/run-model-invariants.test.ts`): stale ≠ failed; stale ≠ done (`integrated + stale` → `obsolete`); repair/retry automático **no** es atención humana (no va al canal de decisiones); una sola fuente de verdad; foco/timeline no pausan ni mutan el modelo.
6. **`exactOptionalPropertyTypes: true`** — no asignes `undefined` explícito a una prop opcional `x?: T`. Usá spread condicional `...(v !== undefined ? { x: v } : {})` **o** declará `x?: T | undefined`. (Es el error de tipos más común acá.)
7. **La suite debe quedar verde siempre.** Comandos de verificación (§4).
8. **Commits:** solo cuando esté verde; stageá **solo** los archivos de tu unidad (no mezcles con trabajo paralelo); terminá el mensaje con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (o tu firma equivalente). En Windows: para mensajes multilínea usá `git commit -F -` con here-doc bash (`<<'EOF' … EOF`), **no** el here-string PowerShell `@'…'@` dentro de la tool Bash.

---

## 1. Qué es ManyHands (mínimo indispensable)

Orquestador de agentes LLM: toma una feature en lenguaje natural → la descompone en un DAG jerárquico con costuras de interfaz (`sharedInterface`) → ejecuta las hojas en git worktrees aislados con Gemini CLI → integra bottom-up con cherry-pick + repair semántico → expone todo en una web app (Next.js App Router). Tesis de Ing. en Sistemas (la métrica central es el `GranularityVector`).

- Narrativa: [`docs/thesis/project-evolution.md`](../thesis/project-evolution.md). Componentes: [`docs/system/`](../system/). Diseño agent-first (fuente de verdad de la UI/orquestación): [`docs/design/`](README.md).
- **El rediseño agent-first** reemplaza la UI plan-céntrica legacy (canvas/board/timeline pares + `nodeStatusOverrides` + consola CLI cruda) por: **event log → reducer puro → selectores → view-models → componentes presentacionales**. Vive en `apps/web/src/lib/run-model/` y `apps/web/src/components/run-model/`.

---

## 2. Estado actual (qué YA está hecho)

**Commits recientes (rama `main`, NO pusheada — `main` está ~7 commits adelante de `origin/main`):**

| SHA | Qué |
|---|---|
| `5228a7e` | U-B — inspector & audit depth (timeline / audit-trail) |
| `71f0341` | U-A — reconciliation & disposition depth (granularity metrics + integration progress) |
| `eca20d0` | PR-N1 — planning observability + faithful SSE bridge |
| `713a1e0` | (logging execution-core, trabajo previo — no del rediseño) |
| `c64cc23` | PR11 — adapter SSE→RunEvent (mitad aditiva) |
| `67d1fa6` | PR-U1 — fixture-first control room (foco polimórfico + evidencia) |

**Suite:** `pnpm test` → **803 passing + 3 skipped**. Capa run-model: ~340 tests en 13 archivos `tests/run-model-*.test.ts`.

**Estado vivo y detallado:** [`docs/design/implementation-status.md`](implementation-status.md) — leelo. Tiene §0c (PR-N1), §0d (roadmap Ultracode + U-A + U-B), §0/§0b (PR-U1/PR11), matriz PR01–14, hallazgos y riesgos. **El roadmap reorganizado por carriles (autónomo vs gated) está en §0d** — es el plan que estás ejecutando.

**Lo que el rediseño ya cubre (fixture-first, todo verde):**
- Tipos del modelo (`run-model/types.ts`): envelope `RunEvent` (seq/at/runId/actor/type/payload), entidades (Node/Seam/Wave/Decision/Conflict/Amendment/Evidence), `ExecutionState` (sin `stale`), payloads v1 + extensiones `plan.node.status` (PR-N1) y `run.metrics.ready` (U-A).
- Reducer puro (`reducer.ts`), store (`store.ts`), selectores (`selectors.ts`), fixtures golden (`fixtures/` — 7), playback (`use-fixture-playback.ts`).
- View-models: `workspace-view.ts` (superficie phase-adaptive + NodeVital + integración + métricas), `decision-channel-view.ts`, `focus-view.ts` (foco polimórfico node/seam/conflict/decision/evidence + planning + metrics), `proto-view.ts`, `timeline-view.ts` (audit-trail).
- Componentes presentacionales (`components/run-model/`): `workspace-surface.tsx`, `decision-channel.tsx`, `focus-panel.tsx`, `timeline.tsx`, `run-frame.tsx`, `proto-debug-panel.tsx`, orquestados por `proto-run-view.client.tsx`.
- **Adapter SSE→RunEvent** (`sse-adapter.ts`): `adaptStreamEvent` / `adaptStreamHistory` mapean el stream **legacy** (`server/runs/events.ts`, aliased `StreamEvent`) al envelope nuevo. **Fiel a planning health** (PR-N1).
- Ruta de demo: `/runs/proto/[fixture]` (fixture-first, deep-link `?focus=<kind>:<id>`).

**Arquitectura de datos (mantené esta cadena):**
```
RunEvent[] (fixtures o adapter sobre SSE legacy)
   → reduceRunEvents → RunModel (entidades normalizadas, cursor)
   → selectores (select*) → view-models (*-view.ts) → componentes presentacionales
   timeline-view.ts es la excepción: proyecta el RunEvent[] CRUDO (el log ES el audit-trail)
```

---

## 3. El roadmap que estás terminando (carriles)

Ver §0d de [`implementation-status.md`](implementation-status.md). Resumen:

- **Carril autónomo (fixture-first, verificación cerrada por tests)** — ✅ **COMPLETO**: PR-N1, U-A, U-B.
- **Carril gated (toca run real / backend; verificación necesita run Gemini + browser)** — ⏳ **PENDIENTE**: G-1, G-2.
- **Cierres dependientes de backend** (inspector real, composer visibility) — ⏳ pendientes, parte de G-2.
- **Doc-drift** — ⏳ pendiente (trivial).
- **Pospuesto (NO hacer sin decisión de Francisco):** N8 E2E reproducible / matriz de tesis B0–B4 (la tesis está en standby; ver banner en `CLAUDE.md`).

---

## 4. Verificación (gate de salida de cada unidad)

```bash
pnpm web:typecheck                          # tsc del web (corre build:packages primero). DEBE dar 0 errores.
pnpm -F @manyhands/execution-core typecheck # si tocás execution-core
pnpm test                                   # suite completa. DEBE quedar verde (803+ passing, 3 skipped).
pnpm vitest run tests/<archivo>.test.ts     # iterar rápido sobre tu test
pnpm web:dev                                # localhost:3000 — para verificación manual de G-1 (browser)
```

Tests del rediseño = entorno **node**, sin jsdom/RTL: testeás los **view-models/selectores puros**, no el DOM. Los `.tsx` son render fino verificado por typecheck. (Para G-1 sí necesitás browser real — ver esa unidad.)

**Gotchas conocidos:**
- No corras `pnpm test`/`typecheck`/`build` mientras `web:dev` está corriendo (race de `tsup --clean` → errores transitorios en `dist/` + overlay pegado de Next).
- Disco lleno rompe builds; si pasa, borrá `apps/web/.next` (~600MB).
- Warnings `LF will be replaced by CRLF` al `git add` en Windows = cosméticos, ignoralos.
- Agregar un fixture golden (8°) obliga a actualizar la aserción exacta en `tests/run-model-fixtures.test.ts` ("exports the seven…") y el `Record` exhaustivo `DESCRIPTIONS` en `apps/web/src/app/runs/proto/page.tsx`.

---

## 5. Unidades pendientes (implementá en este orden)

### G-1 — Rewire gated del run real `gated-risky` · `core-refactor`

**Objetivo.** Hacer que la página del run real (`/runs/[runId]`) renderice a través del **modelo nuevo** (runStore + reducer + selectores + adapter + componentes de `components/run-model/`) en vez del legacy `useLiveRun` + `nodeStatusOverrides`, **detrás de un flag** que permite volver al legacy (rollback).

**Problema que resuelve.** Hoy el run real usa una reducción ad-hoc dentro de `useLiveRun` (en `RunCanvasShell`) que setea `nodeStatusOverrides` (segunda fuente de verdad, 3 colores imperativos). El rediseño ya tiene todo para renderizar mejor; falta enchufarlo.

**Archivos probables.**
- `apps/web/src/components/dag/RunCanvasShell.tsx` (contiene `useLiveRun`, la reducción ad-hoc y `nodeStatusOverrides`).
- `apps/web/src/app/runs/[runId]/page.tsx` (página del run real).
- `apps/web/src/app/api/runs/[id]/events/route.ts` (transporte SSE — **no** lo reemplaces, solo lo consumís).
- Nuevo: un hook `apps/web/src/components/run-model/use-live-run-model.ts` (análogo a `use-fixture-playback.ts` pero alimentado por SSE).
- Reusá tal cual: `WorkspaceSurface`, `DecisionChannel`, `RunFrame`, `FocusPanel`, `Timeline`, `selectWorkspaceView`, `buildDecisionChannelView`, `buildFocusView`, `buildTimelineView`.

**Enfoque recomendado.**
1. **Flag.** `MANYHANDS_RUN_MODEL` (env público `NEXT_PUBLIC_MANYHANDS_RUN_MODEL=1`) **o** query param `?model=new`. Default OFF (legacy intacto = rollback).
2. **Hook live.** `use-live-run-model.ts`: abre `EventSource` a `/api/runs/[id]/events`, acumula el historial **legacy** (`StreamEvent[]`) que llega, y en cada tick recomputa el modelo:
   ```ts
   const envelope = adaptStreamHistory(legacyHistorySoFar, runId);
   const model = reduceRunEvents(createInitialRunModel(seed), envelope);
   ```
   **GOTCHA crítico de `seq`:** `adaptStreamEvent` es por-evento sin `seq`; `adaptStreamHistory` asigna `seq` 1-based sobre **toda** la salida. El mapeo **no es 1:1** (`planning.node.completed` se abre en N). Por eso **NO** mantengas un seq incremental por-evento a mano. **Recomputá `adaptStreamHistory(historiaCompleta)` y `reduceRunEvents(initial, …)` desde cero en cada tick** — es determinista (mismos seq estables) y barato a esta escala. (Si querés optimizar luego, el reducer es idempotente por `seq`, pero re-feed parcial es frágil porque los seq se recalculan; quedate con el recompute completo para v1.)
3. **Seed del `Run`.** `createInitialRunModel({ id: runId, intent, workspaceId, config })` — sacá `intent/workspaceId/config` del `RunRecord` (server). El adapter ya emite `plan.*`/`node.*`/`decision.*`; identidad/config viene del record, no del log.
4. **Render.** Cuando el flag está ON, montá `proto-run-view`-like: `RunFrame` + `DecisionChannel` + `WorkspaceSurface` + `Timeline` + `FocusPanel`, todo desde los selectores/view-models. Cuando está OFF, el `RunCanvasShell` legacy queda igual.
5. **Decisiones reales.** El canal de decisiones en fixtures resuelve avanzando el fixture. En el run real, resolver un gate debe pegarle a los endpoints existentes (approve-plan / answer / node review). Para G-1 podés **dejar la resolución conectada a los endpoints legacy directamente** (sin facade); el "Decision facade" unificado (`/api/runs/[id]/decisions/[decisionId]`) es un nice-to-have que podés diferir o incluir.
6. **Eliminar `nodeStatusOverrides`** en el path nuevo (no en el legacy todavía). El objetivo final es borrarlo; en G-1 dejá el legacy como rollback y el nuevo sin overrides.

**Tests.** Regresión pura (sin browser): tomá un historial legacy realista (podés grabar uno o construirlo como `StreamEvent[]`) → `adaptStreamHistory` → `reduceRunEvents` → asertá que los selectores producen el estado esperado (nodos running/done/failed, gates, planning health). Esto YA está parcialmente cubierto en `tests/run-model-sse-adapter.test.ts` y `tests/run-model-planning-health.test.ts` — ampliá si hace falta.

**Verificación manual OBLIGATORIA (esto NO lo cubren los tests).** El valor real —renderizar un run vivo— solo se prueba con un **run Gemini real + browser**:
- `pnpm web:dev`, crear un run real (necesitás `gemini` en PATH o `MANYHANDS_GEMINI_BIN`), aprobar el plan, y verificar con el flag ON que la superficie nueva renderiza el run de punta a punta (planning → ejecución → integración → evidencia) y que con el flag OFF el legacy sigue intacto.
- Usá las tools `preview_*` (NO "Claude in Chrome") para levantar el dev server y verificar: `preview_start`, `preview_snapshot`, `preview_console_logs`, `preview_screenshot`.

**Aceptación.** Con flag ON, un run real renderiza vía selectores (cero `nodeStatusOverrides` en el path nuevo); con flag OFF, paridad legacy intacta; suite verde; typecheck limpio.

**Rollback.** Flag OFF = legacy. Revertir el commit si hace falta.

**Riesgos.** Romper el run real (por eso el flag); drift de `seq` (por eso recompute completo); SSE reconnection/heartbeats (el stream legacy emite `heartbeat` y `replay.*` — el adapter ya los descarta).

---

### G-2 — Emisión nativa del envelope + rename legacy `gated-risky` · `core-refactor`

**Objetivo.** Reducir la dependencia del adapter lossy: (a) renombrar el tipo legacy `RunEvent` → `StreamEvent` en el backend para matar la colisión de nombres; (b) que el runner emita el **envelope nuevo** para lo que el motor ya produce; (c) abrir la puerta a eventos nativos más ricos (grounding/seam/verify-iteration/integration/conflict/amendment) a medida que el motor los soporte.

**Problema que resuelve.** Hoy conviven **dos modelos de evento**: el legacy `RunEvent` (unión por `kind`, plano) en `server/runs/events.ts` y el envelope nuevo `RunEvent` (`run-model/types.ts`). El adapter puentea pero **pierde fidelidad** (el stream legacy es planning + ejecución gruesa; no emite seams/scope/waves/verify-loop/conflicts/amendments nativos).

**Archivos probables.**
- `apps/web/src/lib/server/runs/events.ts` — rename del tipo `RunEvent` → `StreamEvent` (mecánico; los tests atrapan rupturas). ~5 consumidores: `events.ts`, `event-bus.ts`, `index.ts`, `runner.ts`, `app/api/runs/[id]/events/route.ts`.
- `apps/web/src/lib/server/runs/runner.ts` — donde se emiten los eventos del run (planning vía `onStepStatus/onStepCompleted`, ejecución, integración). Acá emitís el envelope nativo o un punto de mapeo único.
- Motor: `packages/execution-core/src/run/executor.ts`, `packages/execution-core/src/integration/agent.ts` (TraceEvents → eventos del envelope; ojo, **no rompas** los TraceEvents existentes que alimentan otras cosas).

**Enfoque.**
1. **Rename primero** (`RunEvent` legacy → `StreamEvent`), commit aislado, suite verde. El adapter ya importa `import type { RunEvent as StreamEvent }` — quedará consistente.
2. **Punto de emisión único.** Decidí si el runner emite envelope directo o si el adapter sigue siendo el único traductor. Recomendado para v1: **mantené el adapter** como traductor y enriquecé el **stream legacy** con los datos que el motor ya tiene pero no emite (p.ej. `validation.completed` ya existe; agregá lo que falte para que el adapter pueda mapear más). Emisión 100% nativa del envelope es v2.
3. **Eventos ricos = trabajo de motor.** `grounding.*`, `seam.frozen`, `node.verify.iteration`, `amendment.*`, `conflict.detected/resolved` nativos requieren que `execution-core` los produzca. Hoy el motor emite TraceEvents (`agent_started`, `cherry_pick_conflict`, etc.). Mapealos a eventos del envelope donde haya correspondencia; lo que no exista, **degradá** (el modelo nuevo ya tolera ausencias). No inventes datos que el motor no produce (violaría D5/honestidad).

**Tests.** Contrato de emisión: para cada señal del motor (o del runner), el evento del envelope resultante es el esperado. Rename: la suite entera atrapa rupturas.

**Verificación.** Tests + un run real (igual que G-1).

**Aceptación.** Colisión de nombres eliminada; el run real (con flag de G-1) muestra más fidelidad (idealmente conflictos/integración nativos); suite verde.

**Rollback.** El rename es mecánico/reversible; la emisión nativa va detrás del mismo flag de G-1.

---

### Cierres dependientes de backend (parte de / después de G-2)

Estos cierran la profundidad que el carril autónomo dejó "por ref" porque necesitan backend:

- **Inspector real de nodo.** El foco de nodo (`focus-view.ts` / `focus-panel.tsx`) ya muestra scope, planning, vital, y refs `diff://…` / `log://…` con `available:false`. **Falta:** (a) **contrato** (objective / acceptance criteria / validationCommands) — vive en `AgentTaskContract` (`packages/contracts`), exponerlo vía endpoint o incluirlo en el adapter/seed; (b) **diff / stdout-stderr tail reales** — endpoints `GET /api/runs/[id]/nodes/[nodeId]/diff` y `.../log` que el panel resuelve on-demand (cambiar `available:false` → fetch real). Recordá D5: el diff viene de `git diff HEAD`, persistido en el `RunRecord`/result, no del stdout del agente.
- **Composer / integration visibility.** U-A ya derivó `selectIntegrationProgress` + conflictos. **Falta:** el repair del composer (cherry-pick → repair semántico) como evento visible. Los tipos `conflict.repair.started`, `integration.cherrypick`, `integration.diagnosis.started` ya están **reservados como v2** en `run-model/types.ts` (`RUN_EVENT_TYPES_V2`). Cuando el motor (`execution-core/src/integration/agent.ts`) emita estas señales, mapealas (adapter o nativo) y agregales payload v1; la superficie de reconciliación ya está lista para mostrarlas.

---

### Doc-drift `trivial` (plegar acá o en G-2)

Los `docs/system/` describen realidad **legacy/desactualizada** en varios módulos. Reconciliá o marcá como superado por `docs/design/`:
- `04-run-executor.md`: dice batches "hasta 3"; D9 = `maxParallel 6`. No menciona el registry de executors (ADR-0030).
- `06-gemini-executor.md`: no menciona el registry / Claude Code CLI opt-in (ADR-0030).
- `07-context-and-scope.md`: dice scope "deny wins" / hard-fail; la implementación real es **advisory** (`outOfScope`), solo forbidden hard-falla. D7/ADR-0023 quedaron stale (ver memoria del proyecto / `implementation-status` previo).
- `09-composer.md`: no refleja el conflict-aware resolver (auto-resolve plan-time, jun-2026).
- `10-web-app.md`: describe la UI **legacy** (canvas/board/timeline + `RunGraphViewModel` + `nodeStatusOverrides` + polling 220ms) como objetivo → está conceptualmente **superado** por `docs/design/`. Marcalo.

---

### Pospuesto (NO implementar sin Francisco)

- **N8 — E2E reproducible / matriz de tesis B0–B4 / grafos congelados.** La tesis está en **standby** (sin evidencia empírica; Lab Mode eliminado; metodología en revisión — ver banner en `CLAUDE.md`). Es trabajo de **decisión metodológica humana**, no de código. No lo fuerces.

---

## 6. Molde de cada unidad (seguilo)

1. Leé el código antes de tocar (los view-models/selectores tienen comentarios de diseño).
2. Plan de subtareas (usá tu task list).
3. Cambios aditivos; respetá la frontera de la unidad (no mezcles concerns).
4. Si tocás eventos legacy, alias claro para evitar colisión `RunEvent` (ya hay precedente: `import type { RunEvent as StreamEvent }`).
5. Si afecta el run real → **flag de rollback**.
6. Tests (puros donde se pueda; manual + browser para G-1).
7. Actualizá `docs/design/implementation-status.md` (sección de tu unidad) — es el estado vivo.
8. `pnpm web:typecheck` + `pnpm test` verdes ANTES de commitear.
9. Commit aislado, mensaje claro, solo tus archivos.

---

## 7. Mapa de archivos clave

| Archivo | Qué |
|---|---|
| `apps/web/src/lib/run-model/types.ts` | Envelope `RunEvent`, entidades, payloads v1, `RUN_EVENT_TYPES(_V2)`. Extendé acá (forward-compat). |
| `apps/web/src/lib/run-model/reducer.ts` | Fold puro `(model, event) → RunModel`. Idempotente por `seq`; ignora desconocidos. |
| `apps/web/src/lib/run-model/selectors.ts` | Derivaciones puras (`selectPhase/Health/RenderableNodeState/PlanningHealth/GranularityMetrics/IntegrationProgress/…`). |
| `apps/web/src/lib/run-model/workspace-view.ts` | Superficie phase-adaptive + NodeVital + integración + métricas + emphasis. |
| `apps/web/src/lib/run-model/focus-view.ts` | Foco polimórfico (node/seam/conflict/decision/evidence) — base del inspector. |
| `apps/web/src/lib/run-model/timeline-view.ts` | Audit-trail: proyecta el `RunEvent[]` crudo. |
| `apps/web/src/lib/run-model/sse-adapter.ts` | **Stream legacy → envelope.** Centro de G-1/G-2. |
| `apps/web/src/lib/server/runs/events.ts` | Tipo legacy `RunEvent` (a renombrar `StreamEvent` en G-2). |
| `apps/web/src/lib/server/runs/runner.ts` | Pipeline planning+ejecución; emite el stream legacy. |
| `apps/web/src/components/dag/RunCanvasShell.tsx` | Legacy `useLiveRun` + `nodeStatusOverrides` (objetivo de G-1). |
| `apps/web/src/components/run-model/proto-run-view.client.tsx` | Cómo se cablea todo el modelo nuevo (copialo para el run real en G-1). |
| `apps/web/src/app/runs/[runId]/page.tsx` | Página del run real (G-1). |
| `packages/execution-core/src/run/executor.ts` · `integration/agent.ts` | Motor (TraceEvents; fuente de eventos nativos en G-2). |
| `docs/design/implementation-status.md` | **Estado vivo.** Leelo y actualizalo. |
| `docs/design/run-operative-model.md` | Modelo congelado (A–P). |

---

## 8. Skills sugeridos para el próximo agente

- **`brainstorming`** — antes de arrancar G-1 (decisión de flag + estrategia de hook live + manejo de `seq`): vale 10 min de diseño.
- **`superpowers` / TDD** — para G-2 (contrato de emisión) y los tests de regresión del adapter: escribí el test primero.
- **`preview_*` (tools, no skill)** — verificación manual obligatoria de G-1 en el browser (`preview_start`, `preview_snapshot`, `preview_screenshot`, `preview_console_logs`). **No** uses "Claude in Chrome" para esto.
- **`code-review` / `ultrareview`** (si está disponible y Francisco lo lanza) — antes de mergear G-1/G-2, por ser cambios de alto impacto sobre el run real.

---

## 9. Lo primero que debería hacer el próximo agente

1. `git log --oneline -8` y leer `docs/design/implementation-status.md` §0d (roadmap) + §0c (PR-N1) — 5 min.
2. Confirmar verde de base: `pnpm web:typecheck` y `pnpm test` (esperá 803 passing + 3 skipped).
3. Abrir `/runs/proto/golden-happy-path` con `pnpm web:dev` para ver la superficie objetivo (métricas + timeline + foco) — es lo que el run real debe alcanzar.
4. Arrancar **G-1** con flag de rollback. No tocar el legacy salvo para aislarlo detrás del flag.
5. Preguntar a Francisco antes de: pushear, cambiar defaults de executor (D4), o tocar la matriz de tesis (N8).
