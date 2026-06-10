# ManyHands — Guía Operativa para Agentes de Código

> Esta es la guía de contexto primaria para ti (Claude Fable 5) y otros agentes trabajando en este repositorio.
> Desarrollador principal: Francisco. Comunicación de chat: Español. Código y comentarios: Inglés.
> Fuente de verdad de decisiones: [`docs/DECISIONS.md`](docs/DECISIONS.md) y ADRs en `docs/adr/`.
> Narrativa de la tesis y evolución: [`docs/thesis/project-evolution.md`](docs/thesis/project-evolution.md).
> Rediseño agent-first de UI y orquestación: [`docs/design/`](docs/design/).

---

## 1. Visión del Producto y Objetivo Técnico

**ManyHands** es un sistema de orquestación de agentes de lenguaje de gran tamaño (LLM) diseñado para el desarrollo autónomo de software. El sistema toma una feature descrita en lenguaje natural, la descompone recursivamente en un grafo acíclico dirigido (DAG) jerárquico de tareas con contratos de interfaz explícitos (`sharedInterface`), y ejecuta las tareas hoja (Leaf Tasks) de forma paralela en entornos git aislados utilizando **Gemini CLI** (`gemini`, headless). Finalmente, el sistema integra recursivamente los resultados de abajo hacia arriba utilizando cherry-picks de git y reparación semántica guiada por el LLM en caso de conflictos.

### Objetivo Técnico del Sistema:
1. **Paralelismo Real y Aislamiento**: Permitir que múltiples subagentes trabajen concurrentemente en el mismo repositorio sin interferencias mutuas, garantizado mediante git worktrees independientes y validación sintáctica/de alcance por `ScopeChecker`.
2. **Orquestación Resiliente y Transparente**: Proporcionar una sala de control en tiempo real (web app Next.js) que proyecte el estado exacto del StateGraph de **LangGraph.js**, persistido mediante checkpoints en disco, soportando la reanudación interactiva (HITL) y el viaje en el tiempo (Forking).
3. **Validación Científica (Tesis)**: Medir el impacto de la agresividad de descomposición (`low | medium | high`) sobre la calidad y el acoplamiento del software a través del vector de 17 métricas (`GranularityVector`).

---

## 2. Invariantes del Sistema (NO Modificar sin Consultar)

| ID | Invariante |
|----|------------|
| **D1** | `graph.dependencies` es el modelo canónico. Mutation solo vía `addDependency`/`removeDependency`/`syncNodeDependencies`. |
| **D2** | El campo canónico de la intención de un nodo de tarea es `goal`, nunca `intent`. |
| **D3** | Si el LLM falla, el run falla de inmediato con un error útil y accionable. No se permiten fallbacks silenciosos ni planificaciones genéricas. |
| **D4** | **Gemini CLI** (`gemini`, headless, stdin) es el único executor e-flight de subagentes y planning. Se inyecta mediante la interfaz `AgentExecutor`. Claude Code CLI está disponible como alternativo opt-in (ADR-0030). |
| **D5** | `git diff HEAD` es la única fuente de verdad para el resultado de un agente. No confíes en su stdout para determinar qué cambió. |
| **D6** | **El orquestador commitea; los agentes nunca.** Si un agente genera un commit inesperado en su worktree, la política por defecto es `reject`. |
| **D7** | El aislamiento real proviene del git worktree aislado + `ScopeChecker` de límites de archivos. El CLI de subagentes corre en `--approval-mode yolo`. |
| **D8** | Integración bottom-up vía cherry-pick + reparación semántica asistida por LLM en caso de conflictos (máx. 1 intento automático). |
| **D9** | `maxParallel = 6` hojas en ejecución paralela concurrentes (configurable en `ExecutionConfig`). |
| **D10**| Timeouts: hoja 300 s, integración 600 s (configurables individualmente en contratos). |

---

## 3. Arquitectura del Monorepo y Componentes Clave

Monorepo gestionado con `pnpm`. La regla de dependencias es estrictamente unidireccional: `apps → packages → shared`. Nunca importes desde `apps` dentro de un paquete.

