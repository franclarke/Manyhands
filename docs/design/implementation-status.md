# Estado de implementación — rediseño agent-first

> **Actualización 2026-06-07.** El path agent-first ya es el default en
> `/runs/[runId]`. El legacy queda solo como rollback temporal con
> `?model=legacy`. El run real ahora consume un stream nativo
> `/api/runs/[id]/run-events` respaldado por un log JSONL append-only por run;
> `/api/runs/[id]/events` queda como SSE legacy. La UI nueva usa el reducer y
> selectores del run model, no `nodeStatusOverrides`.

## 0e. Cierre Agent-First V1 Ejecutado (2026-06-07)

Esta iteración convierte el rediseño de prototipo/flag a camino principal:

- **Default agent-first:** `/runs/[runId]` renderiza `RunModelView` por defecto.
  `?model=legacy` mantiene el canvas legacy como rollback temporal.
- **RunEvent nativo:** nuevo endpoint `GET /api/runs/[id]/run-events`, con replay
  por `seq` y suscripción live. El log nativo vive como sidecar JSONL por run y
  se inicializa desde `RunRecord` solo para runs viejos o incompletos.
- **Decision facade:** nuevo `POST /api/runs/[id]/decisions/[decisionId]` para
  `approve_plan`, `clarify`, `resolve_conflict`, `approve_amendment` y
  `approve_merge`. Los endpoints legacy siguen disponibles para rollback.
- **Artifacts lazy:** nuevo `GET /api/runs/[id]/artifacts?ref=...` para resolver
  refs de diff, log, evidence/receipt, contract/seam e integration diagnosis.
  El panel de foco ya resuelve refs reales bajo demanda.
- **Runner -> run model:** el runner publica eventos nativos desde dos fuentes:
  proyección de plan/foundation y adaptación `TraceEvent -> RunEvent` para waves,
  node execution, verify, conflicts e integration. La deduplicación snapshot+tail
  se hace por `seq`.
- **Foundation visible:** se emiten `grounding.started`, `seam.frozen`,
  `grounding.completed` y waves planificadas desde contratos reales del plan.
  Importante: esto es **contract-grounding/foundation visibility**, no todavía un
  `GroundingAgent` Gemini que escriba walking skeleton con extractor TS/JS pleno.
- **Validation como verdad de leaf:** `leafValidationCommands` se ejecutan tras
  registrar el resultado de la hoja. Si fallan, la hoja queda
  `validation_failed` y no integra, aunque haya producido un diff válido. D5/D6
  siguen intactas: el diff viene de git y el commit lo hace el orquestador.
- **Command Center intent-first:** los controles de modelos/aggressiveness pasan
  a advanced settings colapsado; el prompt y readiness son la superficie primaria.

Pendientes honestos del frontier completo:

- `GroundingAgent` agéntico real con walking skeleton, ownership de archivos
  compartidos y extractor TS/JS verificable.
- Verify-loop multi-iteración build/test/fix; hoy hay validación de hoja como
  gate de verdad, pero no reintentos automáticos de fix hasta verde.
- Scheduler de waves basado en scopes derivados y seams draft/frozen reales; hoy
  se mapean batches a waves y se exponen seams congelados desde contratos.
- Amendments con invalidación/re-run acotado de consumidores; hoy existe el
  facade/evento de decisión y aplicación, no el re-execution engine completo.

> Estado **vivo** (act. 2026-06-06). Complementa [`implementation-plan.md`](implementation-plan.md) (el *plan*) con el **estado real** tras ejecutar PR01–PR09 **+ PR-U1**. Es la fuente de verdad de "qué está hecho, qué falta, qué cambió". No introduce features; documenta.

---

## 0. PR-U1 ejecutado (2026-06-06)

**PR-U1 — Fixture-First Control Room: Focus + Evidence + Hardening** está **ejecutado**. Resumen de lo que aterrizó (todo aditivo, fixture-first, sin tocar backend/SSE/`/runs/[runId]`):

- **Foco polimórfico** — `apps/web/src/lib/run-model/focus-view.ts` (view-model puro): `RunModel + FocusTarget → FocusView` discriminado por `node / seam / conflict / decision / evidence`, con estado seguro `missing` para targets ausentes/futuros. Compone `selectWorkspaceView` + selectores; no duplica dominio. Incluye `parseFocusTarget`/`formatFocusTarget` y `EVIDENCE_FOCUS_TARGET`.
- **Panel de foco** — `apps/web/src/components/run-model/focus-panel.tsx` (presentacional): recibe `FocusView`, renderiza las 5 variantes + `missing`, on-demand, con cross-links navegables y artefactos **solo por ref** (sin viewer real).
- **Selección + deep-link** — la superficie y el canal emiten `FocusTarget`; estado de foco **local** en `proto-run-view.client.tsx` (no muta el modelo, no pausa el playback). Deep-link `/runs/proto/<fixture>?focus=<kind>:<id>` vía `history.replaceState` (sin router re-render / Suspense); seed leído por la ruta.
- **Evidencia más protagonista** — `EvidenceBlock` con afordancia "Inspeccionar evidencia →"; el focus de evidencia expone `reExecuted/reIntegrated/preserved`, `invalidationTrace` y la relación con `approve_merge`.
- **Hardening** — `tests/run-model-focus-view.test.ts` (18), `tests/run-model-invariants.test.ts` (21, consolida stale≠done/≠failed, obsolete, pureza, no-throw), nuevo fixture **`golden-execution-failed`** (fallo terminal, H4), y ampliación de `run-model-workspace-view`. Se persiste `Node.changedFiles` (aditivo) para el foco de nodo.
- **Verificación:** `pnpm web:typecheck` ✅ · `pnpm test` **728 passing + 3 skipped** ✅ · capa run-model **282 tests / 10 archivos**.

