# Walkthrough — Sesión Frontier 2026-06-10 (Claude Fable 5)

Reporte de cambios de la sesión de alto esfuerzo: qué cambió, por qué, qué quedó
pendiente, y el análisis técnico post-implementación. El roadmap soberano vive en
[`docs/design/future-frontier-tasks.md`](docs/design/future-frontier-tasks.md); el plan operativo en
[`implementation_plan.md`](implementation_plan.md).

---

## 1. Qué cambió (por fase)

### F1 — Execution StateGraph idiomático (`@manyhands/orchestrator-graph`)
**Por qué.** El grafo anterior estaba roto en producción: retornaba `Send[]`
desde un nodo (LangGraph 1.x lo rechaza con `InvalidUpdateError`, verificado
empíricamente) y nunca avanzaba `currentBatchIndex`. Cero tests lo cubrían.

**Qué.** Topología nueva de wavefront dinámico:
`prepare → waveJoin ─[routeFrontier]→ Send(executeLeaf)* | leafGate | integrationJoin
→ integrateNextComposite | conflictGate → runValidation`.
- Sends solo desde conditional edges; la frontera se computa por superstep.
- Reducers por identidad (`leafResults`/`integrationResults` merge por taskId):
  un retry **reemplaza** el resultado fallido.
- Gates HITL puros (`interrupt()` como primer statement) → resume con
  `Command({ resume })` no re-ejecuta executors ni cherry-picks.
- Un composite por superstep → cada commit de integración queda checkpointeado.
- Canal renombrado `graph → taskGraph` (colisión estructural con
  `Command.graph?: string` que rompía el tipado de Commands desde nodos).
- `JsonFileCheckpointSaver` ahora persiste `pendingWrites` (interrupt marker +
  salidas de Sends hermanos) → resume válido tras reinicio del proceso.
- 8 escenarios de test del grafo completo, incluido resume cross-proceso.

### F2 — Scheduler scope-aware (`@manyhands/scheduler`)
`selectScopeAwareWave`: solape conservador de globs por prefijo literal
(serializa scopes que colisionan), pares high/blocking de la riskMatrix nunca
co-programados, scopes ausentes → paralelismo libre (D9), `maxParallel`
opcional. La riskMatrix real del planning quedó por fin conectada al host de
ejecución (antes llegaba `[]` con política `parallel_naive`). 9 tests.

### F3 — Composer AST + GroundingAgent determinista (`@manyhands/execution-core`)
- `integration/syntax-check.ts`: marcadores de conflicto + parse diagnostics de
  TypeScript sobre cada archivo reparado, **antes** de commitear.
- `IntegrationAgent.attemptRepair`: hasta 2 pasadas; la segunda re-inyecta el
  error exacto del compilador. Código malformado nunca se commitea.
- `run/skeleton-scaffolder.ts`: scaffolding determinista de InterfaceContracts
  con id-ruta TS (candidatos de rendering + validación de parse), extracción de
  tipos del repo vía `repository-index` para imports relativos correctos. El
  LLM queda como fallback solo para contratos no resolubles; todo el esqueleto
  pasa un syntax gate antes del commit (D6). 30 tests nuevos en F3.

### F4 — Host de ejecución y resume nativo (`apps/web`)
- `execution-host.ts`: deps del grafo reconstruidas desde el RunRecord
  persistido (start y resume cablean idéntico tras un restart).
- `/api/runs/[id]/resume` y el route de decisiones entregan decisiones de gate
  con `Command({ resume })`; **cero** mutación manual de checkpoints (el camino
  de amendments ahora resetea el thread y resiembra resultados supervivientes).
- Repair de hojas movido a `execution-core` (`RunExecutor.repairLeaf` +
  `WorktreeManager.recordFor`); el commit del esqueleto del GroundingAgent se
  persiste en `provisioned.baseCommit` (antes solo vivía en memoria → resume
  tras restart ramificaba desde la base equivocada).
- `runner.ts`: 2.382 → ~1.500 líneas; helpers compartidos en
  `execution-state.ts` y `live-trace-store.ts`; `pendingDecision` tipada en el
  schema y gates proyectados al DecisionChannel.

### F5 — UI: legacy fuera, multipanel dentro
- **Borrado físico** de la sala legacy: rama `?model=legacy`, `components/dag/*`
  (DagCanvas/React Flow legacy, kanban, TaskInspector, timelines), `useLiveRun`,
  `RunCanvasBinding`, `run-action-bar`, `run-header`, `run-plan-review-gate` y
  los view-models huérfanos (`graph-view-model`, `dag-layout`, `run-timeline`,
  `graph-filters`, `run-summary`, `run-phase`, `run-presentation`,
  `plan-review-actions`). Tests legacy eliminados o refactorizados a la
  proyección viva (`projectRunRecordToSnapshot`).
- **`react-resizable-panels` v4** en la sala agent-first: chat ⇄ artefactos ⇄
  panel de foco redimensionables, con persistencia por-arreglo vía
  `useDefaultLayout` (verificado en navegador: 2 layouts guardados en
  localStorage, separadores accesibles con rol `separator`).
