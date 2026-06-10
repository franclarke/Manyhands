# RunExecutor

**Archivos fuente:** `packages/execution-core/src/run/executor.ts`, `packages/orchestrator-graph/src/`, `packages/execution-core/src/run/grounding-agent.ts`, `packages/execution-core/src/run/amendments-engine.ts`, `apps/web/src/lib/server/runs/runner.ts`

> **Actualización 2026-06-10.** La ejecución de los runs y la orquestación general se han migrado de un loop secuencial ad-hoc a una arquitectura de máquina de estados formalizada usando **LangGraph.js** (`buildExecutionGraph`). El estado se persiste en disco como checkpoints JSON mediante `JsonFileCheckpointSaver`. El `RunExecutor` original ahora funciona como el motor de bajo nivel para resolver la ejecución y validación de nodos individuales de manera aislada, mientras que LangGraph gestiona la concurrencia en paralelo y el Human-in-the-Loop (HITL) mediante interrupciones nativas `interrupt()`.

---

## Qué es

El `executionGraph` compilado con LangGraph.js es el orquestador formal de la ejecución. Toma el `TaskGraph` aprobado, coordina la inicialización de firmas (Grounding), despacha las tareas hoja en paralelo respetando dependencias, ejecuta integraciones recursivas bottom-up, y computa el `GranularityVector` al finalizar.

---

## Responsabilidad

La orquestación de LangGraph no implementa directamente git ni LLM CLI, sino que define el flujo del grafo de ejecución como una serie de transiciones puras basadas en el estado del run (`RunStateAnnotation`), inyectando dependencias como `executeLeaf`, `repairLeaf`, `integrateComposite`, `validateRun` y `selectWave` desde `apps/web/src/lib/server/runs/execution-host.ts` (reconstruidas siempre desde el RunRecord persistido, para que start y resume cableen idéntico tras un reinicio).

---

## Cómo funciona

### Inicialización y Grounding (Caminos de Costura)

Antes de ejecutar las tareas del grafo, el orquestador invoca al `GroundingAgent` (`packages/execution-core/src/run/grounding-agent.ts`). Este agente analiza las interfaces especificadas en los contratos (`producedInterfaces`) y genera un **walking skeleton** (esqueleto básico con firmas de funciones, imports y archivos vacíos) en un commit inicial en la base del repositorio. Esto garantiza que todos los archivos requeridos existan con las firmas correctas y que las hojas que se ejecutarán en paralelo puedan compilar y testear contra estas costuras desde el primer momento.

### El flujo del StateGraph y Concurrencia (wavefront dinámico)

El `executionGraph` usa map-reduce nativo SIN lista de batches precomputada:
1. **Frontera por superstep**: el conditional edge `routeFrontier` computa en cada
   superstep las tareas ejecutables (sin resultado y con dependencias resueltas)
   y delega la selección de la wave en `selectScopeAwareWave`
   (`@manyhands/scheduler`): scopes que solapan y pares high/blocking de la
   riskMatrix se serializan; el resto corre en paralelo (D9).
2. **Despacho paralelo**: la frontera seleccionada se despacha como
   `Send("executeLeaf", …)` — los Sends salen exclusivamente de conditional
   edges (patrón válido de LangGraph 1.x) y convergen en la barrera `waveJoin`.
3. **Ejecución aislada**: cada Send corre `RunExecutor.runNode()` en su worktree
   git aislado (`.manyhands/worktrees/<runId>/<taskId>`).
4. **Reducers por identidad**: `leafResults`/`integrationResults` mergean por
   taskId, de modo que un retry reemplaza el resultado fallido.

### El Verify-Loop (Auto-Repair)

Si la validación de tests de una tarea hoja falla en su ejecución inicial, el nodo no falla de inmediato ni pide atención humana. En su lugar, entra en el **Verify-Loop (Auto-Repair)** de hasta **3 reintentos automáticos** (haciendo 4 ejecuciones en total por hoja):
- `RunExecutor.repairLeaf()` re-entra al worktree existente de la hoja
  (`WorktreeManager.recordFor`), inyecta el output exacto del fallo de
  validación y conserva el historial.