**Reencuadres:** PR10 queda **subsumido** (foco nuevo en `components/run-model/`, sin tocar el `TaskInspector` legacy); PR14 **adelantado en su parte fixture** (evidencia navegable por ref). `/runs/proto` es ahora la demo fixture-first más completa.

---

## 0b. PR11 — mitad aditiva ejecutada (2026-06-06)

**PR11 — Adaptador SSE → RunEvent** entró por su **mitad aditiva y verificable**:

- `apps/web/src/lib/run-model/sse-adapter.ts` (puro): `adaptStreamEvent` / `adaptStreamHistory` mapean el stream **legacy** (`server/runs/events.ts`, aliased como `StreamEvent` para esquivar la colisión `RunEvent` **sin** renombrar legacy) → envelope `RunEvent[]`, listo para el mismo `runStore`+reducer+selectores que ya manejan los fixtures.
- Mapeo: `planning.node.*`→`plan.node.proposed`; `planning.question`→`decision.raised{clarify}`; `gate.required`→`decision.raised{approve_plan}` (⚠ assumption); `agent.run.started`→`node.execution.started`; `agent.run.completed`→`node.verify.passed|node.execution.failed`; ruido (status/title/heartbeat/replay/cli/node.added/edge.added/risk.added/validation.completed) **descartado**. `seq` 1-based sobre la salida (mapeo no 1:1).
- Tests: `tests/run-model-sse-adapter.test.ts` (12) — mapeo por kind, pureza, y **round-trip** `adapt→reduce→project` (el run real renderiza por el modelo nuevo: nodos running/done/failed, gate clarify en el canal).
- Verificación: `pnpm web:typecheck` ✅ · `pnpm test` **740 passing + 3 skipped** ✅.

**Coarseness (por diseño):** el stream legacy es planning + ejecución gruesa; **no** emite seams/scope/waves/verify-loop/conflicts/amendments/evidence, así que el modelo puenteado es degradado (sin freshness/obsolete/seam/conflict) hasta que el backend emita `RunEvent` nativos. **Judgement calls a revisar:** `gate.required`→`approve_plan` y el descarte de `validation.completed` (redundante con `agent.run.completed` en el runner actual).

**Gated (NO ejecutado):** la **mitad de rewire** de PR11 — `RunCanvasShell`/`useLiveRun` consumiendo `runStore`+adapter y la **remoción de `nodeStatusOverrides`** + rename legacy `RunEvent`→`StreamEvent`. Toca legacy, es **no verificable sin un run Gemini real**, y necesita **flag de rollback**. Es el próximo corte.

---

## 0c. PR-N1 — Observabilidad de planning / fidelidad del puente (2026-06-06)

**Problema:** el motor (`packages/decomposer`) ya produce telemetría robusta de generación de grafo —retry+backoff, fallback opt-in D3-safe, timeout 120 s, errores clasificados (`GraphGenerationErrorDetails`)— y la emite por SSE como `planning.node.status{state: retrying|failed|fallback}`. **Pero el adapter de PR11 la descartaba**: colapsaba `planning.node.status` a un `plan.node.proposed` normal, así que un nodo que reintentó o cayó a fallback se veía idéntico a una propuesta limpia. La trazabilidad de fallos (item de robustez) se perdía justo en el puente.

**Qué aterrizó (aditivo, fixture-first, sin backend ni rewire):**
- **Eje de planning ortogonal** — nuevo evento v1 forward-compat `plan.node.status` (payload `state/attempt/maxAttempts/durationMs/errorKind/errorMessage`) y campo recordado `Node.planning` (`run-model/types.ts`). `PlanningState = generating|generated|retrying|failed|fallback`. **NO toca `ExecutionState` ni `display`** (un nodo `fallback` es un leaf propuesto normal; planning es un eje aparte, como `freshness`).
- **Reducer** — `plan.node.status` setea `node.planning`; `plan.node.proposed` preserva `planning` en re-propuestas; un estado de recuperación (`generated`) sobreescribe un `retrying` previo.
- **Selector** — `selectPlanningHealth(model)` → `{ retrying, fallback, failed, clean }` y `selectNodePlanning(model, id)`. Diagnóstico puro: **NO** alimenta `selectAttention` ni el canal de decisiones (retry/repair de planning es autónomo, no atención humana).
- **Adapter** — `planning.node.status` → `plan.node.status` fiel (retrying/failed/fallback/generated; transitorios generating/active/pending descartados). `planning.node.started` sigue → `plan.node.proposed` (sin regresión).
- **Superficie** — `focus-view.ts` expone `planning` en el foco de nodo; `focus-panel.tsx` lo renderiza (línea "Planning: <state> · intento n/m · errorKind").
- **Fixture** — `golden-planning-fallback` (7°): `n-parse` reintenta y se recupera (limpio); `n-eval` cae a fallback (degradado pero usable). Pasa todos los invariantes cross-cutting.
- **Tests** — `tests/run-model-planning-health.test.ts` (12: reducer/selector/ortogonalidad/no-en-canal/round-trip/foco) + `run-model-sse-adapter` extendido (12→17). 
- **Verificación:** `pnpm web:typecheck` ✅ · `pnpm test` **783 passing + 3 skipped** ✅.

