# Web App

**Archivos fuente:** `apps/web/src/`, `apps/web/src/lib/server/runs/runner.ts`, `apps/web/src/lib/graph-view-model.ts`

---

## Qué es

La web app es la capa de presentación del sistema: un workspace visual donde el usuario puede describir una feature, revisar el plan que genera el Decomposer, supervisar la ejecución en tiempo real, e inspeccionar los resultados de cada tarea. Está construida en Next.js App Router.

---

## Responsabilidad

La web app tiene dos responsabilidades. La primera es hacer el sistema *operable*: el usuario necesita un lugar donde crear runs, aprobar planes, y monitorear qué está pasando. La segunda es hacer la arquitectura *visible y defensible*: el DAG con sus nodos, dependencias, contratos e interfaces debe poder verse y entenderse sin leer código.

La web app no reimplementa la lógica del core — llama APIs respaldadas por los mismos packages y muestra artefactos validados (`TaskGraph`, `AgentTaskContract`, `RunRecord`).

---

## Cómo funciona

### Command Center (`/`)

La página principal es el punto de entrada del flujo normal de producto. El usuario escribe una descripción de la feature en lenguaje natural, elige el workspace (repositorio), configura opcionalmente el modelo y el nivel de granularidad, y crea el run.

Internamente, esto dispara `POST /api/runs` que en el servidor:
1. Instancia el `GeminiRecursiveDecomposer` (o el baseline configurado).
2. Llama a `decompose(featureRequest)` — esto puede tomar varios segundos mientras Gemini hace las llamadas recursivas.
3. Crea el `RunRecord` con status `needs_review` y el `TaskGraph` generado.
4. Redirige al usuario al run workspace.

### Run workspace (`/runs/[runId]`)

La vista central de un run activo. Tiene tres sub-vistas que el usuario puede alternar:

**DAG canvas:** el grafo interactivo construido sobre `@xyflow/react` (React Flow). Cada nodo es un componente React (`TaskNodeCard`) que muestra el título, tipo (root/integrator/leaf), estado actual, y opcionalmente el costo y duración. Los edges representan dependencias. Al seleccionar un nodo, el inspector lateral muestra el contrato completo: goal, acceptance criteria, scope, interfaces producidas y consumidas, diff, resultado de validación, y trazas de ejecución.

**Timeline:** los eventos del run en orden cronológico. Cada trace event emitido por el core aparece como un item en la lista — `agent_started`, `executor_completed`, `cherry_pick_conflict`, etc. Permite ver el progreso a nivel de evento granular.

**Board:** una vista kanban con columnas por estado de tarea (pending, running, done, failed). Útil para tener una visión de conjunto del avance.

### El flujo de aprobación

Cuando el run está en `needs_review`, el usuario puede:
- Ver el DAG generado y los contratos de cada hoja
- Editar el goal o las instrucciones de un nodo
- Regenerar el subárbol de un nodo (nueva llamada al Decomposer)
- Aprobar el plan completo

Solo cuando el run avanza a `approved` el servidor despacha la ejecución real con el `RunExecutor`.

### SSE: ejecución en tiempo real

Durante la ejecución, el cliente mantiene una conexión `EventSource` al endpoint `/api/runs/[runId]/events`. El servidor hace polling del `RunRecord` cada 220ms y envía los patches como eventos SSE.

Cada evento es un `RunPatch` — una actualización parcial del `RunRecord` que el cliente aplica sobre su estado local. El cliente no recibe el RunRecord completo en cada tick; solo los cambios. Esto mantiene el tráfico bajo mientras el run progresa.

Cuando el run termina (con éxito o fallo), el servidor envía un evento final y cierra el stream.

### RunGraphViewModel: la capa de traducción

El `RunGraphViewModel` es la capa de view-model que traduce un `RunRecord` del core (con su `TaskGraph`, `TraceEvent[]` y `AgentExecutionResult[]`) a los tipos que necesita el canvas (`GraphNodeView[]`, `GraphEdgeView[]`, `GraphStatusCounts`).

Esta traducción existe para separar las preocupaciones: los schemas del core están optimizados para la lógica de orquestación, no para la presentación. El view-model toma decisiones de presentación — qué color tiene un nodo en estado `running`, qué texto mostrar en un edge de tipo `risk`, cómo agregar los conteos de estado — sin contaminar los schemas del core con conceptos de UI.

`GraphNodeView` incluye: id, title, kind, status, phase, depth, riskLevel, durationMs, costUsd, traceCount, y si el nodo es un integrator o tiene gate requerido.

`GraphNodeStatus` cubre todos los estados posibles: `planned`, `ready`, `running`, `gated`, `done`, `failed`, `blocked`, `generating`, `needs_review`, `approved`, `integrated`.

### Lab Mode (`/lab`)

El Lab Mode es la superficie de experimentos determinísticos. Usa el `MetadataDrivenMockDecomposer` con fixtures precargadas (`mock-v0`, `conflict-v0`) para correr runs sin invocar Gemini. Los resultados son reproducibles y sirven para validar la estructura del pipeline, el comportamiento del scheduler, y la trazabilidad — no la calidad del código producido por agentes reales.

### Workspaces (`/workspaces`)

Configuración de repositorios. Un workspace define el repositorio destino y las instrucciones de contexto de planificación. El workspace se usa cuando se crea un run para provisionar el repo fixture correspondiente.

---

## Interfaces

**El servidor expone:**
- `POST /api/runs` — crear un run (planning)
- `POST /api/runs/[runId]/approve` — aprobar el plan y disparar ejecución
- `GET /api/runs/[runId]/events` — stream SSE de eventos del run
- `PATCH /api/runs/[runId]/nodes/[nodeId]` — editar un nodo
- `POST /api/runs/[runId]/nodes/[nodeId]/regenerate` — regenerar subárbol

**El cliente consume:** `RunRecord` del store JSON, traducido a `GraphNodeView[]`/`GraphEdgeView[]` por el `RunGraphViewModel`.

---

## Decisiones de diseño

El DAG canvas usa React Flow (`@xyflow/react`) en vez de un canvas de píxeles porque los nodos son componentes React — pueden tener estado, pueden recibir props en tiempo real, y pueden incluir cualquier UI dentro de ellos. Un canvas de píxeles requeriría re-renderizar todo el grafo manualmente ante cada cambio de estado; React Flow lo hace de forma incremental.

El SSE polling (cada 220ms) en vez de WebSockets es un trade-off deliberado: SSE es unidireccional (servidor → cliente), más simple de implementar con Next.js App Router, y suficiente para la frecuencia de actualizaciones de un run. WebSockets sería más adecuado si el cliente necesitara enviar eventos frecuentes al servidor durante la ejecución, lo que hoy no es el caso.
