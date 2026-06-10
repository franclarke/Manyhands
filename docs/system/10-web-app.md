# Web App

> **Actualización 2026-06-10.** La sala legacy (`?model=legacy`, canvas React
> Flow de `components/dag/`, kanban, timelines y `useLiveRun`) fue **eliminada
> físicamente**. `/runs/[runId]` es exclusivamente la sala de control
> agent-first: consume `GET /api/runs/[id]/run-events` (SSE nativo `RunEvent`),
> reduce el event log con `run-model/reducer.ts`, deriva estado con selectores,
> resuelve decisiones con `POST /api/runs/[id]/decisions/[decisionId]` y carga
> artefactos lazy con `GET /api/runs/[id]/artifacts?ref=...`.

**Archivos fuente:** `apps/web/src/`, `apps/web/src/lib/server/runs/` (runner,
`execution-host.ts`, `execution-state.ts`, `live-trace-store.ts`),
`apps/web/src/lib/run-model/`, `apps/web/src/components/run-model/`.

---

## Qué es

La web app es la capa de presentación del sistema: un workspace visual donde el
usuario describe una feature, revisa el plan que genera el Decomposer, supervisa
la ejecución en tiempo real e inspecciona los resultados de cada tarea. Está
construida en Next.js App Router.

---

## Responsabilidad

La web app tiene dos responsabilidades. La primera es hacer el sistema
*operable*: crear runs, aprobar planes y monitorear la ejecución. La segunda es
hacer la arquitectura *visible y defensible*: el DAG con sus nodos,
dependencias, contratos e interfaces debe poder entenderse sin leer código.

La web app no reimplementa la lógica del core — llama APIs respaldadas por los
mismos packages y muestra artefactos validados (`TaskGraph`,
`AgentTaskContract`, `RunRecord`).

---

## Cómo funciona

### Command Center (`/`)

El usuario escribe la feature en lenguaje natural, elige workspace
(repositorio), configura modelo/granularidad y crea el run. `POST /api/runs`
dispara la planificación interactiva (decomposer recursivo con eventos vivos) y
redirige al run workspace.

### Run workspace (`/runs/[runId]`)

Sala de control agent-first sobre un **layout multipanel redimensionable**
(`react-resizable-panels` v4): canal conversacional ⇄ superficie de artefactos
(DAG / Plan / Conflictos / Ejecución / Archivos) ⇄ panel de foco. El layout
persiste por arreglo de paneles (`useDefaultLayout`). El estado de ejecución se
deriva del `RunEvent` log reducido en el cliente; no hay overrides imperativos
por nodo.

### El flujo de aprobación

Con el run en `needs_review`, el usuario puede inspeccionar el DAG y los
contratos, editar nodos, regenerar subárboles y aprobar. La aprobación desde el
DecisionChannel **es** el go-ahead: el servidor transiciona a `approved` y
despacha la ejecución.

### SSE y eventos en tiempo real

El cliente mantiene un `EventSource` a `/api/runs/[runId]/run-events`. El
servidor empuja los `RunEvent` del log append-only (JSONL); el cliente reduce la
historia con `run-model/reducer.ts` y proyecta DAG, wavefront y estado mediante
selectores puros. Sin polling.

### Host de ejecución y checkpoints de LangGraph

`execution-host.ts` es el único lugar donde la web app compila y conduce el
execution StateGraph: construye las deps (RunExecutor para hojas/repair/
integración, `selectScopeAwareWave` alimentado con la riskMatrix real del
planning, validación run-level) **desde el RunRecord persistido**, de modo que
start y resume cablean idéntico tras un reinicio del proceso. Los checkpoints
(`JsonFileCheckpointSaver`, incluidos `pendingWrites`) viven en
`.manyhands/runs/checkpoints/<runId>/`.

- **Time-travel (forking)**: `POST /api/runs/[runId]/fork` clona el checkpoint
  elegido bajo un nuevo thread y crea un `RunRecord` no destructivo.

### Canal de decisiones y HITL nativo

Los `interrupt()` de los gates del StateGraph (`leafGate`, `conflictGate`)
pausan el run y se proyectan como `pendingDecision` tipada + pregunta legible en
el DecisionChannel. La respuesta del usuario — vía
`POST /api/runs/[runId]/resume` o el route de decisiones — se entrega al thread
suspendido **nativamente** con `Command({ resume })` a través de
`resumeExecutionPipeline`. Los checkpoints nunca se editan a mano.

### Panel de Foco Polimórfico

`components/run-model/focus-panel.tsx` se activa al seleccionar cualquier
entidad (nodo, seam, conflicto, decisión, evidencia) y resuelve lazy las
referencias profundas (`diff://`, `log://`, `contract://`) vía
`GET /api/runs/[id]/artifacts?ref=...`. Vive en el tercer panel redimensionable
del workspace.

### Workspaces (`/workspaces`)

Configuración de repositorios destino e instrucciones de contexto de
planificación; se usa al provisionar el repo del run.

---

## Interfaces

**El servidor expone:**
- `POST /api/runs` — Crear un run e iniciar la planificación interactiva.
- `GET /api/runs/[runId]/run-events` — Stream SSE nativo `RunEvent`.
- `POST /api/runs/[runId]/resume` — Entrega la decisión HITL al StateGraph con
  `Command({ resume })` (gates de ejecución) o reanuda la planificación
  (preguntas del decomposer).
- `POST /api/runs/[runId]/fork` — Bifurca un run desde un checkpoint histórico.
- `POST /api/runs/[runId]/decisions/[decisionId]` — Fachada del DecisionChannel
  (aprobación de plan, clarificaciones, gates de ejecución, amendments).
- `GET /api/runs/[runId]/artifacts?ref=...` — Resuelve referencias lazy para el
  Panel de Foco.
- `PATCH /api/runs/[runId]/nodes/[nodeId]` — Editar un nodo del plan.

---

## Decisiones de diseño

- El cliente es una **proyección pura** del log de eventos; el estado derivado
  (fase, salud, freshness) se recomputa en selectores, nunca se persiste.
- La separación StateGraph ⇄ web app por API REST mantiene servidor y cliente
  sin acoplamiento temporal; el viaje en el tiempo se resuelve clonando threads
  de checkpoints de forma no destructiva.
- El sistema de diseño es token-first (vocabulario `--color-*` con aliases
  legacy theme-aware); `pnpm contrast:check` valida AA+ sobre el tema oscuro.