**Por qué importa:** cierra la grieta entre "el motor lo produce" y "el modelo nuevo lo representa", y **de-riesga el rewire gated** (PR-N2): cuando el run real se conecte al modelo, los fallos/fallback de planning serán visibles en vez de enmascararse como propuestas sanas. Extensión aditiva del modelo congelado (nuevo `type`, forward-compat) — no renegocia D1–D10 ni los refinamientos A–P.

---

## 0d. Roadmap Ultracode — reorganización por eje de verificabilidad (2026-06-06)

Reemplaza el roadmap lineal PR-N2..PR-N9. **Principio:** una corrida Ultracode (sesión larga autónoma) rinde donde el "done" es **binario y automatizable** (typecheck + vitest + suite sobre fixtures), y es una trampa de falso-verde donde el valor real **solo se ve en un run Gemini vivo + browser**. Por eso el trabajo se agrupa por **eje de verificabilidad**, no por feature, y se **invierte el orden clásico**: se profundiza **toda** la superficie fixture-first en el carril autónomo, y el run real se enchufa al final sobre una UI ya completa.

| Bloque | Carril | Reemplaza | Verificación |
|---|---|---|---|
| **U-A — Reconciliation & Disposition depth** | autónomo (Ultracode) | N6 + N7 | tests cerrados ✅ |
| **U-B — Inspector & Audit depth** | autónomo (Ultracode) | N4 + N5(view-model) | tests cerrados ✅ |
| **G-1 — Rewire gated del run real** (`MANYHANDS_RUN_MODEL` flag; `nodeStatusOverrides` rollback) | gated (humano) | N2 | tests + **run Gemini real + browser** ⚠️ |
| **G-2 — Emisión nativa del envelope** (runner emite `RunEvent`; rename legacy→`StreamEvent`) | gated (humano) | N3 | contrato (tests) + **run real** ⚠️ |
| ~~E2E reproducible / grafos congelados~~ | **pospuesto** | N8 | requiere reformular la tesis (standby) |
| Doc-drift (`docs/system/04,06,07,09,10`) | trivial | — | revisión manual (plegar en G-2) |

**Molde de una unidad Ultracode:** (1) brief autocontenido (arranca en frío); (2) fixture-first (si no se prueba con golden, no es carril autónomo); (3) plan de subtareas interno; (4) gate de salida duro (`web:typecheck` + `pnpm test` verdes, invariantes cross-cutting); (5) aditivo / sin big-bang (rollback = revertir commit); (6) commit lógico + reporte.

**Secuencia:** carril autónomo `U-A → U-B` (independientes entre sí y de los gated); carril gated `G-1 → G-2` al final. **No** meter G-1/G-2 en una corrida autónoma (terminarían verdes sin renderizar un run vivo).

**U-A ✅ ejecutado (2026-06-06)** — profundidad de **disposition** + **reconciliation**, fixture-first:
- **Métricas (disposition):** `GranularityMetrics` en `types.ts` (espeja los 15+2 campos de `computeGranularityVector` **exacto**, sin importar execution-core → cableado backend futuro es mecánico) + evento v1 forward-compat `run.metrics.ready` + `RunModel.metrics` (fold cache). `selectGranularityMetrics`. Superficie: `MetricsBlock` en disposition + `EvidenceFocusView.metrics`. Fixture: `run.metrics.ready` añadido a `golden-happy-path`.
- **Progreso de integración (reconciliation):** `selectIntegrationProgress(model)` → por composite `{state: pending|ready|integrated|failed, doneChildCount/total}`, **derivado de node state existente sin evento backend nuevo**. Superficie: `IntegrationSection` + `emphasis.showIntegrationProgress/showMetrics`.
- **Tests:** `tests/run-model-disposition.test.ts` (10). **Verificación:** `pnpm web:typecheck` ✅ · `pnpm test` **793 passing + 3 skipped** ✅.
- **No tocado (frontera dura respetada):** emisión backend nativa, run real, endpoints, rewire, `nodeStatusOverrides`. La reconciliación ya estaba derivada (conflictos en `workspace-view`); no se inventaron eventos de composer-repair (necesitarían backend).

**U-B ✅ ejecutado (2026-06-06)** — Inspector & Audit depth, fixture-first:
- **Timeline / audit-trail:** `timeline-view.ts` → `buildTimelineView(events, {nodeId?})` proyecta el **event log crudo** (no el `RunModel`) en una traza cronológica tipada (categoría payload-free + título/detalle/tono/nodeId por evento; eventos desconocidos igual aparecen = audit forward-compat; incluye planning health de PR-N1 y métricas de U-A). Componente `timeline.tsx` como **lente secundario** (colapsable) en `proto-run-view`, con highlight/filtrado del nodo en foco (per-node audit). Sirve también para el run real vía el adapter (mismo `RunEvent[]`).
- **Inspector depth:** el foco de nodo ya era profundo (scope + refs diff/log `available:false` + planning + vital); U-B agrega la **historia por nodo** vía el timeline filtrado. El contrato/validación pleno sobre run real depende de endpoints `*Ref` → **gated (G-1/G-2)**, fuera del carril autónomo.
- **Tests:** `tests/run-model-timeline.test.ts` (10). **Verificación:** `pnpm web:typecheck` ✅ · `pnpm test` **803 passing + 3 skipped** ✅.

