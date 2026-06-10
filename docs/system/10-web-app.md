# Web App

> **Actualización 2026-06-07.** `/runs/[runId]` ya abre la sala de control
> agent-first por defecto. El legacy descrito en parte de este capítulo queda
> disponible solo con `?model=legacy`. El camino nuevo consume
> `GET /api/runs/[id]/run-events` (SSE nativo `RunEvent`), reduce el event log con
> `run-model/reducer.ts`, deriva estado con selectores, resuelve decisiones con
> `POST /api/runs/[id]/decisions/[decisionId]` y carga artefactos lazy con
> `GET /api/runs/[id]/artifacts?ref=...`.

**Archivos fuente:** `apps/web/src/`, `apps/web/src/lib/server/runs/runner.ts`, `apps/web/src/lib/graph-view-model.ts`

> **Actualizacion 2026-06-06.** Este capitulo describe la UI legacy. La fuente de
> verdad conceptual actual para UI/orquestacion es `docs/design/`. No expandir
> `RunGraphViewModel`, vistas canvas/board/timeline como modos pares,
> `nodeStatusOverrides`, ni consola CLI cruda como superficie primaria.

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

La vista default es agent-first: un marco de run persistente, canal de
decisiones, superficie phase-adaptive del DAG, panel de foco y timeline como
lectura secundaria. El estado de ejecución se deriva del `RunEvent` log; no hay
overrides imperativos por nodo.

El workspace legacy sigue disponible con `?model=legacy` durante el rollback
temporal. Lo siguiente describe ese legacy.

La vista legacy de un run activo tiene tres sub-vistas que el usuario puede alternar:

**DAG canvas:** el grafo interactivo construido sobre `@xyflow/react` (React Flow). Cada nodo es un componente React (`TaskNodeCard`) que muestra el título, tipo (root/integrator/leaf), estado actual, y opcionalmente el costo y duración. Los edges representan dependencias. Al seleccionar un nodo, el inspector lateral muestra el contrato completo: goal, acceptance criteria, scope, interfaces producidas y consumidas, diff, resultado de validación, y trazas de ejecución.

**Timeline:** los eventos del run en orden cronológico. Cada trace event emitido por el core aparece como un item en la lista — `agent_started`, `executor_completed`, `cherry_pick_conflict`, etc. Permite ver el progreso a nivel de evento granular.

**Board:** una vista kanban con columnas por estado de tarea (pending, running, done, failed). Útil para tener una visión de conjunto del avance.

### El flujo de aprobación

Cuando el run está en `needs_review`, el usuario puede:
- Ver el DAG generado y los contratos de cada hoja
- Editar el goal o las instrucciones de un nodo
- Regenerar el subárbol de un nodo (nueva llamada al Decomposer)
- Aprobar el plan completo

Solo cuando el run avanza a `approved` el servidor despacha la ejecución ### SSE y Eventos en Tiempo Real

Durante la ejecución, el cliente mantiene una conexión `EventSource` al endpoint nativo `/api/runs/[runId]/run-events`. El servidor lee y empuja en vivo los eventos `RunEvent` del log append-only persistido en formato JSONL para el run. El cliente reduce esta historia localmente usando `run-model/reducer.ts` y proyecta el DAG completo, wavefront, y estado actual a través de selectores puros. Esto evita cualquier tipo de polling y hace que la UI sea reactiva a la orquestación.

### Integración con Checkpoints de LangGraph

En lugar de reconstruir el estado de la UI haciendo polling del `RunRecord` o deduciendo eventos de manera imperativa, la web app aprovecha los checkpoints JSON generados por `JsonFileCheckpointSaver`:
- **Carga de Página Directa**: Durante la renderización inicial del Next.js Server Component de la ruta `/runs/[runId]`, el servidor consulta el último checkpoint del StateGraph con `graph.getState()` y pinta el DAG completo con paridad absoluta e inmediata.
- **Time-Travel (Viaje en el Tiempo / Forking)**: El endpoint `/api/runs/[runId]/fork` permite al usuario seleccionar cualquier checkpoint anterior en la timeline (una decisión previa o un batch anterior), clonar dicho checkpoint JSON bajo un nuevo hilo del motor, crear un registro `RunRecord` no destructivo y arrancar una ejecución alternativa para comparar resultados.

### El Canal de Decisiones y Respuestas HITL

Las interrupciones `interrupt()` del StateGraph suspenden el motor y se proyectan en el Canal de Decisiones de la UI. Cuando el usuario responde a una pregunta o resuelve un conflicto en la interfaz, la web app realiza una llamada a `POST /api/runs/[runId]/resume`, la cual inyecta la decisión en el StateGraph y ejecuta `graph.resume()` para continuar el hilo de ejecución interrumpido.

### Panel de Foco Polimórfico

El antiguo inspector de tareas (`TaskInspector`) ha sido reemplazado por un **Panel de Foco Polimórfico** (`components/run-model/focus-panel.tsx`). Este panel se activa al seleccionar cualquier entidad del espacio de trabajo (nodo, seam/costura, conflicto, decisión o evidencia) y resuelve de forma asíncrona y perezosa (lazy-load) la información profunda relacionada (`diff://`, `log://`, `contract://`, etc.) sin interrumpir el flujo visual del DAG ni mutar el modelo.

### Lab Mode

El Lab Mode determinístico original (`/lab`, `/replay/demo`) se eliminó por completo en junio 2026. La plataforma ahora expone exclusivamente ejecuciones basadas en Gemini CLI real sobre repositorios locales, midiendo el impacto de la granularidad de descomposición de manera real.

### Workspaces (`/workspaces`)

Configuración de repositorios. Un workspace define el repositorio destino y las instrucciones de contexto de planificación. El workspace se usa cuando se crea un run para provisionar el repo correspondiente.

---

## Interfaces

**El servidor expone:**
- `POST /api/runs` — Crear un run e iniciar la planificación interactiva.
- `GET /api/runs/[runId]/run-events` — Stream SSE nativo `RunEvent` para la UI agent-first.
- `POST /api/runs/[runId]/resume` — Escribe la respuesta HITL y reanuda el StateGraph de LangGraph.
- `POST /api/runs/[runId]/fork` — Bifurca un run a partir de un checkpoint histórico.
- `POST /api/runs/[runId]/decisions/[decisionId]` — Fachada para resolver decisiones interactivas (aprobación de plan, preguntas de decomposer, conflictos de merge).
- `GET /api/runs/[runId]/artifacts?ref=...` — Resuelve referencias lazy de diffs, logs y contratos para el Panel de Foco.
- `PATCH /api/runs/[runId]/nodes/[nodeId]` — Editar instrucciones de un nodo de planificación.

---

## Decisiones de diseño

El renderizado del DAG utiliza columnas adaptadas a la profundidad del grafo derivadas puramente de selectores, eliminando el componente pesado React Flow para la vista agent-first principal, lo que simplifica la interactividad.

La separación entre el StateGraph persistible y la web app mediante API REST limpia permite que el servidor y el cliente se mantengan sincronizados sin acoplamiento temporal: el cliente es una proyección pura del log de eventos y los checkpoints del motor, y el viaje en el tiempo se resuelve duplicando hilos en la base de datos de manera atómica.
