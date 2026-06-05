# Estado de implementación — rediseño agent-first

> Estado **vivo** (auditoría 2026-06-05). Complementa [`implementation-plan.md`](implementation-plan.md) (el *plan*) con el **estado real** tras ejecutar PR01–PR09. Es la fuente de verdad de "qué está hecho, qué falta, qué cambió". No introduce features; documenta.

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
| 10 Foco polimórfico | ⏳ pendiente | — | — | (objetivo) foco nodo/seam/conflicto/decisión/evidencia | **reencuadre:** NO evolucionar `TaskInspector` legacy; foco **nuevo** fixture-first |
| 11 SSE adapter | ⏳ pendiente | — | — | `run-model/sse-adapter.ts` (nuevo); rename `RunEvent`→`StreamEvent` | toca legacy; elimina `nodeStatusOverrides` |
| 12 Run real | ⏳ pendiente | — | — | `/runs/[runId]`, `RunCanvasShell` | depende de PR11 |
| 13 Decision facade | ⏳ pendiente | — | — | `/api/runs/[id]/decisions/[decisionId]` | depende de PR07+PR11 |
| 14 Evidencia | 🟡 parcial (fixture) | La superficie ya muestra evidencia en Disposition (`EvidenceBlock` con `invalidationTrace`); falta el panel real sobre `selectEvidence` en run real | cubierto por proto-render/workspace-view | `components/run-model/workspace-surface.tsx` (parte fixture) | parte fixture adelantada dentro de PR08/09 |

Conteo run-model por archivo: types 9 · fixtures 58 · reducer 47 · selectores 40 · proto-render 23 · decision-channel 12 · workspace-view 15 · node-vitals 14 = **218**.

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

- **G1 — Foco/inspector on-demand ausente:** no hay forma de profundizar en un nodo/seam/conflicto/decisión/evidencia. Es la "información profunda on-demand" del diseño. → PR10 / PR-U1.
- **G2 — Evidencia no es plena protagonista:** hay `EvidenceBlock` en Disposition, pero no una superficie de evidencia con diff/narrativa/trace navegables (mock por ref). → PR14 (parte fixture) / PR-U1.
- **G3 — Sin navegación/selección:** la selección de nodo existe (`selectedNodeId`) pero no abre nada ni se refleja en URL (deep-link). → PR-U1.
- **G4 — Path "failed" sin fixture:** ver H4.
- **G5 — Archivo de invariantes nombrado pero inexistente:** ver H5.

Ninguno bloquea avanzar; todos son "completar la experiencia fixture-first".

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