- **Fixes de sistema de diseño** detectados en la auditoría visual:
  - `.mh-fullbleed` (breakout a viewport del canvas legacy) → reemplazado por
    `.mh-workspace-frame` que llena el `main` real (eliminado un overflow
    horizontal de ~208px que cortaba el panel de foco).
  - Header del FocusPanel reestructurado (el título quedaba a 1 carácter por
    línea en anchos chicos); mínimos de panel en píxeles.
  - `--text-1` faltaba en los aliases theme-aware → el panel de foco era
    ilegible en tema light (texto crema sobre blanco). Barrido completo de
    vars usadas vs. definidas: era la única.
  - `bg-white` hardcodeado eliminado del workspace (rompía dark mode).
  - Micro-animaciones: shimmer `mh-working` para el badge de ejecución,
    entrada `mh-panel-enter` del foco; ambas respetan `prefers-reduced-motion`.
  - Contraste: `--color-border-control` subido a ≥3:1 (WCAG no-texto) y **bug
    del script de contraste corregido** (parseaba last-wins, así que el bloque
    light pisaba al dark y validaba pares de tema cruzados; ahora first-wins).

### F6 — Validación
- `pnpm web:typecheck`: 0 errores. `pnpm -F @manyhands/execution-core typecheck`: 0 errores.
- `pnpm contrast:check`: AA+ passed.
- Suite completa en verde (ver cifra final en el resumen de la sesión).

---

## 2. Misión Especial — Análisis técnico post-implementación

### 2.1 Solidez y debilidades de los módulos nuevos

**StateGraph dinámico.**
- *Doble fuente de verdad latente*: los resultados viven en los canales del
  checkpoint **y** en `run.execution` (persistido por los deps del host). El
  repo serializa escrituras con lock por runId, así que no hay corrupción, pero
  un crash entre el write del canal y el del RunRecord puede divergirlos. La
  jugada de fondo: tratar `run.execution` como **proyección derivada** del
  checkpoint (recomputable en lectura) en lugar de estado persistido gemelo.
- *Throw en un leaf aborta el stream completo*: los deps convierten fallos de
  validación en resultados `failed`, pero una excepción inesperada (p.ej.
  fallo al crear el worktree) propaga y tumba el run entero aunque otras hojas
  de la wave hayan terminado (sus writes sí quedan en `pendingWrites`). Falta
  un cinturón try/catch por-Send que degrade a `internal_error` y deje decidir
  al gate.
- *Payload de Send pesado*: cada `Send("executeLeaf")` serializa el TaskGraph
  completo en el checkpoint. En grafos grandes esto infla cada superstep.
  Optimización directa: el dep ya captura `taskGraph` por closure — el payload
  puede reducirse a `{ runId, taskId }`.
- *Cancelación cooperativa débil*: el `AbortSignal` del run no llega a
  `RunExecutor.runNode` en el camino LangGraph; abortar deja al executor
  corriendo hasta terminar su nodo. (El hard-kill de subprocesos sigue en la
  lista de diferidos.)
- *Resume concurrente*: dos POST simultáneos a `/resume` están protegidos por
  el lock del repo + la transición de estado (el segundo ve `running` y recibe
  409), pero no hay lock de "stream en vuelo"; un guard con `isRunnerActive`
  sería más explícito.

**Scheduler scope-aware.**
- El heurístico de prefijo es deliberadamente conservador: un scope tipo
  `src/auth*` colapsa a `["src"]` y serializa contra todo `src/**`. Correcto
  para evitar colisiones, pero puede crear cuellos de botella en monorepos.
- Greedy en orden topo-alfabético sin prioridad de camino crítico: una cadena
  larga puede esperar detrás de hojas cortas disjuntas. Mejora natural:
  ordenar candidatos por profundidad de subárbol descendente.
- Si el decomposer no declara scopes, el selector es optimista (paralelismo
  libre) y la detección recae en el Composer. Se podría derivar un scope
  implícito de `contract.expectedOutput.changedFiles`.

**Composer AST.**
- El gate es **sintáctico**, no de tipos: un repair que parsea pero rompe tipos
  pasa hasta la validación del padre (que sí corre comandos). El siguiente
  nivel es un `ts.Program` incremental sobre el worktree (caro; amortizable
  reutilizando el program entre pasadas).
- *Falso positivo conocido*: la detección de `=======` puede dispararse con
  headings setext legítimos de Markdown. Mitigación pendiente: exigir
  co-ocurrencia con `<<<<<<<` en el mismo archivo antes de rechazar.
- Las 2 pasadas son fijas; no hay presupuesto de coste por conflicto ni
  decaimiento (p.ej. segunda pasada con prompt reducido solo a los archivos
  con findings).

**Host de ejecución.**
- `riskMatrixFromRun` lee `run.planning.riskMatrix` con un cast laxo; si el
  shape del planning evoluciona, falla en silencio a `[]`. Un schema zod del
  artefacto de planning cerraría el hueco.