**G-1 ✅ ejecutado y cerrado para persistidos (gated, 2026-06-06)** — el run real renderiza por el modelo agent-first detrás de flag `?model=new`; el legacy queda **intacto y por default** (rollback = sacar el flag):
- `use-live-run-model.ts`: hook que consume el SSE real (`/api/runs/[id]/events`, `StreamEvent`s) y recomputa el modelo vía `adaptStreamHistory` + reducer, con baseline opcional de eventos persistidos. Núcleo puro `buildLiveRunModel(streamEvents, seed, initialEvents)` (node-testable). Recompute-from-scratch por tick (estable; `seq` no driftea).
- `app/runs/[runId]/_components/run-model-view.client.tsx`: reusa `RunFrame`/`DecisionChannel`/`WorkspaceSurface`/`Timeline`/`FocusPanel`. **Cero `nodeStatusOverrides`**. Resuelve `approve_plan`→`/approve-plan` y `clarify`→`/answer`; el resto de gates quedan read-only en el path nuevo (operar desde el legacy hasta el facade de G-2).
- `app/runs/[runId]/page.tsx`: branch por `?model=new` + seed `Run` y `initialEvents` desde el `RunRecord`.
- `server/runs/run-model-projection.ts`: proyección server-side `RunRecord → RunEvent[]` para recargas/persistidos sin depender del bus SSE efímero. Lee snapshot/contratos/scope, `livePlanningNodes`, resultados de ejecución/integración, `granularityVector`, evidencia final por refs, y conflictos de integración persistidos cuando existen. No inventa señales que el motor no produce.
- Tests: `tests/run-model-live.test.ts` (5) + `tests/run-model-record-projection.test.ts` (3). **Verificación:** `pnpm vitest run tests/run-model-live.test.ts tests/run-model-record-projection.test.ts tests/run-model-sse-adapter.test.ts` ✅ · `pnpm web:typecheck` ✅ · browser sobre run persistido `a642234e-d4af-4b4c-a69c-b2f404b34a1a?model=new` ✅.

**G-2 ✅ parcial v1 (2026-06-06)** — colisión de nombres eliminada y puente enriquecido sin big-bang nativo:
- `server/runs/events.ts`: el stream legacy ahora exporta `StreamEvent`/`StreamEventKind`/`StreamEventBase`; el envelope agent-first conserva el nombre `RunEvent`.
- `event-bus`, SSE route, runner, adapter, hook live y tests consumen `StreamEvent` directamente (sin alias `RunEvent as StreamEvent`).
- `sse-adapter.ts`: `status.changed(needs_review)` levanta `approve_plan`, `status.changed(approved/running/completed)` lo resuelve, y `completed/failed/interrupted` emite `run.completed`. El adapter sigue siendo el traductor único v1; emisión 100% nativa queda reservada hasta que `execution-core` emita señales finas de composer/repair.

**Pendiente honesto:** run Gemini vivo nuevo + browser para verificar el path completo contra ejecución real (el browser persistido ya monta); endpoints reales de inspector (`diff/log/contract` on-demand); eventos nativos finos de composer repair cuando el motor los produzca; decision facade unificado. Doc-drift de `docs/system/04,06,07,09,10` marcado el 2026-06-06.

---

## 1. Resumen ejecutivo

- **PR01–PR09 completados**, fixture-first, de forma **puramente aditiva**: todo el rediseño vive en `apps/web/src/lib/run-model/`, `apps/web/src/components/run-model/`, `apps/web/src/app/runs/proto/` y `tests/run-model-*`. **El flujo legacy no fue tocado por el rediseño.**
- **Suite:** 644 passing + 3 skipped; la capa run-model aporta **218** tests en 8 archivos.
- **Backend/SSE real: NO empezado** (PR11–13 pendientes), exactamente como estaba previsto. La experiencia se valida con los 5 fixtures golden.
- **Alineación con la visión:** alta. La superficie madura por fase, el humano queda "fuera del loop pero en comando", la UI es proyección de selectores, no hay segunda fuente de verdad, y `nodeStatusOverrides`/`execution.kind` no se usan para pintar.
- **Riesgo de proceso (no de diseño):** el working tree contiene además **trabajo previo sin commitear** (product-completion jun-2026 + ADR-0030 executor registry) ortogonal al rediseño. Conviven dos streams sin commits. Ver R1.
- **Próximo paso recomendado:** **PR-U1 (Ultracode)** — completar la experiencia fixture-first (foco polimórfico + evidencia + navegación + hardening) en una iteración larga, reencuadrando PR10 para **no** evolucionar el `TaskInspector` legacy.

---

## 2. Matriz de PRs PR01–PR14

