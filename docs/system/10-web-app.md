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
despacha la ejecución. Antes de que un plan quede aprobable, `planning-pipeline`
y `plan-approval-service` validan el grafo ejecutable: cada hoja debe tener un
`AgentTaskContract` seguro, los `taskId` deben coincidir, los paths deben ser
repo-relative y las interfaces consumidas/producidas deben cerrar.

### SSE y eventos en tiempo real

El cliente mantiene un `EventSource` a `/api/runs/[runId]/run-events`. El
servidor empuja los `RunEvent` del log append-only (JSONL); el cliente reduce la
historia con `run-model/reducer.ts` y proyecta DAG, wavefront y estado mediante
selectores puros. Sin polling.

Las decisiones de scheduling productivo también quedan en este log. Antes de
despachar una wave, `execution-host.ts` persiste el evento required
`run.scheduling.wave_selected` con policy, tareas listas, seleccionadas,
bloqueadas, razones, resumen de riesgo, fallbacks y warnings. Si ese append
falla, la wave no se lanza silenciosamente.

Los singletons en memoria que cruzan rutas (event buses, locks de append,
runner-state, abort registry, repositorios) viven anclados en `globalThis` vía
`lib/server/global-singleton.ts`: Next instancia el estado a nivel de módulo
una vez **por bundle de ruta** (y de nuevo en cada recompilación dev), así que
un `EventEmitter` a nivel de módulo fragmenta — el pipeline publicaba en una
instancia y la ruta SSE estaba suscripta a otra, y los frames en vivo nunca
llegaban.

### Host de ejecución y checkpoints de LangGraph

`execution-host.ts` es el único lugar donde la web app compila y conduce el
execution StateGraph: construye las deps (RunExecutor para hojas/repair/
integración, selección risk-aware alimentada con la riskMatrix real del
planning, evento required de wave, validación run-level) **desde el RunRecord
persistido**, de modo que start y resume cablean idéntico tras un reinicio del
proceso. Antes de construir esas deps vuelve a aplicar `assertExecutableGraph`;
las rutas de start/resume/node-run también llaman `assertExecutableRunGraph`
antes de provisionar repos o despachar background work. Los checkpoints
(`JsonFileCheckpointSaver`, incluidos `pendingWrites`) viven en
`.manyhands/runs/checkpoints/<runId>/`.

- **Time-travel (forking)**: `POST /api/runs/[runId]/fork` clona el checkpoint
  elegido bajo un nuevo thread y crea un `RunRecord` no destructivo.

### Control-plane de lifecycle

Las rutas que mutan lifecycle comparten la matriz `assertRunActionAllowed` en
`lib/server/runs/lifecycle.ts`. La validación ocurre antes de tocar el snapshot,
emitir eventos de éxito o lanzar pipelines background:

| Acción | Estados permitidos |
|--------|--------------------|
| `start` | `approved` |
| `pause` | `generating`, `running` |
| `resume` | `paused` |
| `cancel` | `generating`, `running`, `paused` |
| `answer_gate` | `paused` |
| `approve_plan` | `needs_review` |
| `replan` | `running` |
| `restart` | `interrupted`, `failed` |
| `fork` | `created`, `paused`, `needs_review`, `approved`, `interrupted`, `completed`, `completed_with_accepted`, `failed` |
| `manual_node_run` | `approved` |
| `manual_node_review` / `manual_node_rerun` | `approved`, `completed`, `completed_with_accepted`, `failed` |

`claimRunMutation` sigue dando el CAS por versión/status/gate y puede rechazar
`rejectActiveRunner`. Las rutas que entregan decisiones o relanzan ejecución
rechazan un runner in-process activo antes de arrancar otro pipeline. La excepción
intencional es el plain un-pause cooperativo: si el runner activo está detenido
en `waitWhilePlainPaused`, la ruta solo cambia `paused -> generating/running` y
no crea un segundo runner.

`cancel` persiste `interrupted`, dispara el abort cooperativo, mata procesos
registrados, hace GC best-effort de worktrees y recién entonces responde con el
evento durable `run.cancelled`. `restart` y `fork` no heredan un runner activo ni
un lock vivo; si hay uno, devuelven 409.

Limitación: `runner-state`, abort registry y repo-lock son in-process. Protegen
el runtime local y los tests, pero no son un lock distribuido ni una cola durable
cross-process.

### Canal de decisiones y HITL nativo

Los `interrupt()` de los gates del StateGraph (`leafGate`, `conflictGate`)
pausan el run y se proyectan como `pendingDecision` tipada + pregunta legible en
el DecisionChannel. La respuesta del usuario — vía
`POST /api/runs/[runId]/resume` o el route de decisiones — se entrega al thread
suspendido **nativamente** con `Command({ resume })` a través de
`resumeExecutionPipeline`. Los checkpoints nunca se editan a mano.

Los gates de ejecución se publican como decisión `clarify` con
`context.gate` (señal de que NO es una pregunta del planner) y
`context.options` = labels de las opciones del gate. La UI renderiza un botón
por opción que postea `{ answer: <label exacto> }`; el chat composer acepta las
mismas respuestas porque ambos caminos (`/decisions/[decisionId]` y `/answer`)
resuelven por el servicio compartido `execution-gate-service`. Una respuesta
inválida devuelve 400 listando las opciones válidas; un double-submit devuelve
409 (CAS por `gateId`, INV-4).

### Estado visual "gated" (derivado)

Un nodo activo (`running`/`verifying`) referenciado por una decisión blocking
pendiente se pinta `gated` ("Esperando decisión") — derivación pura en
`selectRenderableNodeState` sobre `model.decisions`, sin evento nuevo:
resolver la decisión restaura el display solo. Mientras está gated,
`repairActive` es false (nunca más "Reparando automáticamente" durante una
pausa) y el badge del run pausado mapea a `needs_review`, no a "Ejecutando".

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
