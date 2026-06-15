# @manyhands/execution-core

> El corazón operativo: worktrees aislados, ejecución de agentes, validación de scope, captura de evidencia e integración bottom-up.

## Rol en el pipeline

Ejecución + composición. Aquí es donde el plan se vuelve cambios reales en el repositorio.

## Conceptos clave

- **`WorktreeManager` + `SimpleGitRunner`.** Cada hoja opera en su propio git worktree/branch. `git diff HEAD` es la única fuente de verdad de lo que cambió (D5).
- **`AgentExecutor` + perfiles.** El seam por el que se invocan los agentes CLI (Gemini por defecto; también `claude-code`, `codex`). El routing elige executor por complejidad/disponibilidad.
- **`ScopeChecker`.** Después de ejecutar, valida los archivos cambiados contra `executionScope` y `forbiddenPaths` (allow-list advisory; `forbiddenPaths` es hard-fail — D7).
- **`ContextPacker`.** Arma el prompt de cada hoja con las interfaces que consume.
- **`ValidationRunner`.** Corre los comandos de validación bajo shell con whitelist; exit codes sintéticos (124 timeout, 126 rechazado, 127 ausente) alimentan la clasificación de fallos (D13).
- **`ResultRecorder`.** Captura diff, archivos cambiados y métricas.
- **`IntegrationAgent`.** Integra los hijos con `cherry-pick` bottom-up y, ante conflicto, repara semánticamente usando el `sharedInterface` y la intención de cada hijo (D8); clasifica los fallos de integración (D11).

## API pública

`WorktreeManager` · `AgentExecutor` / `registry` / `factory` · `ScopeChecker` · `ValidationRunner` · `ResultRecorder` · `IntegrationAgent` · `ContextPacker` · `RunExecutor`

## Dependencias

`@manyhands/contracts`, `@manyhands/task-graph`, `@manyhands/shared`, … **Más:** [`docs/system/04`](../../docs/system/04-run-executor.md)–[`09`](../../docs/system/09-composer.md).
