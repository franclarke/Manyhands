# HANDOFF — Refactorización del Backend Orquestador con LangGraph (para Codex 5.5 / AI Agents)

> **Actualización 2026-06-08.** El rediseño agent-first del frontend ya está completado y conectado por defecto a `/runs/[runId]` (usando el adaptador SSE temporal). La nueva frontera de desarrollo consiste en **refactorizar y rediseñar el backend orquestador utilizando LangGraph.js**, reemplazando la lógica secuencial y el replay-cache por una máquina de estados formalizada con checkpoints nativos en disco y time-travel.

> **Propósito.** Sos el agente que implementa la orquestación con LangGraph en ManyHands. Este documento es **autocontenido**: con él, la especificación en `docs/design/langgraph-orchestrator-design.md` y el código del repo, podés implementar el prototipo de LangGraph sin contexto previo.
>
> **Cómo usarlo:** leé las secciones 0–4 una vez (reglas + estado + arquitectura), después tomá las unidades pendientes de la §5 **en orden** (`PR-LG1 → PR-LG2 → PR-LG3 → PR-LG4`). Cada unidad trae objetivo, enfoque y verificación.
>
> **Idioma:** Francisco trabaja en español; comunicá en español. Comentarios de código en inglés (seguí el estilo del repo).


---

## 0. Reglas innegociables (NO renegociar)

1. **Decisiones D1–D10 cerradas** — ver [`CLAUDE.md`](../../CLAUDE.md) y [`docs/DECISIONS.md`](../DECISIONS.md). Las que más te tocan:
   - **D3:** si el LLM falla → el run **falla con error accionable**. Sin fallback silencioso.
   - **D4:** **Gemini CLI** (`gemini`, headless, stdin) es el único executor de
     planning, ejecución y repair. No agregar executors ni cambiar el default.
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

