# Plan incremental de implementación — rediseño agent-first

> Estado: **plan de trabajo** (2026-06-05). Fuente de verdad: los documentos de [`docs/design/`](README.md). Este documento baja el rediseño a una secuencia de PRs ejecutables uno por uno. **No** es implementación; es el plan que la guía.
>
> Principio rector de la migración: **no big-bang.** El sistema actual sigue funcionando mientras se construye el nuevo modelo en paralelo (fixture-first), y recién al final se conecta al stream real vía un adaptador.

> **Estado de ejecución (2026-06-06):** PR01–PR09 ✅ + **PR-U1 ✅ ejecutado** (foco polimórfico + evidencia + hardening, fixture-first; reencuadra PR10 y adelanta la parte fixture de PR14). Suite **728 passing + 3 skipped**, de los cuales **282** son de la capa run-model (10 archivos). **PR11 mitad aditiva ✅** (adapter puro `sse-adapter.ts` + tests); la otra mitad de PR11 (rewire de `RunCanvasShell`/`useLiveRun` al `runStore`+adapter y remoción de `nodeStatusOverrides`) queda **gated** (toca legacy, necesita flag de rollback + verificación con run real). PR12–PR14 ⏳ pendientes. El estado real, la matriz PR01–14 y la recomendación de próximo PR viven en **[`implementation-status.md`](implementation-status.md)**. Próximo paso recomendado: **PR11 (rewire UI, gated)** con flag de rollback.

---

## 1. Diagnóstico del repo actual

### Qué ya sirve como base (conservar)
- **Event log append-only en memoria:** [`event-bus.ts`](../../apps/web/src/lib/server/runs/event-bus.ts) ya acumula historia por run (`getRunEventHistory`, `HISTORY_LIMIT`). Es, conceptualmente, el log del que partir.
- **Transporte SSE:** la ruta [`/api/runs/[id]/events`](../../apps/web/src/app/api/runs/[id]/events/route.ts) + `serializeForSse`. No hay que reemplazar el transporte, solo la *forma* de los eventos.
- **Canvas con react-flow:** [`DagCanvas`](../../apps/web/src/components/dag/DagCanvas.tsx) y `@xyflow/react`. La superficie de trabajo evoluciona sobre esto, no se reescribe.
- **Derivaciones puras dispersas** que son semillas de selectores: [`derivePhase`](../../apps/web/src/lib/run-phase.ts), [`buildRunSummary`](../../apps/web/src/lib/run-summary.ts), [`toRunGraphViewModel`/`buildInspectorView`](../../apps/web/src/lib/graph-view-model.ts), [`selectionRelations`](../../apps/web/src/lib/run-presentation.ts), [`buildPlanReviewSummary`](../../apps/web/src/lib/plan-review.ts).
- **Máquina de estados del run:** [`lifecycle.ts`](../../apps/web/src/lib/server/runs/lifecycle.ts) (transiciones). Se conserva como motor de transición server-side.
- **Endpoints de comando:** approve-plan, answer, run, pause/resume/cancel, nodes/[taskId]/review, etc. Se conservan; luego se unifican detrás de un facade de `Decision`.

### Qué debe evolucionar
- **`useLiveRun`** (en [`RunCanvasShell`](../../apps/web/src/components/dag/RunCanvasShell.tsx)) es un **reducer ad-hoc acoplado al componente**: reduce SSE a `nodeStatusOverrides`, `livePlanNodes`, `pendingQuestion`, `cliLogs`. → Extraer a un **reducer puro** + `runStore`.
- **Derivaciones dispersas** (`derivePhase`, `buildRunSummary`, `toRunGraphViewModel`) → consolidar en una **capa de selectores** única.
- **`DagWorkspace`** con tres vistas pares (canvas/board/timeline vía `SegmentedControl`) → **superficie phase-adaptive** (board/timeline a lentes secundarios).
- **`TaskInspector`** → **panel de foco polimórfico** (nodo/seam/conflicto/decisión/evidencia).
- **`ConflictBottomSheet`** + `conflict-view-model` → **conflictos tipados** ruteados al canal de decisiones.
- **`RunSummaryPanel`** → **superficie de evidencia**.

### Qué debe dejar de expandirse
- **`nodeStatusOverrides`**: estado de ejecución de 3 colores seteado imperativamente desde SSE. No agregar features encima.
- **Las tres vistas pares** como modos iguales.
- **`PlanningConsole`** como superficie primaria (stdout crudo).

### Qué quedará obsoleto
- **`nodeStatusOverrides`** → **reemplazar** (no solo aislar): el estado de ejecución debe derivarse del fold de eventos `node.*`. Durante la migración se aísla detrás del adaptador; el objetivo es eliminarlo.
- La **reducción ad-hoc** dentro de `useLiveRun`.
- La **igualdad de board/timeline/canvas**.