| PR | Estado | Resultado | Tests | Archivos principales | Desviación aceptada |
|----|--------|-----------|-------|----------------------|---------------------|
| 01 Docs/baseline | ✅ completado | `docs/design/` como fuente de verdad; legacy marcado | n/a | CLAUDE.md, AGENTS.md, README.md, DECISIONS.md, `docs/design/*` | — |
| 02 Tipos | ✅ completado | Envelope `RunEvent` + entidades + payloads v1; sin `node.invalidated`; `ExecutionState` sin `stale`; `builtAgainst` | `run-model-types` (9) | `run-model/types.ts` | colisión `RunEvent` legacy diferida a PR11 (correcto) |
| 03 Fixtures | ✅ completado | 5 fixtures golden = misma forma que SSE futuro | `run-model-fixtures` (58) | `run-model/fixtures/*` | `seq`/`at` autoasignados por `_authoring` |
| 04 Reducer/store | ✅ completado | Fold puro + store subscribible; idempotente; ignora desconocidos | `run-model-reducer` (47) | `run-model/reducer.ts`, `store.ts` | — |
| 05 Selectores | ✅ completado | 12 selectores; `selectRenderableNodeState` como protección central | `run-model-selectors` (40) | `run-model/selectors.ts` | **freshness changeKind-aware** (`Seam.lastChangeKind`): firma invalida, contrato no |
| 06 Prototipo | ✅ completado | Ruta + presenter + componentes; reproduce fixtures vía runStore | `run-model-proto-render` (23) | `run-model/proto-view.ts`, `components/run-model/*`, `app/runs/proto/*` | **ruta `proto` (no `_proto`)**; **superficie propia** (no `DagCanvas`) |
| 07 Canal de decisiones | ✅ completado | 5 `kind`; vacío=éxito; resolución por fast-forward del fixture | `run-model-decision-channel` (12) | `run-model/decision-channel-view.ts`, `components/run-model/decision-channel.tsx` | resolver = avanzar a `decision.resolved` existente (sin eventos inventados) |
| 08 Superficie phase-adaptive | ✅ completado | View-model + superficie que madura por fase | `run-model-workspace-view` (15) | `run-model/workspace-view.ts`, `components/run-model/workspace-surface.tsx` | **superficie propia por columnas** (no `DagCanvas`, no board/timeline pares) |
| 09 Signo vital | ✅ completado | `NodeVital` (build/tests/retry, repair, obsolete, blocked, conflict, amendment) | `run-model-node-vitals` (14) | `run-model/workspace-view.ts`, `workspace-surface.tsx` | `repairActive` heurístico; `isAffectedByPendingAmendment` refinado (propuesta && !invalidado) |
| 10 Foco polimórfico | ✅ (vía PR-U1) | foco nuevo node/seam/conflict/decision/evidence + deep-link; legacy intacto | `run-model-focus-view` (18) + `run-model-invariants` (21) | `run-model/focus-view.ts`, `components/run-model/focus-panel.tsx` | **reencuadrado:** foco **nuevo** en `components/run-model/`, no se tocó `TaskInspector` |
| 11 SSE adapter / stream rename | ✅ ejecutado (v1) | `StreamEvent` legacy renombrado; adapter traduce status approval/outcome + planning/execution gruesa | `run-model-sse-adapter` (18) | `server/runs/events.ts`, `event-bus.ts`, `sse-adapter.ts`, `use-live-run-model.ts` | emisión nativa fina diferida hasta señales del motor |
| 12 Run real | ✅ gated | `/runs/[runId]?model=new` usa seed + `RunRecord→RunEvent[]` baseline + SSE live; legacy default intacto | `run-model-live` (5) + `run-model-record-projection` (3) + browser persistido | `/runs/[runId]`, `run-model-projection.ts`, `run-model-view.client.tsx` | pendiente run Gemini vivo nuevo |
| 13 Decision facade | ⏳ pendiente | — | — | `/api/runs/[id]/decisions/[decisionId]` | depende de PR07+PR11 |
| 14 Evidencia | 🟡 parcial (fixture + persisted refs) | fixture completo + run real proyecta evidencia final por refs (`diff://`, `narrative://`) y métricas desde `granularityVector` | focus-view/workspace-view + record-projection | `components/run-model/focus-panel.tsx`, `workspace-surface.tsx`, `run-model-projection.ts` | viewers/endpoints reales de diff/log/contract pendientes |

Conteo run-model (tras PR-U1): **282 tests en 10 archivos** (los 8 de PR01–09 + `run-model-focus-view` (18) + `run-model-invariants` (21); el resto crecieron al sumar el 6° fixture `golden-execution-failed` a sus `it.each(ALL)`). Suite total: **728 passing + 3 skipped**.

---

## 3. Matriz de alineación con la visión agent-first

