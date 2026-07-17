# @manyhands/execution-core

Package operativo actual: worktrees, git, executors, scope, validación,
resultados, integración, grounding y amendments.

## Estado de transición

El package concentra varias responsabilidades que la arquitectura objetivo
separa conceptualmente. La primera transición debe crear módulos/puertos claros
antes de decidir nuevos packages.

## Límites objetivo

- `ExecutionBaseBuilder`: inputs y manifests exactos.
- `NodeExecutor`: proceso del agente y diagnóstico.
- `ScopeEnforcer`: diff y paths adoptables.
- `ValidationService`: recipes y Evidence Matrix.
- `ArtifactRegistry` port: registro/adopción/freshness.
- `CompositeIntegrator`: manifests, conflict classification y repair.
- git/worktree adapters y Process Supervisor.

El agente no decide changed files ni success. El orquestador inspecciona git,
crea candidatos y adopta solo resultados fresh/verificados.

Las APIs actuales (`WorktreeManager`, `AgentExecutor`, `ScopeChecker`,
`ValidationRunner`, `ResultRecorder`, `IntegrationAgent`, `RunExecutor`) son
puntos de partida y deben conservarse mediante tests mientras se migran.

Ver [`docs/system/05-worktree-layer.md`](../../docs/system/05-worktree-layer.md),
[`08-result-pipeline.md`](../../docs/system/08-result-pipeline.md) y
[`09-composer.md`](../../docs/system/09-composer.md).