- El patrón `LiveExecutionTraceStore` con store inyectado compartido duplica
  trazas en `executionTraces` (heredado del diseño anterior; los defaults no
  lo sufren).

### 2.2 Eficiencia de tokens y tiempos — loops de retry con feedback

Hoy cada pasada de repair re-envía el contexto completo (goal del padre, seams,
diffs de hermanos truncados a 2.000 chars, findings, hints). Propuestas en orden
de impacto:
1. **Prompt incremental en la 2ª pasada**: solo los archivos con findings, el
   diagnóstico del compilador y la instrucción de corrección — el resto del
   contexto ya está en el worktree y en el historial del intento anterior.
2. **Truncado estructurado de outputs de validación** (head+tail con marcador),
   en lugar del slice plano actual: los errores de compilador útiles suelen
   estar al principio Y al final.
3. **Presupuesto por wave en el scheduler** (ya en roadmap): cortar la wave
   cuando el coste acumulado estimado supera el budget, en vez de solo
   wall-clock global.
4. **Validación sintáctica pre-executor**: el syntax-check es ~gratis; correrlo
   también sobre los archivos cambiados de cada *leaf* (no solo repairs del
   composer) evitaría pagar una pasada de validación por comandos (`tsc`
   completo) para detectar un paréntesis sin cerrar.
5. **Reuso de `ts.SourceFile` cacheado por (path, mtime)** si el syntax gate
   escala a árboles grandes.

### 2.3 Retos arquitectónicos de las próximas fronteras

**Planning sobre LangGraph.** El grafo de planning existe y está testeado, pero
producción corre el flujo event-driven (`runMockPlanningFlow` +
`DecomposerQuestionError` como control de flujo). Retos:
- *Streaming de eventos vivos*: `plan.node.proposed` se emite hoy desde
  callbacks del decomposer; dentro del grafo habría que usar el writer de
  custom-stream de LangGraph y adaptar el SSE bridge.
- *Granularidad de pasos*: el decomposer corre la recursión completa en una
  invocación con stepCache; portarlo a un-nodo-por-decomposición exige
  refactorizar el motor recursivo a pasos puros re-entrantes (el stepCache ya
  apunta en esa dirección).
- *Preguntas como interrupts*: hoy la pregunta viaja como excepción que el
  runner captura y persiste; en el grafo es un `interrupt()` natural — la
  migración simplifica el runner pero obliga a unificar `questionAnswers` con
  el canal `userAnswers` y a versionar los checkpoints de planning.

**Re-descomposición selectiva post-amendment.** Hoy una enmienda de seam filtra
resultados, limpia worktrees y **resetea el thread** (re-siembra supervivientes).
Para re-decomponer solo el subárbol afectado:
- el canal `taskGraph` es replace-only; haría falta un reducer de graph-patches
  (o `updateState` con `asNode`) para mutar el plan mid-thread sin perder el
  historial de checkpoints;
- el bookkeeping de revisiones de seam (`seam.frozen` revision > 1) debe
  propagarse a los contratos de las hojas re-generadas;
- la higiene git se complica: ramas de hojas invalidadas deben borrarse de
  forma transaccional con el patch del plan (hoy AmendmentsEngine lo hace
  best-effort).

**Hard-kill de subprocesos.** En Windows exige `taskkill /T /F` sobre el PID del
executor (tracking de PIDs en `ProcessAgentExecutor`) y un protocolo de limpieza
de worktrees a mitad de escritura (lock + status `dirty` antes de re-crear).

### 2.4 Pasos estratégicos recomendados (próxima etapa)

1. **Send liviano + cinturón por-Send** (riesgo bajo, beneficio inmediato en
   robustez y tamaño de checkpoints).
2. **`run.execution` como proyección derivada** del checkpoint (mata la doble
   fuente de verdad — el invariante #3 de CLAUDE.md aplicado al backend).
3. **Prompt incremental en repairs** (mayor ahorro de tokens por unidad de
   esfuerzo).
4. **Planning sobre LangGraph** (cierra la asimetría planning/ejecución y
   habilita fork/time-travel también en fase de plan).
5. **Crítico de camino crítico en el scheduler** (orden por profundidad de
   subárbol) + presupuesto por wave.
6. **Tema light completo**: los aliases legacy ya son theme-aware, pero los
   estilos inline de `focus-panel`/`interrupt-card` deberían migrar al
   vocabulario `--color-*` y el bloque light merece su propio pase de QA
   visual + contraste (el script hoy valida solo el lado dark).

---

## 3. Pendientes explícitos (no son bugs)

- Planning en LangGraph, re-decomposición selectiva, hard-kill, visor de
  evidencia enriquecido y presupuesto por wave: ver "Próximas fronteras" en
  `docs/design/future-frontier-tasks.md`.
- El falso positivo de `=======` en Markdown del syntax-check (mitigación
  descrita en §2.1).
- `tests/auto-resolve-route.test.ts` y compañía fallan bajo `tsc -p tsconfig.json`
  del root por resolución de paths `@/` — preexistente al inicio de la sesión
  (el DoD usa `pnpm web:typecheck` + typecheck de execution-core, ambos en 0).