| # | Dimensión | Estado | Evidencia en código | Riesgo | Acción |
|---|-----------|--------|---------------------|--------|--------|
| 1 | Sala de control continua (no pantallas) | cumplido | `proto-run-view.client.tsx`: marco · canal · superficie · debug en una vista | bajo | — |
| 2 | Evitar dashboard-first | cumplido | superficie phase-adaptive con énfasis por `mode`; sin board/timeline pares | bajo | mantener en PR10 |
| 3 | Humano fuera del loop, en comando | cumplido | repair automático = no-op sin attention; canal solo con lo que pide juicio | bajo | — |
| 4 | Canal de decisiones con su rol | cumplido | `decision-channel-view.ts` (5 kinds, vacío=éxito, contexto embebido) | bajo | resolución real = PR13 |
| 5 | Superficie madura por fase (no lista estática) | cumplido | `selectWorkspaceView.mode` + `emphasis.*` por fase | bajo | — |
| 6 | Seams como contratos de 1ª clase | cumplido | `WorkspaceSeam` (state/rev/signature/contract/lastChangeKind/affected) + edges dependencia | bajo | — |
| 7 | Verify-loop como verdad operativa | cumplido | `NodeVital` build/tests/retry; "anda" = pasa tests | bajo | — |
| 8 | stale/obsolete/failed/done claros | cumplido | `selectRenderableNodeState` + `vitalStatus`; invariante testeado en 3 archivos | bajo | — |
| 9 | UI = proyección de event log + selectores | cumplido | componentes consumen view-models; cero `execution.kind` en componentes | bajo | revisar en cada PR |
| 10 | Sin doble fuente de verdad | cumplido | reducer solo entidades; selectores derivan; sin estado derivado persistido | bajo | — |
| 11 | Lógica derivada fuera de React | cumplido | toda la derivación en `*-view.ts`/`selectors.ts` | bajo | vigilar `workspace-surface` (tamaño) |
| 12 | Fixtures como backend simulado | cumplido | `useFixturePlayback` + 5 golden; misma forma que SSE | bajo | — |
| 13 | Backend/SSE pospuesto | cumplido | nada de SSE/backend tocado por el rediseño | bajo | — |
| 14 | Algo del diseño que se esté perdiendo | parcial | falta foco polimórfico (depth on-demand) y evidencia "protagonista" plena | medio | PR10 / PR-U1 |
| 15 | Bien implementado pero sin documentar | resuelto por esta auditoría | decisiones PR06–09 ahora en §7 + evolution-and-rationale | bajo | — |
| — | Lectura de `execution` para labels (no display) | desviado correctamente | `workspace-view.executionAncillary` (agent/model/commit/cause/waitingOn) | bajo | documentado §7 |
| — | `_proto` → `proto` | desviado correctamente | `app/runs/proto/` (private folder de Next) | bajo | documentado |
| — | No reuso de `DagCanvas` | desviado correctamente | superficie propia (legacy `status` no expresa `obsolete`) | bajo | reconciliación = futuro |

---

## 4. Hallazgos técnicos

| Hallazgo | Severidad | Evidencia | Recomendación |
|----------|-----------|-----------|---------------|
| H1 — `workspace-surface.tsx` está creciendo (card + 5 secciones + callouts en un archivo) | media | ~430 líneas, varios sub-componentes | Extraer `node-card` y secciones antes de sumar el panel de foco (fold en PR-U1 cleanup) |
| H2 — Solape `proto-view` ↔ `workspace-view` | baja | `workspace-view` compone `selectProtoView` y reexpone frame/debug; `proto-view.nodes/columns/seams` ya no se renderizan (sí se testean) | Aceptable (proto-view es la base testeada). Posible fold futuro; no urgente |
| H3 — `repairActive` es heurístico | baja | `verifying && (build fail \|\| tests<total)` (repair es no-op en el reducer) | Documentado; refinar si el modelo persiste un flag de repair |
| H4 — Sin fixture con `node.execution.failed` terminal | baja | el path "failed" del vital no se ejercita con un nodo real | Agregar un golden de fallo terminal en hardening (PR-U1) |
| H5 — No existe `tests/run-model-invariants.test.ts` (lo nombra el plan §8) | baja | invariante "stale≠done" está distribuido (reducer/selectors/proto/workspace/node-vitals) | Consolidar invariantes en un archivo (fold en PR-U1) — bien cubierto hoy |
| H6 — `selectInvalidatedNodes` recomputa freshness O(n²) | baja | recursión por nodo; `workspace-view` recomputa también | Trivial a escala fixtures; memoizar si escala |
| H7 — Valores stale en docs | baja (resuelto) | plan §8 decía "426 passing" y smoke `/runs/_proto/` | Corregido en esta auditoría |
| H8 — Dos streams sin commitear en el working tree | media | `git status`: product-completion + ADR-0030 modifican `server/runs/`, `execution-core`, `TaskInspector` (+301) | Commit checkpoint del rediseño (R1). PR10/11/12 deben evitar entanglement con legacy no commiteado |
| H9 — PR10 del plan dice "evolucionar `TaskInspector`" | media | PR06–09 fueron net-new aditivos; `TaskInspector` tiene trabajo legacy no commiteado | **Reencuadrar** PR10: foco nuevo fixture-first en `components/run-model/`, no tocar el legacy |

Ningún hallazgo es **alto** ni **bloqueante**. No se detectaron bugs funcionales en la capa run-model.

---

## 5. Gaps detectados

- **G1 — Foco/inspector on-demand ausente:** ✅ **resuelto (PR-U1)** — `focus-view.ts` + `focus-panel.tsx` dan profundidad on-demand para node/seam/conflict/decision/evidence.
- **G2 — Evidencia no es plena protagonista:** ✅ **resuelto en modo fixture (PR-U1)** — evidencia navegable por ref (diff/narrativa/trace/`reExecuted·reIntegrated·preserved`/`approve_merge`). Falta el panel sobre run real (PR11+).
- **G3 — Sin navegación/selección:** ✅ **resuelto (PR-U1)** — selección polimórfica + deep-link `?focus=<kind>:<id>` que no pausa el playback.
- **G4 — Path "failed" sin fixture:** ✅ **resuelto (PR-U1)** — nuevo `golden-execution-failed` (fallo terminal) ejercita el display `failed` y health `failing`.
- **G5 — Archivo de invariantes nombrado pero inexistente:** ✅ **resuelto (PR-U1)** — `tests/run-model-invariants.test.ts` consolida los invariantes cross-cutting.

