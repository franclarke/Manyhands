# Execution Graph y RunExecutor

**Archivos fuente:** `packages/orchestrator-graph/src/`,
`packages/execution-core/src/run/executor.ts`,
`packages/execution-core/src/run/grounding-agent.ts`,
`packages/execution-core/src/run/amendments-engine.ts`,
`apps/web/src/lib/server/runs/execution-host.ts`,
`apps/web/src/lib/server/runs/runner.ts`

---

## Qué Es

La ejecución de un run se coordina con un StateGraph de LangGraph. El
`RunExecutor` de `execution-core` queda como motor de bajo nivel para ejecutar y
validar nodos individuales en worktrees aislados.

## Responsabilidad

El execution graph:

- lee el `TaskGraph` aprobado;
- prepara costuras y contexto;
- selecciona waves ejecutables;
- despacha hojas en paralelo cuando es seguro;
- repara hojas cuando fallan validaciones;
- integra composites bottom-up;
- persiste checkpoints y eventos;
- produce el resultado final del run.

## Flujo

### Frontera de grafo ejecutable

Antes de preparar grounding, scheduling o worktrees, el camino productivo valida
el `TaskGraph` aprobado con `validateExecutableTaskGraph()` /
`assertExecutableGraph()`. La validación bloquea hojas sin contrato ejecutable,
contratos cuyo `taskId` no coincide con el nodo, paths inseguros, schemas
inválidos y costuras consumidas sin productor. `execution-host.ts` aplica la
misma frontera cuando reconstruye deps para el StateGraph, de modo que start y
resume no puedan alimentar al scheduler con contratos ambiguos.

### Grounding

Antes de ejecutar hojas, el `GroundingAgent` puede materializar un walking
skeleton con firmas e imports necesarios para que los agentes construyan contra
interfaces compartidas.

### Wavefront

El grafo calcula en cada superstep qué tareas están listas. La selección de wave
usa `selectScopeAwareWave`: serializa scopes que solapan y pares con riesgo alto
o bloqueante, y ejecuta el resto en paralelo dentro del límite configurado.

### Ejecución De Hojas

Cada hoja:

1. obtiene o crea un git worktree;
2. recibe instrucciones con contexto de archivos e interfaces;
3. ejecuta un `AgentExecutor`;
4. se valida con `ScopeChecker` y comandos de validación;
5. registra `git diff HEAD`;
6. deja que el orquestador haga commit si corresponde.

### Verify-Loop

Si la validación de una hoja falla, el sistema puede reingresar al mismo worktree
con el output exacto del fallo. Si agota el presupuesto de reparación, el run se
pausa en un gate humano. Reanudar no debe reejecutar trabajo accidentalmente: se
usa el checkpoint y el estado persistido.

### Validation Runner

`ChildProcessValidationRunner` ejecuta los comandos de validación (leaf, parent
y run). En win32 spawnea con `shell: true` (npm/pnpm/yarn/npx son shims `.cmd`
que `spawn` directo no resuelve — ENOENT). Comandos y args vienen del LLM, así
que pasan por `validationCommandSafetyIssues` (charset whitelist en
`@manyhands/contracts`) en dos bordes: el parse del decomposer y el runner.

Exit codes sintéticos del runner, que alimentan la clasificación de fallos:

- `124`: timeout — el kill es de árbol (`killProcessTree`, taskkill `/t` en
  win32) para no dejar huérfano al hijo real bajo cmd.exe;
- `126`: comando rechazado por la whitelist (no se spawnea);
- `127`: binario no encontrado (evento `error` sin shell, o salida
  "is not recognized…" normalizada bajo shell).

### Integración

Cuando los hijos de un composite están resueltos, el Composer integra un
composite por superstep con cherry-pick y repair semántico si hay conflicto.

### Amendments

Si una costura cambia, el motor de amendments deriva qué nodos quedan obsoletos,
limpia artefactos afectados y permite re-ejecutar solo el subgrafo necesario.

## Persistencia

- `RunRecord` guarda estado durable del run.
- `RunEvent` JSONL alimenta la UI.
- `JsonFileCheckpointSaver` permite resume/fork del StateGraph.

## Interfaces

**Recibe:** estado del grafo, dependencias reconstruidas desde el `RunRecord`,
checkpointer y canal de decisiones.

**Produce:** `RunExecutionResult`, commits, eventos, evidencia y métricas
operativas.

## Nota Histórica

Este componente ya no se documenta como instrumento de tesis. Las métricas del
run sirven para operación, diagnóstico y producto. Cualquier evaluación formal
futura se diseñará aparte.