**Estado 2026-06-07:** el carril gated que conectaba el run real al modelo
agent-first ya se ejecutó como v1. La lista histórica de abajo queda como
registro de contexto, no como instrucciones pendientes. Para trabajo nuevo, usar
[`implementation-status.md`](implementation-status.md#0e-cierre-agent-first-v1-ejecutado-2026-06-07)
como fuente viva.

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

## 5. Unidades de Trabajo Pendientes (Fase LangGraph Orchestrator)

El objetivo de esta fase es refactorizar la orquestación de ManyHands utilizando **LangGraph.js**, alineándolo con el diseño técnico detallado en [langgraph-orchestrator-design.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/langgraph-orchestrator-design.md).

### PR-LG1 — Paquete de Grafos e Infraestructura de Checkpoint
- **Objetivo**: Crear el entorno de desarrollo para LangGraph en el monorepo e implementar la persistencia en disco de checkpoints JSON.
- **Archivos probables**:
  - `packages/` (nuevo paquete `@manyhands/orchestrator-graph`).
  - Nuevo checkpointer local `JsonFileCheckpointSaver` (implementa `BaseCheckpointSaver`).
  - `tsconfig.json` y configuraciones del workspace de pnpm.
- **Enfoque**:
  1. Instalar `@langchain/langgraph` y `@langchain/core`.
  2. Implementar `JsonFileCheckpointSaver` para escribir y recuperar archivos JSON bajo el directorio de runs configurado en `store.ts` (`mh-<runId>/latest.json` y `mh-<runId>/<checkpointId>.json`).
- **Verificación**: Tests unitarios que escriban y lean un checkpoint completo sin errores de tipado.

### PR-LG2 — Planificación Interactiva en LangGraph (Decomposer-HITL)
- **Objetivo**: Migrar el loop de planificación recursiva de `GeminiRecursiveDecomposer` a LangGraph.js, usando interrupciones nativas para preguntas y aprobaciones.
- **Archivos probables**:
  - `@manyhands/orchestrator-graph` (nodos del StateGraph: `initializePlanningNode`, `decomposeNode` y `criticNode`).
  - `apps/web/src/lib/server/runs/runner.ts` (API route `/api/runs/[id]/resume`).
- **Enfoque**:
  1. Definir `RunStateAnnotation`.
  2. Mapear las decisiones del tipo `question` del decomposer a una interrupción nativa `interrupt()`.
  3. Al dispararse la interrupción, guardar el estado, actualizar el status del run a `"paused"` y emitir el evento `decision.raised`.
  4. Exponer `/resume` para escribir la respuesta en el canal `userAnswers` e invoca a `graph.resume(answer)`.
- **Verificación**: Tests de integración usando `MemorySaver` y `vitest` que simulen respuestas del usuario en la planificación y verifiquen que el grafo se reanuda desde el paso suspendido.

### PR-LG3 — Concurrencia Paralela (Map-Reduce) y Reparación Bottom-Up
- **Objetivo**: Ejecutar los lotes en paralelo usando la primitiva `Send` de LangGraph, e implementar el arbitraje de conflictos y reintentos.
- **Archivos probables**:
  - Nodos del StateGraph: `executeLeafNode`, `integrateCompositeNode` y `runValidationNode`.
  - Integración con `WorktreeManager`, `GeminiCliExecutor` e `IntegrationAgent` (Composer).
- **Enfoque**:
  1. El programador genera la lista de tareas en un lote. Para cada tarea, se despacha un `Send("executeLeafNode", { taskId })` ejecutándolas en paralelo.
  2. Cada tarea hoja inicializa su worktree bajo un directorio aislado (`mh-{runId}-{nodeId}`).
  3. Si fallan los tests de la tarea hoja, realizar 1 reintento automático de reparación con Gemini CLI. Si este falla, lanzar un `interrupt()` para pedir directrices.
  4. Si ocurre un conflicto semántico de fusión al integrar, invocar al Composer (reparación semántica). Si falla, lanzar `interrupt()` con los detalles del conflicto para resolución del usuario en el chat.
- **Verificación**: Pruebas unitarias simulando fallos de tests y conflictos de cherry-pick, y comprobando la interrupción del grafo.

### PR-LG4 — Viaje en el Tiempo (Forking) y Sincronización en Next.js
- **Objetivo**: Conectar Next.js Server Components para cargar el estado del checkpoint y exponer la bifurcación no destructiva (Time-travel).
- **Archivos probables**:
  - `apps/web/src/app/runs/[runId]/page.tsx`
  - `apps/web/src/app/api/runs/[id]/fork/route.ts` (nuevo endpoint).
- **Enfoque**:
  1. Durante la carga de página, Next.js Server Components lee directamente el último checkpoint de LangGraph mediante `graph.getState(...)` para pintar el DAG.
  2. Implementar la operación `/api/runs/[id]/fork` que clona un checkpoint anterior, crea un nuevo registro `RunRecord` con un nuevo ID, y lanza un nuevo StateGraph de LangGraph.
- **Verificación**: Probar manualmente en el navegador cargando runs existentes, visualizando el DAG completo de inmediato y forkeando una rama fallida.

### Doc-drift `trivial` (plegar en PR-LG1)
Los `docs/system/` describen realidad legacy/desactualizada en varios módulos. Márcalos como superados por `docs/design/langgraph-orchestrator-design.md` y `docs/design/run-operative-model.md`:
- `04-run-executor.md`: desactualizado respecto a maxParallel 6 y el executor registry.
- `06-gemini-executor.md`: desactualizado respecto al registry y Claude Code.
- `07-context-and-scope.md`: desactualizado respecto a scopes advisory.
- `09-composer.md`: no refleja el resolvedor automático.
- `10-web-app.md`: describe la UI legacy y el polling de 220ms.

---

## 6. Molde de cada unidad (seguilo)

1. Leé el código antes de tocar (los view-models/selectores tienen comentarios de diseño).
2. Plan de subtareas (usá tu task list).
3. Cambios aditivos; respetá la frontera de la unidad (no mezcles concerns).
4. Si tocás eventos legacy, alias claro para evitar colisión `RunEvent` (ya hay precedente: `import type { RunEvent as StreamEvent` = `StreamEvent`).
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
4. Arrancar **PR-LG1** con flag de rollback. No tocar el legacy salvo para aislarlo detrás del flag.
5. Preguntar a Francisco antes de: pushear, cambiar defaults de executor (D4), o tocar la matriz de tesis (N8).