### Paquetes Principales (`packages/`):
- [`task-graph`](file:///c:/Users/franc/Documents/Manyhands/packages/task-graph/src/index.ts): Modelos `TaskNode` y `TaskGraph`, validaciones topológicas y de ciclos.
- [`contracts`](file:///c:/Users/franc/Documents/Manyhands/packages/contracts/src/index.ts): Especificación de contratos de tareas (`AgentTaskContract` y `InterfaceContract`).
- [`orchestrator-graph`](file:///c:/Users/franc/Documents/Manyhands/packages/orchestrator-graph/src/): Los StateGraphs de LangGraph.js:
  - `planning-graph.ts`: Construcción del plan interactivo de forma recursiva.
  - `execution-graph.ts`: Orquestador Map-Reduce de concurrencia y bottom-up merge.
  - `checkpointer.ts`: `JsonFileCheckpointSaver` para persistir checkpoints JSON en disco.
- [`execution-core`](file:///c:/Users/franc/Documents/Manyhands/packages/execution-core/src/): Motores de ejecución agénticos y auxiliares:
  - `run/executor.ts`: `RunExecutor` que ejecuta y valida nodos de forma individual y aislada.
  - `run/grounding-agent.ts`: `GroundingAgent` que inicializa el walking skeleton de interfaces antes de ejecutar hojas.
  - `run/amendments-engine.ts`: Motor de invalidación en cascada que marca nodos dependientes como `obsolete` y limpia sus worktrees ante enmiendas de costuras.
  - `integration/agent.ts`: Composer que realiza cherry-picks e invoca reparación semántica.

### Aplicación Web (`apps/web/`):
- [`src/lib/server/runs/runner.ts`](file:///c:/Users/franc/Documents/Manyhands/apps/web/src/lib/server/runs/runner.ts): Wired top-level de Next.js que compila los grafos de LangGraph, inyecta callbacks y corre los pipelines.
- [`src/app/api/runs/[id]/resume/route.ts`](file:///c:/Users/franc/Documents/Manyhands/apps/web/src/app/api/runs/%5Bid%5D/resume/route.ts) y [`fork/route.ts`](file:///c:/Users/franc/Documents/Manyhands/apps/web/src/app/api/runs/%5Bid%5D/fork/route.ts): Endpoints para reanudar e interactuar con el StateGraph de LangGraph.
- [`src/lib/run-model/`](file:///c:/Users/franc/Documents/Manyhands/apps/web/src/lib/run-model/): Modelos de datos agent-first. Reducer (`reducer.ts`), selectores (`selectors.ts`) y view-models. La UI consume únicamente selectores; no leas el modelo crudo.

---

## 4. Guías para Desarrollo de UI/UX y Frameworks Frontend

La interfaz de la web app debe emular la calidad de las herramientas líderes en IA (minimalista, fluida, responsive, multipanel). 

### 1. Frameworks y Librerías Requeridas
Audita su instalación en `apps/web/package.json` y utilízalas de forma consistente e idiomática:
- **`assistant-ui`**: Para renderizar el chat interactivo, hilos y estados de pensamiento/ejecución del orquestador.
- **`Agent Elements`** y **`Vercel AI Elements`**: Para representaciones visuales de flujos agénticos y estados de ejecución.
- **`shadcn/ui`** y **`Radix UI`**: Componentes primarios accesibles (Dialogs, Tooltips, Tabs, Popovers, Accordions, DropdownMenus).
- **`react-resizable-panels`**: Para layouts multipanel (ej. panel lateral de foco, consola de trazas, canvas central) que el usuario pueda redimensionar con suavidad.
- **`Tailwind CSS`** (v4.0.0+): Sistema de tokens, variables y colores HSL balanceados. Evita colores planos genéricos.

### 2. Principios del Sistema de Diseño
- **Obsoleto !== Fallado (Principio P6)**: Los nodos invalidados por enmiendas de seams se pintan como `obsolete` en color gris/ámbar suave y se mantiene su historial. No se eliminan ni muestran como rojos.
- **Canal de Decisiones Unificado**: Todos los gates de interacción humana (HITL) se proyectan en el `DecisionChannel` con copy contextual claro.
- **Panel de Foco Polimórfico**: El inspector lateral de foco debe reaccionar inmediatamente a clics sobre nodos, costuras (seams), conflictos o evidencia. Carga información perezosa usando `GET /api/runs/[id]/artifacts?ref=...`.

---

## 5. Guías de Integración y Trabajo con LangGraph

- **State y Checkpoints**: El StateGraph utiliza checkpoints almacenados en `.manyhands/checkpoints/<runId>/`. Al modificar el StateGraph, asegura que la serialización JSON de `JsonFileCheckpointSaver` no se rompa.
- **HITL (Human-in-the-Loop)**: Utiliza `interrupt()` nativo de LangGraph en los nodos de planificación (ante preguntas del decomposer o aprobación de plan) y de ejecución (ante conflictos insalvables de merge o agotamiento de los 3 reintentos automáticos del verify-loop).
- **Time-Travel (Forking)**: El forking clona el checkpoint JSON de un `thread_id` a un nuevo `runId` en la base de datos de manera no destructiva, inicializando un nuevo StateGraph a partir del estado de ese checkpoint.

---

## 6. Principios de Calidad de Código (John Ousterhout / Clean Code)

1. **Clases y Módulos Profundos (Deep Modules)**: Diseña interfaces de paquetes pequeñas y encapsuladas. Oculta los detalles de bajo nivel.
2. **Métodos Pequeños y Descriptivos**: Los métodos en los StateGraphs y ejecutores deben tener una sola responsabilidad clara y nombres legibles.
3. **Evita la Doble Fuente de Verdad**: El estado derivado (fase, salud, freshness del seam) jamás debe persistirse imperativamente. Se recomputa mediante la capa de selectores de `src/lib/run-model/selectors.ts`.
4. **Manejo de Errores Tipados**: Utiliza la jerarquía de excepciones en `packages/execution-core/src/errors.ts` y propaga los fallos de Gemini CLI de forma descriptiva.

---

## 7. Flujo de Trabajo para Tareas (Definición de "Terminado")

Para dar una tarea por completada, debes asegurar los siguientes pasos:
1. **Compilación Estricta**:
   - `pnpm web:typecheck` no debe arrojar errores.
   - `pnpm -F @manyhands/execution-core typecheck` debe compilar limpio.
2. **Suite de Tests**:
   - Todos los tests de la suite (`pnpm test`) deben estar en verde (847 tests exitosos).
   - Escribe tests unitarios o de integración en `tests/` para cualquier nueva funcionalidad introducida.
3. **Auditoría de UI/UX**:
   - La interfaz debe funcionar de manera fluida en el navegador.
   - Comprueba la accesibilidad Radix y que no haya roturas en layouts responsivos de `react-resizable-panels`.
4. **Validación de Invariantes**:
   - Corre la verificación de invariantes en `tests/run-model-invariants.test.ts`.
5. **Documentación**:
   - Actualiza los documentos afectados en `docs/system/` o `docs/design/` para reflejar la realidad técnica de tus cambios.

---

## 8. Guía para Sesiones de Alto Esfuerzo (High-Effort / Long Execution)

Cuando operes en modo de alto esfuerzo en esta sesión:
- **Plan de Trabajo Primero**: Si la tarea es compleja, crea o actualiza `implementation_plan.md` en el directorio de artefactos de Gemini y espera la aprobación.
- **Paso a Paso Controlado**: Escribe archivos modularmente. Realiza typechecks e integra incrementalmente. No modifiques múltiples partes del sistema a la vez de forma desordenada.
- **Rastreo de TODOs**: Utiliza `task.md` para marcar tu progreso con `[ ]`, `[/]`, y `[x]`.
- **Commits de Checkpoint**: Haz commits locales de checkpoints funcionales con la firma de coautoría adecuada:
  ```bash
  git commit -m "feat/refactor(modulo): descripcion de la mejora" -m "Co-Authored-By: Claude Fable 5 <claude@anthropic.com>"
  ```