- Si la validación pasa dentro del presupuesto de auto-repair, el nodo queda
  completado y se publica `node.verify.passed`.
- Si el presupuesto se agota, el resultado fallido entra al estado y el gate
  puro `leafGate` lanza `interrupt({ type: "leaf_validation_failed" })`. Como el
  interrupt vive en un nodo barato (no en el nodo de ejecución), reanudar con
  `Command({ resume })` NO re-ejecuta el executor: `retry_repair` re-despacha la
  hoja, `accept_failing` desbloquea la integración (el run termina `failed` de
  forma honesta) y `abort_run` cierra el run.

### Integración y Composición Bottom-Up

`integrateNextComposite` integra exactamente UN composite por superstep (cada
commit de integración queda checkpointeado — resume y time-travel granulares),
llamando al Composer (`IntegrationAgent`).
- Si el cherry-pick genera conflictos, se aplica reparación semántica basada en
  `sharedInterface`, con gate sintáctico AST y reintento con feedback de
  compilador (ver capítulo 09).
- Si el repair falla, el gate puro `conflictGate` lanza
  `interrupt({ type: "merge_conflict", compositeTaskId })`; la decisión vuelve
  por `Command({ resume })` (`accept_conflict` | `abort_run`).

### Amendments y Invalidación en Cascada (Amending Seams)

Si el usuario enmienda en caliente la firma de un seam (interfaz) de un nodo ya integrado, o resuelve un conflicto de manera manual que afecta a las dependencias, el motor de enmiendas (`packages/execution-core/src/run/amendments-engine.ts`) entra en acción:
- Analiza la costura modificada e identifica todos los nodos descendientes (consumidores) en cascada.
- Marca estos nodos dependientes como `obsolete` en el event log (los registros históricos y evidencias se mantienen como obsoletos, respetando el principio "Obsoleto !== Fallo").
- Realiza un restablecimiento git de sus branches/worktrees.
- Invalida los checkpoints futuros y programa el wavefront de re-ejecución del sub-grafo afectado en el scheduler para volver a ejecutarlos en base a las nuevas firmas enmendadas.

### Trazas y Checkpoints

Todas las transiciones de nodos, salidas de CLI, iteraciones del verify-loop e inicios/cierres de integraciones publican eventos en el `LiveExecutionTraceStore`, el cual alimenta en tiempo real la UI a través del SSE nativo `RunEvent`.
El checkpointer JSON (`JsonFileCheckpointSaver`) guarda una instantánea exacta del StateGraph en cada paso del flujo. Esto permite recargar instantáneamente el DAG completo desde disco en Next.js Server Components, y habilita el time-travel (viaje en el tiempo/forking) copiando un checkpoint anterior e inicializando un nuevo hilo de ejecución.

---

## Interfaces

**Recibe:** `RunStateAnnotation` (estado del grafo), `JsonFileCheckpointSaver` para disco y el canal de decisiones para interactuar.

**Produce:** `RunExecutionResult` estructurado con la validación de run completa, la rama final aplicada en el repositorio, y el `GranularityVector` de métricas de la tesis.

**Depende de:** `JsonFileCheckpointSaver`, `GroundingAgent`, `RunExecutor`, `IntegrationAgent`, `amendments-engine.ts`, `LiveExecutionTraceStore`.

---

## Decisiones de diseño

La migración a LangGraph.js formaliza el ciclo de vida del orquestador y elimina bugs de sincronización y dobles fuentes de verdad. La persistencia de checkpoints basada en archivos JSON es ligera, fácil de leer y testear, y proporciona la base matemática para clonar ejecuciones y contrastar el impacto de la granularidad de manera reproducible.

