# Frontier Roadmap — Backend Orchestration & Control Room (owned by Claude Fable 5)

> Reescrito el 2026-06-10 tras la auditoría de alto esfuerzo. Este documento reemplaza
> el roadmap anterior. Cada tarea incluye el hallazgo que la justifica, el diseño
> elegido y su estado. Estado: `[x]` hecho · `[/]` en curso · `[ ]` pendiente.

---

## Hallazgos de la auditoría (2026-06-10)

1. **El StateGraph de ejecución estaba roto en producción.** `executeBatchNode`
   retornaba `Send[]` directamente desde un nodo; LangGraph 1.x lo rechaza con
   `InvalidUpdateError` ("Expected node to return an object or an array containing
   at least one Command object"). Verificado empíricamente con una sonda contra la
   librería instalada. Además, `currentBatchIndex` nunca se incrementaba tras
   despachar un batch (loop infinito latente) y el grafo de ejecución no tenía
   ningún test.
2. **El resume HITL no era nativo.** `/api/runs/[id]/resume` mutaba a mano el JSON
   del checkpoint (`channel_values.userAnswers`) y relanzaba el pipeline con
   `stream(null)`. Con `interrupt()` nativo eso re-ejecuta el nodo completo (re-corre
   Gemini) y vuelve a interrumpir: el run quedaba pausado para siempre. Los payloads
   de decisión que la UI ya enviaba (`action: retry_repair | accept_failing |
   accept_conflict`) se descartaban.
3. **Interrupts dentro de nodos caros.** `interrupt()` vivía dentro de
   `executeLeafNode` (tras ejecutar el executor) y dentro del loop de integración
   de un único nodo `integrateComposite` monolítico — re-ejecutar en resume
   significaba repetir trabajo de agente y cherry-picks sobre worktrees sucios.
4. **El scheduler de riesgo estaba desconectado.** El host LangGraph llamaba a
   `scheduleTasks` con `riskMatrix: []`, `contracts: {}` y política
   `parallel_naive`: toda la inteligencia risk-aware existente era letra muerta.
5. **`runner.ts` era un god-file de 2.382 líneas** que duplicaba dentro de la web
   app lógica de dominio de `execution-core` (el repair de hojas reconstruía a mano
   worktrees, recorder, validación) y mezclaba planificación, ejecución, proyección
   de eventos y revisión de nodos.
6. **UI legacy viva detrás de `?model=legacy`** (DagCanvas/React Flow, TaskInspector,
   kanban, timeline) coexistiendo con la sala agent-first, contra la política de
   cero código legacy.
7. El Composer no validaba sintácticamente el resultado del repair (podía commitear
   archivos con marcadores de conflicto), y el GroundingAgent dependía 100% del LLM
   para el walking skeleton (sin garantía de que compile).

---

## 1. Execution StateGraph idiomático: wavefront dinámico + gates de decisión `[x]`

**Diseño.** Se reescribe el grafo de ejecución con el patrón map-reduce nativo:

```
START → prepare → [routeFrontier]
executeLeaf → waveJoin → [routeFrontier]
leafGate (interrupt) → Command(goto: Send(executeLeaf) | waveJoin)
[routeFrontier] → integrateNextComposite → [routeIntegration]
conflictGate (interrupt) → [routeIntegration]
[routeIntegration] → runValidation → END
```

- **Wavefront dinámico (sin `currentBatchIndex`)**: `routeFrontier` es un
  conditional edge que computa la frontera ejecutable (hojas sin resultado cuyas
  dependencias están resueltas) y despacha `Send`s — el único lugar válido para
  Sends. La selección de la wave delega en el scheduler scope-aware (tarea 2).
- **Reducers por identidad**: `leafResults` e `integrationResults` se fusionan por
  `taskId`/`compositeTaskId` (last-wins), de modo que un retry reemplaza el
  resultado fallido en lugar de acumular duplicados.
- **Gates baratos para HITL**: `leafGate` y `conflictGate` son nodos puros cuyo
  primer statement es `interrupt()`. Re-ejecutarlos en resume es gratis. El valor
  de resume es la decisión tipada de la UI (`retry_repair`, `accept_failing`,
  `accept_conflict`, `abort_run`).
- **Integración incremental**: `integrateNextComposite` integra exactamente un
  composite por superstep, de modo que cada composite integrado queda checkpointeado
  (mejor time-travel y resume sin repetir cherry-picks).
- Suite de tests del grafo completo con deps falsas: paralelismo, waves
  encadenadas, retry vía gate, accept-failing, conflicto de integración, resume
  desde checkpoint en disco.

## 2. Scheduler adaptativo basado en scopes (wavefront disjunto) `[x]`

**Diseño.** Nueva función pura `selectScopeAwareWave` en `@manyhands/scheduler`:
- Firma de scope por tarea: `contract.executionScope.allowedPaths` +
  `producedInterfaces[].id` (rutas de archivo).
- Solapamiento conservador de globs por prefijo literal (`src/auth/**` vs
  `src/auth/login.ts` → solapan; `src/auth/**` vs `src/billing/**` → disjuntos).
- Pares con riesgo `high`/`blocking` en la matriz de conflictos se serializan
  siempre (la matriz por fin se conecta al host de ejecución).
- Greedy en orden topológico: una tarea entra a la wave si no solapa scope ni
  riesgo con las ya seleccionadas; `maxParallel` es opcional (D9: sin tope
  artificial por defecto).
- El host LangGraph pasa la `riskMatrix` real del planning (antes: `[]`).

## 3. Composer con validación AST y reintento con feedback de compilador `[x]`

**Diseño.** `integration/syntax-check.ts` en `execution-core`:
- Tras cada repair y antes de commitear: scan de marcadores de conflicto en todos
  los archivos cambiados + diagnóstico sintáctico de TypeScript
  (`ts.createSourceFile` → parse diagnostics) para `.ts/.tsx/.mts/.cts/.js/.jsx`.
- Si el repair produjo código malformado, se re-inyecta el error exacto al
  executor en un segundo intento (máx. 2 por conflicto); si persiste, la
  integración falla con `executor_repair_failed` y el detalle del diagnóstico.

## 4. Type Extractor pleno para el GroundingAgent `[x]`

**Diseño.** `run/skeleton-scaffolder.ts` en `execution-core`:
- Scaffolding **determinista** de los `InterfaceContract` cuyo `id` es una ruta
  `.ts/.tsx`: se generan candidatos (`signature` literal, `export ${signature}`,
  firma de función con cuerpo `throw new Error("Not implemented")`) y se acepta el
  primero que parsea limpio con el compilador de TypeScript.
- **Extracción de tipos del repo**: los identificadores tipo-referencia de la firma
  se resuelven contra los exports reales del repositorio (scan AST de los archivos
  fuente) y se emiten imports relativos correctos.
- El LLM queda como fallback únicamente para contratos que no se pueden scaffoldear
  de forma determinista; todo archivo creado se valida sintácticamente antes del
  commit del esqueleto (D6).

## 5. Resume/fork nativos de LangGraph `[x]`

- `/api/runs/[id]/resume` distingue planning (flujo de preguntas existente) de
  ejecución: para ejecución construye el host compartido y reanuda con
  `new Command({ resume: decision })` — cero mutación manual de checkpoints.
- Decisiones tipadas (`ResumeDecision`) compartidas entre la UI y el host.
- `/fork` sigue clonando checkpoints inmutables (sin cambios de fondo).

## 6. Descomposición del runner god-file `[x]`

- `apps/web/src/lib/server/runs/execution-host.ts`: construcción del grafo
  compilado + deps (executeLeaf/repairLeaf/integrateComposite/validateRun) y el
  loop de streaming/interrupt-handling, compartido por start y resume.
- El repair de hojas se movió a `execution-core` (`RunExecutor.repairLeaf`),
  eliminando la duplicación de worktree/recorder/validación dentro de la web app.
- `runner.ts` queda como pipeline de planificación + façade fina de ejecución.

## 7. Eliminación de la UI legacy `[x]`

- Borrados el flag `?model=legacy`, `RunCanvasBinding`, `DagCanvas`,
  `DagWorkspace`, `RunCanvasShell`, `TaskInspector` y todos los componentes/hooks
  solo alcanzables desde esa ruta (incl. `useLiveRun`, `nodeStatusOverrides`).
- `projectRunRecordToSnapshot` y `deriveConflictList` sobreviven como librerías de
  dominio (las usa el runner para los predicted conflicts del Composer).

## 8. Sala de control multipanel `[x]`

- `react-resizable-panels` instalado e integrado en la superficie agent-first
  (workspace ⇄ panel de foco redimensionables, con persistencia de layout).

---

## Próximas fronteras (pendientes, en orden de valor)

- `[ ]` **Planning sobre LangGraph**: portar el pipeline de planificación al
  planning StateGraph (hoy el grafo existe y está testeado, pero producción corre
  el flujo event-driven con `DecomposerQuestionError`). Requiere streaming de
  eventos por nodo desde dentro del grafo (custom stream mode) sin perder los
  eventos vivos `plan.node.proposed`.
- `[ ]` **Kill duro de subprocesos** al abortar un run (hoy es cooperativo).
- `[ ]` **Visor de evidencia enriquecido** en el panel de foco (diffs colapsables,
  logs con resaltado) sobre `GET /api/runs/[id]/artifacts?ref=...`.
- `[ ]` **Re-decomposición selectiva** post-amendment: reinyectar nodos `obsolete`
  en la frontera de ejecución sin re-planificar el árbol entero.
- `[ ]` **Presupuesto de tokens por wave** con corte adaptativo (budget guard a
  nivel de scheduler, no solo wall-clock).