### Deudas conceptuales respecto del nuevo diseño
| Deuda | Detalle |
|---|---|
| **Colisión de nombres `RunEvent`** | El backend ya define `RunEvent` (unión por `kind`, sin `seq/actor/payload`) en `server/runs/events.ts`. El nuevo `RunEvent` es un envelope distinto. |
| **Eventos planos** | Sin `seq`, `actor` ni `payload`; mezclan datos en el top-level. |
| **Reductor acoplado** | La única "reducción" vive en un hook de React, no testeable como función pura. |
| **Estado de nodo imperativo** | `nodeStatusOverrides` = segunda fuente de verdad respecto del log. |
| **Gates dispersos** | `planning.question`/answer, approve-plan, node review, conflict sheet: superficies y endpoints separados. |
| **Sin conceptos nuevos** | No hay seams, verify-loop, freshness, blast radius, ni `Amendment`. |

> **Decisión de la migración sobre `nodeStatusOverrides`:** **reemplazar**, derivando `ExecutionState` del log en el `runStore`. Se aísla temporalmente detrás del adaptador SSE (PR de Fase 9) y se elimina cuando el canvas consume el modelo.

### Ubicación del nuevo modelo
**Decisión:** el modelo (tipos, reducer, selectores, fixtures) vive en `apps/web/src/lib/run-model/` para v1 — TS puro, sin React, testeable por la `vitest.config.ts` raíz existente, **sin** overhead de un package nuevo (tsup/build wiring). Extraer a `@manyhands/run-model` queda como **opción v2** si el backend necesita compartirlo. (Coherente con la regla del repo de no inflar `@manyhands/core`.)

---

## 2. Principios de implementación

1. **Documentación como fuente de verdad** — el código sigue a `docs/design/`, no al revés.
2. **Fixture-first antes de backend real** — la experiencia se valida con `RunEvent[]` fixture idénticos al stream.
3. **Event model antes de UI compleja** — primero el contrato de eventos y entidades.
4. **Reducer puro antes de componentes visuales** — el fold es testeable sin servidor ni React.
5. **Selectores antes de render directo** — la UI nunca lee el `RunModel` crudo.
6. **UI como proyección del modelo** — los componentes son presentacionales.
7. **Una sola fuente de verdad** — nada de estado visual local que duplique lo derivable.
8. **Sin motion sofisticado antes de datos correctos** — primero el dato, después el movimiento.
9. **Sin big-bang** — el run actual sigue andando en cada PR.
10. **Tests verdes en cada PR** — `pnpm test`, `pnpm web:typecheck`, `pnpm -F @manyhands/execution-core typecheck` quedan verdes al cierre de cada PR.

---

## 3. Plan por fases

> Cada fase se materializa en uno o más PRs (§4). Las fases 1–5 son **fixture-only** (no tocan backend). Las fases 9–10 conectan el stream real.

### Fase 0 — Alineación documental y baseline
- **Objetivo:** dejar `docs/design/` como fuente de verdad y alinear docs que describen la dirección vieja.
- **Archivos a revisar:** `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/DECISIONS.md`, `docs/system/` (los que describen la UI actual).
- **Cambios:** sección "Rediseño agent-first" en CLAUDE.md y AGENTS.md apuntando a `docs/design/`; regla "no expandir legacy" (`nodeStatusOverrides`, vistas pares, consola cruda).
- **Aceptación:** una sesión nueva, leyendo CLAUDE.md/AGENTS.md, encuentra `docs/design/` como dirección vigente y entiende qué es legacy.

