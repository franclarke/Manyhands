# ManyHands — Cómo funciona el sistema

> Descripción del sistema de punta a punta para alguien que llega al proyecto por primera vez.
> Lenguaje natural con tecnicismos en inglés.
> Para el contexto histórico y académico, ver [`docs/thesis/project-evolution.md`](../thesis/project-evolution.md).
> Para las decisiones de diseño cerradas, ver [`docs/DECISIONS.md`](../DECISIONS.md).

---

## Qué hace ManyHands

ManyHands toma una feature descrita en lenguaje natural y la ejecuta con múltiples agentes LLM trabajando en paralelo. Para lograrlo, primero convierte la descripción en un plan de trabajo estructurado (un DAG jerárquico de tareas), luego ejecuta cada tarea atómica en su propio entorno de git aislado, y finalmente integra los resultados de abajo hacia arriba.

El sistema tiene dos dimensiones simultáneas: es un producto visual (una web app donde el usuario puede ver el DAG, aprobar el plan y monitorear la ejecución en tiempo real) y es un artefacto de investigación (una plataforma para medir cómo la granularidad de descomposición afecta la calidad del output de agentes LLM paralelos).

---

## El flujo completo

```
Feature (lenguaje natural, desde la web app)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  GeminiRecursiveDecomposer                               │
│  Transforma la feature en un DAG jerárquico de tareas.  │
│  Cada paso de descomposición produce los hijos +        │
│  las costuras de interfaz (sharedInterface) que         │
│  los hijos paralelos deben respetar.                    │
└───────────────────────────┬─────────────────────────────┘
                            │  TaskGraph + AgentTaskContracts
                            ▼
                   [Usuario revisa y aprueba el plan]
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  RunExecutor  —  orquestador top-level                  │
│                                                         │
│   ┌─── BatchScheduler ────────────────────────────┐    │
│   │  Agrupa hojas "listas" en batches de hasta 3  │    │
│   │  respetando dependencias del grafo.            │    │
│   └────────────────────┬──────────────────────────┘    │
│                        │  por cada hoja, en paralelo    │
│                        ▼                               │
│   ┌─── WorktreeManager ───────────────────────────┐    │
│   │  Crea un git worktree aislado para la tarea.  │    │
│   │  Cada hoja parte del mismo baseCommit.        │    │
│   └────────────────────┬──────────────────────────┘    │
│                        ▼                               │
│   ┌─── FileSystemContextPacker ───────────────────┐    │
│   │  Lee archivos del worktree + interfaces        │    │
│   │  consumidas del contrato → arma el prompt.    │    │
│   └────────────────────┬──────────────────────────┘    │
│                        ▼                               │
│   ┌─── GeminiCliExecutor ─────────────────────────┐    │
│   │  Invoca `gemini --approval-mode yolo` con el  │    │
│   │  prompt por stdin. El agente trabaja en su    │    │
│   │  worktree aislado.                            │    │
│   └────────────────────┬──────────────────────────┘    │
│                        ▼                               │
│   ┌─── ScopeChecker ──────────────────────────────┐    │
│   │  Valida que el agente solo tocó los archivos  │    │
│   │  permitidos por su contrato. Deny wins.       │    │
│   └────────────────────┬──────────────────────────┘    │
│                        ▼                               │
│   ┌─── ResultRecorder ────────────────────────────┐    │
│   │  Captura `git diff HEAD` como verdad. Si      │    │
│   │  todo pasó, el orquestador hace el commit.    │    │
│   └────────────────────┬──────────────────────────┘    │
│                        ▼                               │
│   ┌─── WorktreeManager.clean() ───────────────────┐    │
│   │  Elimina el worktree del filesystem.          │    │
│   └───────────────────────────────────────────────┘    │
│                                                         │
│   [cuando todas las hojas de un composite terminan]     │
│                        ▼                               │
│   ┌─── IntegrationAgent (Composer) ───────────────┐    │
│   │  Cherry-pick de cada hijo sobre el padre.     │    │
│   │  Si hay conflicto → repair semántico con      │    │
│   │  Gemini usando el sharedInterface canónico.   │    │
│   └───────────────────────────────────────────────┘    │
│                                                         │
│   [al finalizar el run completo]                        │
│                        ▼                               │
│   ┌─── GranularityVector ─────────────────────────┐    │
│   │  Computa 17 métricas (9 pre + 8 post).        │    │
│   └───────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
                  RunRecord (persistido en JSON)
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Web App                                                 │
│  Visualiza el DAG, expone el inspector de nodos,        │
│  muestra trazas y métricas en tiempo real via SSE.      │
└─────────────────────────────────────────────────────────┘
```

---

## Las dos capas de aislamiento

ManyHands usa dos mecanismos complementarios para garantizar que un agente no interfiera con los demás:

1. **Git worktree aislado:** cada hoja opera en su propio directorio de trabajo, en su propia branch, partiendo del mismo commit base. Lo que hace un agente en su worktree es completamente invisible para los demás mientras trabaja.

2. **ScopeChecker:** después de que el agente termina, el orquestador verifica que solo tocó los archivos que su contrato le permitía. Si violó el scope, el resultado se descarta sin commitear.

El sandbox del CLI de Gemini (`--approval-mode yolo`) no es parte del mecanismo de aislamiento — simplemente evita que el proceso se bloquee esperando aprobación interactiva. El aislamiento real lo dan el worktree y el ScopeChecker.

---

## Índice de componentes

| Archivo | Componente | Qué hace |
|---------|-----------|---------|
| [01-task-graph.md](01-task-graph.md) | TaskGraph + TaskNode | El modelo de datos del plan: DAG jerárquico de tareas con dependencias, validación y estado |
| [02-contracts.md](02-contracts.md) | AgentTaskContract | El contrato entre el orquestador y un agente: qué hacer, qué tocar, cómo verificar |
| [03-decomposer.md](03-decomposer.md) | GeminiRecursiveDecomposer | Transforma una feature en el DAG, produciendo costuras de interfaz entre hojas paralelas |
| [04-run-executor.md](04-run-executor.md) | RunExecutor | El orquestador top-level: coordina batches, ejecución, integración y métricas |
| [05-worktree-layer.md](05-worktree-layer.md) | WorktreeManager + SimpleGitRunner | Crea y gestiona los entornos git aislados de cada tarea |
| [06-gemini-executor.md](06-gemini-executor.md) | GeminiCliExecutor + MockAgentExecutor | Invoca Gemini CLI como agente y captura el resultado |
| [07-context-and-scope.md](07-context-and-scope.md) | FileSystemContextPacker + ScopeChecker | Construye el prompt del agente y valida que respetó su scope |
| [08-result-pipeline.md](08-result-pipeline.md) | ResultRecorder + ValidationRunner | Captura el resultado del agente, valida, y decide si commitear |
| [09-composer.md](09-composer.md) | IntegrationAgent | Integra los resultados de hojas hermanas en su nodo padre con cherry-pick |
| [10-web-app.md](10-web-app.md) | Web App | La capa visual: Command Center, DAG canvas, inspector, SSE streaming |
| [11-granularity-vector.md](11-granularity-vector.md) | GranularityVector | Las 17 métricas que capturan la granularidad y calidad de cada run |