Todos los gaps de la experiencia fixture-first quedaron cerrados por PR-U1; lo que resta es backend/SSE real (PR11+).

---

## 6. PRs correctivos

| PR | Problema | Importancia | Archivos | Tests | ¿Antes de PR10? | Riesgo si se posterga |
|----|----------|-------------|----------|-------|-----------------|-----------------------|
| **PR-C1** (esta iteración) | Docs/roadmap desalineados con PR06–09 | alta | `docs/design/*`, plan §8/§11 | — | sí (hecho) | sesiones futuras trabajan contra docs viejos |
| PR-C2 | `workspace-surface` grande antes de sumar foco (H1) | media | `components/run-model/*` | render-estructura | recomendable | archivo monolítico difícil de revisar |
| PR-C3 | Invariantes dispersos + path failed sin fixture (H4/H5) | baja | `tests/`, `fixtures/` | nuevo invariants + golden-failed | opcional | cobertura algo difusa |

**Decisión:** PR-C2 y PR-C3 **no son standalone**; se **pliegan dentro de PR-U1** (subtareas de cleanup y hardening). PR-C1 se ejecuta ahora (solo docs).

---

## 7. Decisiones tomadas durante la implementación (PR06–PR09)

1. **Ruta `proto`, no `_proto`** — en el App Router de Next el guión bajo es *private folder* (no rutea). URLs reales: `/runs/proto/<fixture>`.
2. **No reutilizar `DagCanvas`** — depende del `RunGraphViewModel` legacy, cuyo enum `status` no puede expresar `obsolete` (rompería el invariante 10), y arrastra React Flow (DOM/provider, intesteable en `node`). Superficie propia por columnas. Reconciliar el canvas real es futuro.
3. **Test en entorno `node`, sin jsdom/RTL** — la verdad testeable son los view-models puros (presenter/selectores); los `.tsx` son render fino encima. Los tests son `tests/run-model-*.test.ts`.
4. **freshness changeKind-aware** — `Seam.lastChangeKind`: una enmienda de **firma** invalida consumidores; una de **contrato** no. Evita falsos positivos (p.ej. `golden-behavioral-conflict`).
5. **Resolución de decisiones por fast-forward del fixture** — `advanceFixtureToDecisionResolution` aplica eventos **existentes** hasta el `decision.resolved`; nunca inventa `seq` (respeta la idempotencia `seq ≤ cursor`).
6. **Lectura de `execution` solo para labels** — `executionAncillary` (agent/model/commit/cause/waitingOn) se usa para texto auxiliar del signo vital; el **display** siempre sale de `selectRenderableNodeState`.
7. **`repairActive` heurístico** — el repair es no-op en el reducer; se deriva de "verificando con check no-verde".
8. **`isAffectedByPendingAmendment` = enmienda propuesta && !invalidado** (PR09) — corrige el badge "enmienda" que quedaba pegado tras aplicar la enmienda (mejora sobre el snapshot global de PR08).
9. **El canal es dueño de la atención** — se quitó la `AttentionLine` del marco para no duplicar; `formatAttentionSummary` es la fuente única del copy.

---

## 8. Recomendación de próximo PR

### Opción A — PR10 normal (foco polimórfico, tal como el plan)
Implementa el panel de foco evolucionando `TaskInspector`. **Problema:** el plan dice "evolucionar `TaskInspector`", pero (a) PR06–09 fueron net-new fixture-first sin tocar legacy, y (b) `TaskInspector` tiene **+301 líneas sin commitear** de product-completion. Evolucionarlo entangla el rediseño con el legacy. **Bajo riesgo solo si se reencuadra** como componente nuevo en `components/run-model/`. Avance: medio (una pieza).

### Opción B — PR correctivo previo
Solo PR-C1 (docs, esta iteración) es necesario; PR-C2/C3 no son bloqueantes (se pliegan en U1). **No hace falta** un correctivo de código antes de seguir.

### Opción C — PR-U1 (Ultracode) — **recomendada**
Completar la **experiencia fixture-first de punta a punta** en una iteración larga: foco polimórfico (PR10 reencuadrado) + superficie de evidencia (PR14 parte fixture) + navegación/selección + deep-links + hardening + cleanup. Todo aditivo bajo `/runs/proto`, sin backend.

---

### PR-U1 — Fixture-First Control Room: Focus + Evidence + Hardening

**Objetivo.** Dejar el prototipo fixture-first como una **demo sólida y navegable** de la sala de control agent-first, cerrando la "información profunda on-demand" (foco) y la evidencia como protagonista, antes de tocar SSE/backend (PR11+).

**Alcance — incluye:**
- `run-model/focus-view.ts` (view-model puro): dado el modelo + un `FocusTarget` (`{kind, id}`), construye la vista de foco polimórfica para **node / seam / conflict / decision / evidence**.
- Selección como estado UI mínimo en `proto-run-view` + **deep-link** (`/runs/proto/<fixture>?focus=<kind>:<id>`), sin pausar el playback.
- `components/run-model/focus-panel.tsx` con 5 vistas por tipo; diff/log/diagnosis **mock por ref** (sin viewer real).
- Superficie de evidencia más sólida (sobre el `EvidenceBlock` actual): diff/tests/narrativa + `invalidationTrace` legibles; sigue por ref.
- Cleanup: extraer sub-componentes de `workspace-surface` (H1); consolidar invariantes (H5); agregar golden de fallo terminal (H4).
- Docs: actualizar `implementation-status.md` + plan (PR10/PR14 → completados parcial/total).