### Fase 1 — Contratos del modelo operativo
- **Objetivo:** introducir los tipos del nuevo modelo sin conectarlos a UI real.
- **Dónde:** `apps/web/src/lib/run-model/types.ts`.
- **v1:** `RunEvent` (envelope), `Run`, `Node`, `ExecutionState`, `Seam`, `Wave`, `Decision`, `Conflict`, `Amendment`, `Evidence`, y los tipos de payload de los eventos **v1** (ver [`run-operative-model.md`](run-operative-model.md#3-familias-de-eventos-y-payload-mínimo)).
- **v2:** payloads de `plan.node.thinking`, `node.cli.output`, `integration.cherrypick`, `integration.diagnosis.started`.
- **Versionado de eventos:** `type` es string punteado estable; los consumidores ignoran `type` desconocidos (forward-compat). No se versiona con número; se versiona agregando `type` nuevos.
- **Tests mínimos:** typecheck + un test que valide que los fixtures (Fase 2) parsean contra los tipos.

### Fase 2 — Golden fixtures
- **Objetivo:** crear `RunEvent[]` con la misma forma que el futuro stream, cubriendo los 5 escenarios de [`golden-fixtures.md`](golden-fixtures.md).
- **Dónde:** `apps/web/src/lib/run-model/fixtures/{golden-happy-path,golden-planning-question,golden-verify-auto-repair,golden-behavioral-conflict,golden-seam-amendment-blast-radius}.ts`, más un `index.ts`.
- **Estructura:** `RunFixture = { runId, events: RunEvent[], playback?: { delaysMs } }`.
- **Aceptación:** cada fixture tiene los eventos mínimos del doc y un test que los reduce sin error.

### Fase 3 — Reducer puro / runStore
- **Objetivo:** fold `(model, event) → RunModel`.
- **Dónde:** `apps/web/src/lib/run-model/reducer.ts` (+ `store.ts` para la versión subscribible).
- **No debe:** derivar fase/salud/freshness/wavefront; ni efectos secundarios.
- **Eventos desconocidos:** ignorar (no romper) — forward-compat.
- **Append-only:** el reducer aplica por `seq` creciente; ignora `seq` ya aplicados (idempotencia).
- **Tests:** un test por fixture que verifica el `RunModel` resultante en cortes clave + invariantes (no monotonicidad, etc.).

### Fase 4 — Selectores derivados
- **Objetivo:** la capa de consumo única para UI.
- **Dónde:** `apps/web/src/lib/run-model/selectors.ts`.
- **Selectores:** `selectPhase`, `selectHealth`, `selectWavefront`, `selectAttention`, `selectBlocked`, `selectConflicts`, `selectEvidence`, `selectFreshness`, `selectInvalidatedNodes`, `selectAffectedByAmendment`, `selectPendingReexecution`, `selectRenderableNodeState`.
- **Reuso:** portar la lógica de `derivePhase` y `buildRunSummary` aquí (no duplicar; deprecar las versiones viejas cuando el modelo las cubra).
- **Tests:** un test por selector con cortes de los fixtures; casos edge (proyección vs realización de blast radius; `integrated+stale` ≠ done).

### Fase 5 — Adaptador fixture → UI (prototipo)
- **Objetivo:** una primera proyección agent-first alimentada por fixtures, no por backend.
- **Dónde:** una ruta dev-only, p.ej. `apps/web/src/app/runs/_proto/[fixture]/page.tsx`, que carga un `RunFixture`, lo reproduce con `playback`, lo pasa por el `runStore` y renderiza vía selectores.
- **Renderiza:** marco persistente (fase/salud), atención, wavefront, nodos (vía `selectRenderableNodeState`), seams, stale, evidence.
- **Reutiliza:** `DagCanvas` (envuelto), layout de `dag-layout.ts`.
- **No diseñar todavía:** motion fino, lentes timeline/board, panel de foco completo (placeholder).

### Fase 6 — Canal de decisiones
- **Objetivo:** unificar los cinco `kind` de `Decision` en un canal.
- **Comportamiento:** ver [`interaction-model.md`](interaction-model.md#4-el-canal-de-decisiones) (vacío = éxito; bloqueante vs advisory; resolución inline; no congela todo el run).
- **Relación con fixtures:** `golden-planning-question` y `golden-behavioral-conflict` lo ejercen; la resolución en prototipo es local (avanza el fixture).
- **Anti-flicker:** depende de la emisión atómica de gates en los fixtures/eventos (ya en el contrato).
- **Endpoints futuros:** documentar el mapeo a approve-plan/answer para la Fase 10.

### Fase 7 — Superficie de trabajo phase-adaptive
- **Objetivo:** evolucionar el canvas a una superficie que madura por fase.
- **Incluye:** nodos/edges desde selectores; edges tipados (dep/costura/conflicto); wavefront enfatizado; verify-loop como signo vital; **stale como "obsoleto", no fallo** (`selectRenderableNodeState`); board/timeline degradados a lentes secundarios (o pospuestos a v2).

### Fase 8 — Panel de foco polimórfico
- **Objetivo:** evolucionar `TaskInspector` para foco sobre nodo/seam/conflicto/decisión/evidencia.
- **v1:** datos del modelo; diff/log **mockeados por ref** (placeholder).
- **No meter** logs crudos en la superficie primaria.

### Fase 9 — Adaptador SSE/backend → RunEvent
- **Objetivo:** mapear el `RunEvent` legacy (kind-based) al nuevo envelope; misma forma que fixtures.
- **Dónde:** `apps/web/src/lib/run-model/sse-adapter.ts`. Renombrar el tipo legacy a `StreamEvent` en `server/runs/events.ts` (rename mecánico; los tests atrapan rupturas) para resolver la colisión.
- **Mapeo:** `planning.node.*`→`plan.node.*`; `planning.question`→`decision.raised{clarify}`; `agent.run.started/completed`→`node.execution.started`/`node.verify.passed|failed`; `validation.completed`→`node.verify.iteration`/`integration.validated`; `status.changed`→**ignorado** (fase derivada); `node.added`/`edge.added`/`risk.added`→`plan.*`. `seq` = índice en `getRunEventHistory`; `actor` por kind.
- **Eventos faltantes:** grounding/seam/verify-iteration/amendment **no se emiten todavía** → los selectores degradan (sin Foundation, verify-loop coarse pass/fail). Aceptable para v1.
- **Reemplaza** la reducción de `useLiveRun` por el `runStore` + adapter; **elimina `nodeStatusOverrides`**.

### Fase 10 — Integración progresiva con ejecución real
- **Objetivo:** conectar el `/runs/[runId]` real al modelo, sin volver a leer estado crudo.
- **Primero mock/fixture:** Foundation (grounding/seams), verify-loop fino, conflictos tipados, amendments.
- **Primero al backend:** planning + execution coarse + integración + evidencia (lo que el stream actual ya da).
- **Decision facade:** un endpoint `/api/runs/[id]/decisions/[decisionId]` que rutea internamente a approve-plan/answer existentes; el canal de decisiones resuelve por una sola vía.
- **Fuera de scope v1:** emisión real de eventos de Foundation/verify/seam/amendment desde el motor (requiere capacidades backend pendientes).

---

## 4. PRs concretos

> Convención: cada PR deja `pnpm test` + typechecks verdes. Ramas desde `main`.

### PR 01 — Alinear documentación y baseline agent-first
**Objetivo:** fijar `docs/design/` como fuente de verdad.
**Motivación:** evitar que el código (y futuras sesiones) trabajen contra docs viejos.
**Áreas:** `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/DECISIONS.md` (nota de remisión).
**Cambios:** sección "Rediseño agent-first" con punteros a `docs/design/`; regla "no expandir legacy".
**No incluye:** ningún cambio de código.
**Tests/verificación:** `pnpm test` (sin cambios); revisión manual de coherencia de enlaces.
**Aceptación:** CLAUDE.md y AGENTS.md remiten a `docs/design/`; legacy marcado.
**Riesgos:** bajo. **Rollback:** revertir el commit de docs.

### PR 02 — Tipos del modelo operativo (`run-model/types.ts`)
**Objetivo:** vocabulario del nuevo modelo (v1).
**Motivación:** base de fixtures, reducer y selectores.
**Áreas:** `apps/web/src/lib/run-model/types.ts`.
**Cambios:** envelope `RunEvent`, entidades, payloads de eventos v1; marcar v2 con comentarios.
**No incluye:** reducer, selectores, UI; no toca el `RunEvent` legacy todavía.
**Tests:** `tests/run-model-types.test.ts` — un fixture mínimo inline parsea contra los tipos; `pnpm web:typecheck`.
**Aceptación:** tipos compilan; no hay import del tipo legacy (sin colisión).
**Riesgos:** sobre-modelar. **Mitigación:** solo v1; v2 comentado.

### PR 03 — Golden fixtures (`run-model/fixtures/`)
**Objetivo:** los 5 fixtures como `RunEvent[]`.
**Áreas:** `apps/web/src/lib/run-model/fixtures/*.ts`.
**Cambios:** los 5 fixtures + `index.ts` + tipo `RunFixture`.
**No incluye:** reducer/selectores (se testean en PR 04/05).
**Tests:** `tests/run-model-fixtures.test.ts` — cada fixture parsea, `seq` monotónico, sin `type` fuera del contrato.
**Aceptación:** los 5 existen con los eventos mínimos del doc.
**Riesgos:** fixture drift. **Mitigación:** misma forma que el envelope; tests de forma.

### PR 04 — Reducer puro (`run-model/reducer.ts`)
**Objetivo:** fold a `RunModel`.
**Áreas:** `reducer.ts`, `store.ts`.
**Cambios:** reducer puro + store subscribible; idempotencia por `seq`; ignora desconocidos.
**No incluye:** selectores, UI.
**Tests:** `tests/run-model-reducer.test.ts` — por fixture, `RunModel` en cortes clave + invariantes 1,3,11.
**Aceptación:** los 5 fixtures reducen sin error; invariantes verdes.
**Riesgos:** reducer que deriva. **Mitigación:** test que prohíbe campos derivados en el modelo.

### PR 05 — Selectores (`run-model/selectors.ts`)
**Objetivo:** capa de consumo única.
**Áreas:** `selectors.ts`; deprecación gradual de `run-phase.ts`/`run-summary.ts`.
**Cambios:** los 12 selectores; portar `derivePhase`/`buildRunSummary`.
**No incluye:** render.
**Tests:** `tests/run-model-selectors.test.ts` — por selector y por corte; edge cases (proyección vs realización; `integrated+stale`≠done; sin flicker).
**Aceptación:** todas las assertions de `golden-fixtures.md` (reducer-side) pasan.
**Riesgos:** selectores incompletos. **Mitigación:** cobertura por fixture.

### PR 06 — Prototipo visual con fixtures (ruta dev)
> **Estado: ✅ Completado.** Tests: `run-model-proto-render` (23).
**Objetivo:** primera proyección agent-first sin backend.
**Ruta:** `apps/web/src/app/runs/proto/[fixture]/page.tsx` (+ índice `proto/page.tsx`). El segmento es `proto`, **no `_proto`**: en el App Router de Next un prefijo con guión bajo es *private folder* y no rutea (por eso el repo usa `_components`). URLs reales: `/runs/proto/<fixture>`.
**Áreas:** la ruta de arriba; `apps/web/src/lib/run-model/proto-view.ts` (presenter puro `selectProtoView`); `apps/web/src/components/run-model/*` (componentes presentacionales).
**Cambios:** marco persistente, superficie DAG **propia fixture-first** (columnas por profundidad) con nodos vía `selectRenderableNodeState` y wavefront vía `selectWavefront`, reproductor de fixtures sobre `runStore`.
**No reutiliza `DagCanvas`:** depende del `RunGraphViewModel` legacy, cuyo enum `status` no puede representar `obsolete` (laundería un nodo stale → rompería el invariante 10), y arrastra React Flow (DOM/provider, intesteable en entorno node). Reconciliar el canvas real con el modelo operativo es **PR 08**.
**No incluye:** canal de decisiones completo, foco completo, motion fino.
**Tests:** `tests/run-model-proto-render.test.ts` — proyección pura (entorno node, sin jsdom): presencia de fase/salud/wavefront, nodo stale nunca como `done`.
**Aceptación:** `golden-happy-path` se ve evolucionar por fases.
**Riesgos:** motion prematuro. **Mitigación:** sin motion en este PR.

### PR 07 — Canal de decisiones
**Objetivo:** unificar gates en el canal.
**Áreas:** `components/run-model/decision-channel.*`; consume `selectAttention`.
**Cambios:** lista tipada bloqueante/advisory; resolución inline (avanza fixture); contexto embebido.
**No incluye:** endpoints reales (Fase 10).
**Tests:** con `golden-planning-question` y `golden-behavioral-conflict`: aparece 1 gate bloqueante; vacío = éxito.
**Aceptación:** los cinco `kind` se renderizan; resolver avanza el fixture.
**Riesgos:** canal invasivo. **Mitigación:** vacío = éxito; distinción bloqueante/advisory.

### PR 08 — Superficie de trabajo phase-adaptive
> **Estado: ✅ Completado** — implementado como **superficie propia** (`run-model/workspace-view.ts` + `components/run-model/workspace-surface.tsx`), **no** evolucionando `DagCanvas` (el `RunGraphViewModel` legacy no puede expresar `obsolete`; ver `implementation-status.md` §7). Board/timeline no se introdujeron. Tests: `run-model-workspace-view` (15).
**Objetivo:** canvas que madura por fase.
**Áreas:** evolucionar `DagCanvas`/`DagWorkspace`; edges tipados; wavefront; seams.
**Cambios:** énfasis por fase; board/timeline a lentes secundarios (detrás de un disclosure, no toggles pares).
**No incluye:** verify-loop fino del nodo (PR 09) ni foco (PR 10).
**Tests:** snapshot/estructura con fixtures (wavefront resaltado; edges de costura).
**Aceptación:** una sola superficie; board/timeline ya no pares.
**Riesgos:** canvas vuelve a dashboard. **Mitigación:** énfasis dirigido por `selectPhase`/`selectWavefront`.

### PR 09 — Signo vital de nodo (verify-loop)
> **Estado: ✅ Completado** — `NodeVital` derivado en `workspace-view.ts` (build/tests/retry, repair, obsolete, blocked, conflicto, enmienda). Tests: `run-model-node-vitals` (14).
**Objetivo:** el nodo muestra `build/tests/retry`.
**Áreas:** componente de nodo en la superficie; consume `VerifyLoop` de `selectRenderableNodeState`.
**Cambios:** signo vital compacto; **stale = obsoleto, no fallo**.
**Tests:** `golden-verify-auto-repair` (retry visible, sin attention) y `golden-seam-amendment-blast-radius` (obsoleto ≠ fallo).
**Aceptación:** invariante 10 (obsoleto nunca como done) verificable en UI.
**Riesgos:** stale como failed. **Mitigación:** test de render explícito.

### PR 10 — Panel de foco polimórfico
> **Nota de auditoría (2026-06-05):** **reencuadrar.** PR06–09 fueron net-new aditivos fixture-first sin tocar legacy; el `TaskInspector` legacy además tiene trabajo no commiteado (product-completion). El foco debe ser un **componente nuevo** en `components/run-model/` (no evolucionar el legacy). Recomendado ejecutarlo dentro de **PR-U1 (Ultracode)**. Ver `implementation-status.md` §8.
**Objetivo:** evolucionar `TaskInspector`.
**Áreas:** `TaskInspector` → foco nodo/seam/conflicto/decisión/evidencia.
**Cambios:** vistas por tipo; diff/log mock por ref.
**No incluye:** lazy-load real de diff/log (v2).
**Tests:** foco abre por selección; conflicto muestra diagnóstico (mock).
**Aceptación:** selección → foco sin pausar el prototipo.
**Riesgos:** logs crudos en primaria. **Mitigación:** logs solo en drawer del foco.

### PR 11 — Adaptador SSE → RunEvent (+ rename legacy)
**Objetivo:** conectar el stream real a través del modelo.
**Áreas:** `run-model/sse-adapter.ts`; rename `RunEvent`→`StreamEvent` en `server/runs/events.ts` y sus usos; `RunCanvasShell` usa `runStore`+adapter.
**Cambios:** mapeo legacy→envelope; `seq` desde `getRunEventHistory`; **elimina `nodeStatusOverrides`**.
**No incluye:** eventos backend nuevos (grounding/verify/seam).
**Tests:** `tests/run-model-sse-adapter.test.ts` — historia legacy → envelope esperado; regresión de `RunCanvasShell` (run real sigue renderizando).
**Aceptación:** un run persistido real se renderiza vía selectores; `nodeStatusOverrides` ya no existe.
**Riesgos:** romper runs actuales. **Mitigación:** el adapter cubre todos los kinds actuales; test de regresión; **rollback** = feature flag que vuelve a `useLiveRun` viejo.

### PR 12 — Página de run real sobre el modelo
**Objetivo:** `/runs/[runId]` consume el `runStore` (no estado crudo).
**Áreas:** `app/runs/[runId]/page.tsx` + `RunCanvasShell`.
**Cambios:** la página real usa la misma proyección que el prototipo; las fases ausentes (Foundation/verify fino) degradan.
**No incluye:** decision facade (PR 13).
**Tests:** regresión de render del run real; fases derivadas correctas con eventos actuales.
**Aceptación:** paridad funcional con la UI actual, ahora sobre el modelo.
**Riesgos:** degradación confusa. **Mitigación:** copy claro cuando una fase no tiene datos aún.

### PR 13 — Decision facade (endpoints)
**Objetivo:** una sola vía para resolver gates.
**Áreas:** `app/api/runs/[id]/decisions/[decisionId]/route.ts` (nuevo) que rutea a approve-plan/answer existentes.
**Cambios:** el canal de decisiones resuelve por el facade; backend interno intacto.
**Tests:** `tests/decisions-facade.test.ts` — cada `kind` rutea al endpoint correcto.
**Aceptación:** approve_plan y clarify funcionan vía el facade.
**Riesgos:** divergencia con endpoints viejos. **Mitigación:** el facade delega, no reimplementa.

### PR 14 — Superficie de evidencia
**Objetivo:** evolucionar `RunSummaryPanel` a evidencia.
**Áreas:** `RunSummaryPanel` → consume `selectEvidence`.
**Cambios:** diff agregado + tests + narrativa + (cuando exista) `invalidationTrace`.
**Tests:** `golden-happy-path` y `golden-seam-amendment-blast-radius` (trace de invalidación).
**Aceptación:** Disposition muestra evidencia; merge vía decision facade.
**Riesgos:** bajo.

---

## 5. Orden recomendado y justificación

`PR 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14`

**Justificación:** sigue las dependencias de datos, no la vistosidad.
1. **Docs (01)** primero: evita construir contra dirección vieja.
2. **Tipos (02)** antes que nada de runtime: vocabulario común.
3. **Fixtures (03)** antes del reducer: son sus tests.
4. **Reducer (04)** antes que selectores: estos lo consumen.
5. **Selectores (05)** antes que UI: la UI solo consume selectores.
6. **Prototipo con fixtures (06–10)** antes de tocar backend: valida la experiencia entera sin costo de backend; cada pieza (decisiones, superficie, verify-loop, foco) se valida aislada.
7. **Adaptador SSE (11)** y **run real (12)** después: conectar lo ya validado al stream existente.
8. **Decision facade (13)** y **evidencia (14)** al final: cierran el loop de comando y de aceptación.

El prototipo (06–10) puede demostrarse **antes** de tocar una línea de backend — ese es el corte de demo defendible.

---

## 6. Matriz de dependencias

| PR | Depende de | Habilita | Riesgo | Prioridad |
|---|---|---|---|---|
| 01 Docs | — | todo | bajo | alta |
| 02 Tipos | 01 | 03,04,05 | bajo | alta |
| 03 Fixtures | 02 | 04,05,06 | medio | alta |
| 04 Reducer | 02,03 | 05 | medio | alta |
| 05 Selectores | 04 | 06–14 | medio | alta |
| 06 Prototipo | 05 | 07,08,09,10 | medio | alta |
| 07 Decisiones | 05,06 | 13 | medio | media |
| 08 Superficie | 05,06 | 09,10 | alto | media |
| 09 Verify-loop | 08 | — | medio | media |
| 10 Foco | 08 | — | medio | media |
| 11 SSE adapter | 05 (06 ideal) | 12,13,14 | **alto** | alta |
| 12 Run real | 11 | 13,14 | alto | media |
| 13 Decision facade | 07,11 | 14 | medio | media |
| 14 Evidencia | 05,12 | — | bajo | baja |

---

## 7. Matriz de trazabilidad

| Documento de diseño | Decisión | PR(s) |
|---|---|---|
| `run-operative-model.md` | Envelope `RunEvent` + entidades | PR 02 |
| `run-operative-model.md` | Reducer puro + idempotencia | PR 04 |
| `run-operative-model.md` | 12 selectores derivados | PR 05 |
| `run-operative-model.md` | Invariantes 1–11 | PR 04, 05, 09 |
| `run-operative-model.md` (H–J) | `Seam.revision` + `builtAgainst` + freshness | PR 02, 05 |
| `run-operative-model.md` (E) | Emisión atómica de gates | PR 03 (fixtures), 07 |
| `golden-fixtures.md` | 5 fixtures + assertions | PR 03, 04, 05 |
| `interaction-model.md` | Canal de decisiones (vacío=éxito, bloqueante/advisory) | PR 07 |
| `interaction-model.md` | Superficie phase-adaptive; board/timeline secundarios | PR 08 |
| `interaction-model.md` | Stale ≠ failed | PR 09 |
| `interaction-model.md` | Panel de foco polimórfico | PR 10 |
| `system-components.md` | `runStore`/selector layer/SSE adapter/fixture layer | PR 04, 05, 11, 03 |
| `system-components.md` | Eliminar `nodeStatusOverrides` | PR 11 |
| `agent-first-redesign.md` | Fases como centros de gravedad | PR 06, 08 |
| `agent-first-redesign.md` | Superficie de evidencia | PR 14 |
| `implementation-readiness.md` | Decision facade | PR 13 |

---

## 8. Plan de testing

| Capa | Qué se testea | Dónde | Comando |
|---|---|---|---|
| Fixtures | forma, `seq` monotónico, `type` dentro del contrato | `tests/run-model-fixtures.test.ts` | `pnpm test` |
| Reducer | `RunModel` por corte; idempotencia; desconocidos | `tests/run-model-reducer.test.ts` | `pnpm test` |
| Selectores | cada selector por corte; edge cases | `tests/run-model-selectors.test.ts` | `pnpm test` |
| Invariantes | 1–11 como tests dedicados | `tests/run-model-invariants.test.ts` | `pnpm test` |
| UI con fixtures | render de fase/salud/wavefront/decisiones | `tests/run-model-proto-render.test.ts` | `pnpm test` |
| SSE adapter | historia legacy → envelope | `tests/run-model-sse-adapter.test.ts` | `pnpm test` |
| Regresión UI actual | el run real sigue renderizando | tests existentes de `RunCanvasShell`/presenter | `pnpm test` |
| Typecheck | tipos del modelo + web | — | `pnpm web:typecheck`, `pnpm -F @manyhands/execution-core typecheck` |
| UI con fixtures | canal de decisiones (5 kinds, vacío=éxito) | `tests/run-model-decision-channel.test.ts` | `pnpm test` |
| UI con fixtures | superficie phase-adaptive (mode/seams/wavefront/blast) | `tests/run-model-workspace-view.test.ts` | `pnpm test` |
| UI con fixtures | signo vital de nodo (build/tests/retry, obsolete≠done) | `tests/run-model-node-vitals.test.ts` | `pnpm test` |
| Smoke manual | demo del prototipo | ruta `/runs/proto/golden-happy-path` | `pnpm web:dev` |

> La suite tras PR09 está en **644 passing + 3 skipped** (`vitest.config.ts` raíz), de los cuales **218** son de la capa run-model (types 9 · fixtures 58 · reducer 47 · selectores 40 · proto-render 23 · decision-channel 12 · workspace-view 15 · node-vitals 14). El resto es trabajo previo (product-completion + execution-core) ortogonal al rediseño. Cada PR debe mantenerla verde y sumar sus tests.

---

## 9. Riesgos y alcance

### Riesgos técnicos
| Riesgo | Mitigación |
|---|---|
| Event model demasiado grande | Solo v1; v2 comentado; no agregar `type` sin caso de uso. |
| Fixture drift vs backend real | Envelope compartido; el SSE adapter (PR 11) produce *exactamente* la misma forma; test de adapter. |
| Selectores incompletos | Cobertura obligatoria por fixture; assertions del doc como contrato. |
| Doble fuente de verdad | Invariante 11 como test; UI consume selectores, nunca el modelo crudo. |
| UI leyendo estado crudo | Lint/review: prohibido importar `RunModel` en componentes; solo selectores. |
| Mapear el SSE actual | El adapter cubre todos los kinds existentes; los faltantes degradan, no rompen. |
| Colisión `RunEvent` | Rename legacy → `StreamEvent` en PR 11 (mecánico, tests atrapan). |

### Riesgos de UX
| Riesgo | Mitigación |
|---|---|
| Demasiada información | Jerarquía + progressive disclosure; detalle on-demand. |
| Stale confundido con failed | `selectRenderableNodeState` + test de render (PR 09). |
| Canal de decisiones invasivo | Vacío = éxito; bloqueante vs advisory. |
| Canvas volviendo a dashboard | Énfasis dirigido por fase; board/timeline detrás de disclosure. |

### Riesgos de alcance
| Riesgo | Mitigación |
|---|---|
| Implementar Foundation real antes de tiempo | v1 fixtura grounding/seams; backend real es v2. |
| Motion antes del modelo | Sin motion hasta tener datos correctos (post PR 05). |
| Resolver v2 antes de v1 | v2 explícitamente fuera de los PRs 01–14. |
| Rediseñar todo el frontend de una vez | PRs 06–10 construyen lo nuevo en paralelo; el run real migra recién en 11–12, con flag de rollback. |

---

## 10. Definición de v1

**v1 del rediseño agent-first** =

**Implementado (datos reales):**
- `runStore` + reducer + selectores como única fuente de estado de la UI del run.
- El run real (`/runs/[runId]`) renderiza vía el modelo (PR 11–12), con `nodeStatusOverrides` eliminado.
- Canal de decisiones para approve_plan y clarify resueltos por datos reales (PR 13).
- Superficie phase-adaptive con planning, execution coarse, integración y evidencia reales.

**Fixtura (sin backend nuevo):**
- Foundation (grounding/seams congelándose), verify-loop fino, conflictos tipados conductuales, amendments / blast radius / re-ejecución parcial — todos demostrables vía los fixtures golden en la ruta de prototipo.

**Funciona con datos reales:** planning, ejecución (pass/fail coarse), integración, evidencia, approve_plan, clarify.

**Queda v2:** emisión real desde el motor de eventos de Foundation/verify-iteration/seam/amendment; diagnóstico backend de conflictos; agente scaffolder; lazy-load real de diff/log; lentes timeline/board pulidos; extracción a `@manyhands/run-model`.

**Demo defendible al final:** *"el mismo modelo, alimentado por fixtures, muestra la experiencia completa (planning→foundation→wavefront paralelo→verify-loop→conflicto conductual→enmienda con blast radius→evidencia); y alimentado por el backend real, muestra un run real de punta a punta sobre la misma proyección, sin estado crudo y sin doble fuente de verdad."*

---

## 11. Criterio para empezar implementación

- [x] Documentación alineada (`docs/design/` congelado; CLAUDE.md/AGENTS.md actualizados en PR 01).
- [x] PRs definidos (01–14) con objetivo, áreas, tests y aceptación.
- [x] Dependencias claras (§6).
- [x] Fixtures definidos (§ y `golden-fixtures.md`).
- [x] Tests esperados claros (§8).
- [x] Alcance v1 cerrado (§10).
- [x] Riesgos conocidos con mitigación (§9).
- [x] **PR01–PR09 ejecutados** (✅, fixture-first, suite verde). Ver [`implementation-status.md`](implementation-status.md).
- [ ] **Siguiente PR recomendado: PR-U1 (Ultracode)** — foco polimórfico + evidencia + hardening fixture-first; reencuadra PR10 (foco nuevo, no evolucionar el `TaskInspector` legacy). Detalle en [`implementation-status.md`](implementation-status.md) §8.

> La implementación avanzó por **PR01→PR09** manteniendo la suite verde y sin big-bang. El próximo corte natural es **PR-U1** (cerrar la experiencia fixture-first) antes de tocar SSE/backend (PR11+).
