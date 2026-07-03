# ManyHands — Cómo Funciona El Sistema

> Descripción del sistema actual de punta a punta.
> Para decisiones vigentes, ver [`docs/DECISIONS.md`](../DECISIONS.md).
> Para el modelo agent-first de UI/orquestación, ver [`docs/design/`](../design/).

---

## Qué Hace ManyHands

ManyHands toma una feature descrita en lenguaje natural y la convierte en un run supervisable:

1. planifica un DAG jerárquico de tareas;
2. define contratos e interfaces entre tareas;
3. ejecuta hojas en git worktrees aislados;
4. captura diffs y evidencia desde el repo real;
5. integra resultados bottom-up;
6. proyecta el estado en una sala de control web.

No hay Lab Mode ni benchmark suite activos. Las métricas que aparecen en el run son evidencia operativa, no una metodología académica cerrada.

## Flujo Completo

```text
Feature prompt
    |
    v
planningGraph
    - descomposición recursiva
    - preguntas de aclaración cuando aplica
    - TaskGraph + AgentTaskContracts + sharedInterfaces
    |
    v
Plan approval / edits
    |
    v
executionGraph
    - grounding de costuras
    - selección de wave
    - ejecución aislada de hojas
    - verify-loop y gates humanos si agota reparación
    - integración bottom-up con Composer
    - validación y métricas de run
    |
    v
RunRecord + RunEvent log + checkpoints
    |
    v
Web app agent-first
    - DecisionChannel
    - artifact surface
    - focus panel
    - timeline secundaria
```

## Aislamiento

ManyHands usa dos mecanismos complementarios:

- **Git worktree aislado:** cada hoja opera en su propio directorio/branch.
- **ScopeChecker:** después de la ejecución, el orquestador valida qué archivos cambiaron contra `executionScope` y `forbiddenPaths`.

El modo de aprobación del CLI no es el límite de seguridad principal. El límite real está en worktrees, git diff y scope validation.

## Índice De Componentes

| Archivo | Componente | Qué hace |
|---------|------------|----------|
| [01-task-graph.md](01-task-graph.md) | TaskGraph + TaskNode | Modelo de datos del plan y dependencias |
| [02-contracts.md](02-contracts.md) | AgentTaskContract | Contrato entre orquestador y agente |
| [03-decomposer.md](03-decomposer.md) | ClaudeCodeRecursiveDecomposer | Transforma una feature en DAG con costuras |
| [04-run-executor.md](04-run-executor.md) | Execution graph + RunExecutor | Coordina ejecución, repair, integración y métricas |
| [05-worktree-layer.md](05-worktree-layer.md) | WorktreeManager + SimpleGitRunner | Gestiona worktrees y operaciones git |
| [06-agent-executors.md](06-agent-executors.md) | CliAgentExecutor + profiles (Claude Code, Codex) | Invoca agentes CLI y normaliza resultados |
| [07-context-and-scope.md](07-context-and-scope.md) | ContextPacker + ScopeChecker | Construye prompts y valida scope |
| [08-result-pipeline.md](08-result-pipeline.md) | ResultRecorder + ValidationRunner | Captura diff, valida y prepara commits |
| [09-composer.md](09-composer.md) | IntegrationAgent | Integra hijos con cherry-pick y repair |
| [10-web-app.md](10-web-app.md) | Web App | Command Center y sala de control |
| [11-granularity-vector.md](11-granularity-vector.md) | Run metrics | Métricas operativas del run; nombre legacy en código |
| [12-scheduler.md](12-scheduler.md) | Scheduler | Selección de waves consciente de scope/riesgo |
| [13-conflict-risk.md](13-conflict-risk.md) | conflict-risk | Predicción de riesgo de conflicto entre tareas |
| [14-repository-index.md](14-repository-index.md) | repository-index | Índice estructural del repo (grounding) |