**Alcance — NO incluye:** backend, SSE adapter, `/runs/[runId]`, decision facade real, eliminación de `nodeStatusOverrides`, rename `RunEvent` legacy, motion sofisticada, `DagCanvas` real, evolucionar el `TaskInspector` legacy, product polish excesivo.

**Por qué Ultracode tiene sentido:** toca varios componentes coherentes manteniendo invariantes cross-cutting (stale≠done, sin estado derivado local, foco no pausa playback), requiere probar los 5 fixtures, y une UX + arquitectura (selección, deep-link, view-model de foco) — el tipo de unidad que en PRs chicos re-deriva contexto repetidamente.

**Riesgos:** PR demasiado grande; mezclar foco/evidence/cleanup; romper invariantes; sobrepulir UI; tests frágiles; deuda antes de SSE.
**Mitigaciones:** scope fixture-first; no tocar backend/legacy; tests por fixture; view-models puros; todo detrás de `/runs/proto`; commits lógicos internos; rollback fácil (es aditivo).

**Plan interno de ejecución (subtareas):**
1. Auditoría rápida del prototipo actual (este doc).
2. Diseñar `focus-view.ts` (FocusTarget + FocusView discriminado por tipo).
3. Implementar selección + deep-link (URL ↔ focus) sin pausar playback.
4. Implementar `focus-panel.tsx` con las 5 vistas (node/seam/conflict/decision/evidence).
5. Endurecer la superficie de evidencia (Disposition).
6. Tests puros de `focus-view` (por fixture y por tipo de objeto).
7. Tests de proyección mínimos (selección no pausa; foco abre por tipo).
8. Cleanup: extraer sub-componentes (H1), consolidar invariantes (H5), golden de fallo (H4).
9. Actualizar docs.
10. Correr suite completa + reporte.

**Criterios de aceptación:** prototipo navegable; la selección no pausa el playback; cada objeto clave tiene foco; evidencia final legible; sin estado derivado local; ningún nodo stale se ve `done`; los 5 fixtures pasan; suite verde; docs actualizadas.

**Verificación:** `pnpm web:typecheck` · `pnpm test` · `pnpm vitest run tests/run-model-focus-view.test.ts`.

**Recomendación final:** ejecutar **Opción C (PR-U1)**. PR10 "normal" queda subsumido (reencuadrado) dentro de U1; no hace falta correctivo de código previo (solo el doc PR-C1, ya hecho).

---

## 9. Riesgos

- **R1 — Trabajo sin commitear.** El rediseño agent-first y el product-completion previo conviven sin commits. Mitigación: hacer un commit checkpoint del rediseño (aislado: `run-model/`, `components/run-model/`, `app/runs/proto/`, `tests/run-model-*`, `docs/design/`).
- **R2 — Entanglement con legacy en PR10/11/12.** `TaskInspector`/`RunCanvasShell` tienen trabajo legacy no commiteado. Mitigación: PR10 reencuadrado (foco nuevo, no evolucionar legacy); PR11/12 recién después, con flag de rollback.
- **R3 — Crecer la UI antes del modelo.** Mitigación: foco también se deriva de un view-model puro (`focus-view.ts`); el componente solo pinta.
- **R4 — Demo sin backend genera expectativa de "está listo".** Mitigación: el copy del prototipo deja claro que es fixture-first; SSE real es PR11+.

---

## 10. Próxima Etapa: Transición al Backend Orquestador Nativo en LangGraph (2026-06-08)

Tras consolidar la experiencia del frontend en el path agent-first `/runs/[runId]` a través del puente adaptador SSE temporal (PR11/PR12), la arquitectura evoluciona hacia un backend orquestador nativo implementado con **LangGraph.js** y persistido mediante checkpoints JSON en disco.

### Cambios Clave en el Estado del Sistema:
1.  **De Adaptador SSE a Estado Nativo**: El hook de ejecución en el cliente ya no tendrá que reducir un flujo plano de eventos heredados (`StreamEvent`). En su lugar, consultará directamente el último checkpoint de LangGraph durante la carga de Next.js Server Components.
2.  **Manejo de Interrupciones en Caliente**: Las decisiones bloqueantes (`approve_plan`, `clarify` y `resolve_conflict`) se resuelven de forma unificada suspendiendo el motor con `interrupt()` y reanudándolo a través de un endpoint común `/api/runs/[id]/resume`.
3.  **Time-Travel Real (Forking)**: Habilitado nativamente gracias al historial de checkpoints en el checkpointer. La UI del canvas y chat disparará llamadas a `/api/runs/[id]/fork` que crearán nuevos registros no destructivos en la base de datos para comparar las ejecuciones paralelamente (crucial para las hipótesis de tesis).
4.  **Auto-reparación y Escalado a Humano**: Los fallos en tests de tareas hoja intentarán una auto-reparación antes de suspenderse y presentarse como tarjetas interactivas de decisión en el chat conversacional.

