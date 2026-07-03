# Agent executors (Claude Code, Codex) y MockAgentExecutor

**Archivos fuente:** `packages/execution-core/src/executor/cli-executor.ts`,
`packages/execution-core/src/executor/profiles/claude-code.ts`,
`packages/execution-core/src/executor/profiles/codex.ts`,
`packages/execution-core/src/executor/registry.ts`,
`packages/execution-core/src/executor/factory.ts`,
`packages/execution-core/src/executor/mock.ts`,
`packages/execution-core/src/executor/types.ts`

> **Actualización 2026-06-16 (ADR-0031).** Gemini CLI fue removido. El default
> productivo es **Claude Code CLI** (`claude`, headless, `--output-format json`),
> con **Codex CLI** (`codex exec`) como alternativa seleccionable. El planning
> usa el `ClaudeCodeRecursiveDecomposer` (plan mode). El seam provider-agnóstico
> es la interfaz `AgentExecutor`; no agregar ejecutores ni cambiar el default sin
> discutir D4.

---

## Qué es

El executor traduce un conjunto de instrucciones de tarea en una invocación del
CLI del agente y captura el resultado bruto. Hay **un solo motor**,
`CliAgentExecutor`, manejado por *profiles* declarativos (uno por CLI): el profile
aporta el argv, el parseo de salida estructurada y el log scope. Agregar un CLI es
un profile nuevo + un descriptor en el registry — sin tocar el factory. El
`MockAgentExecutor` es el test double: produce resultados determinísticos sin
invocar ningún proceso externo.

---

## Responsabilidad

Invocar al agente LLM de la manera más segura posible para una ejecución headless,
y retornar exactamente lo que el agente hizo — sin interpretar ni evaluar si el
trabajo estuvo bien. La evaluación (scope check, validación) la hacen los
componentes posteriores.

---

## Cómo funciona

### La interfaz AgentExecutor

`CliAgentExecutor` y `MockAgentExecutor` implementan la misma interfaz:

```typescript
interface AgentExecutor {
  execute(options: AgentExecutorOptions): Promise<ExecutorRunOutcome>
}
```

`AgentExecutorOptions` incluye el directorio de trabajo (`cwd` — el worktree), el
archivo de instrucciones (se alimenta por stdin), el modelo, el timeout y flags de
autonomía. Es el seam provider-agnóstico: todo el pipeline habla con
`AgentExecutor`, nunca con un CLI concreto.

### Profiles (registry data-driven)

Cada CLI es un `CliExecutorProfile` con `buildArgs(options)` y un `parseOutcome`
opcional:

- **Claude Code** (`claude-code-cli`, default):
  `claude -p <directive> --model <m> --output-format json
  [--permission-mode acceptEdits | --dangerously-skip-permissions]`.
  El envelope `{ type:"result", result, usage, total_cost_usd }` da el texto de
  respuesta más usage y costo reportados (`usageSource: "reported"`).
- **Codex** (`codex-cli`):
  `codex exec --model <m> [--sandbox workspace-write |
  --dangerously-bypass-approvals-and-sandbox] --skip-git-repo-check -`. El prompt
  llega por stdin (trailing `-`). Sin envelope JSON → `usageSource: "unavailable"`.

El binario de cada CLI es configurable por env (`MANYHANDS_CLAUDE_BIN`,
`MANYHANDS_CODEX_BIN`); default `claude` / `codex`.

### Invocación

`CliAgentExecutor.execute()`:

1. Alimenta las instrucciones completas por **stdin** (sin límite de longitud de
   args).
2. Construye el argv con el `buildArgs` del profile.
3. Lanza el proceso con el driver compartido `spawnExecutorProcess` en el worktree.
4. Tapea stdout para el canal `MH_STATUS` (send-to-user) y acumula colas de
   stdout/stderr para diagnóstico.
5. Aplica el `parseOutcome` del profile (extrae usage/costo, reemplaza el envelope
   JSON por el texto de respuesta, expone errores estructurados en stderr).
6. **Timeout / abort:** mata el árbol de procesos (`taskkill /T /F` en Windows) y
   retorna un outcome no-cero. Fallas de proceso (binario faltante, spawn error)
   también devuelven outcome no-cero — el seam queda total.

### Resultado bruto

`ExecutorRunOutcome` lleva `exitCode`, `timedOut`, `stdout`/`stderr` (post-parse),
y opcionalmente `tokensIn`/`tokensOut`/`costUsd` cuando el CLI los reporta.

**Importante:** el executor no retorna "qué cambió el agente". Eso viene
exclusivamente de `git diff HEAD` en `ResultRecorder` (D5). El stdout/stderr se
persiste solo para diagnóstico.

### MockAgentExecutor

Para tests, implementa `AgentExecutor` ejecutando una función configurada en vez
de invocar un proceso: resultado exitoso, timeout, error de exit code, o incluso
simular un commit inesperado. Permite testear el pipeline completo de
`RunExecutor` (con `WorktreeManager`, `ScopeChecker`, `ResultRecorder` reales) sin
Claude/Codex instalados ni llamadas reales.

---

## Interfaces

**Recibe:** `AgentExecutorOptions`.
**Produce:** `ExecutorRunOutcome`.
**Lo invoca:** `ResultRecorder`, que llama a `execute()` y luego inspecciona el
worktree con `git diff HEAD`.

---

## Decisiones de diseño

- **stdin** para el prompt: sin límite de longitud de args ni archivo temporal
  extra.
- **Auto-aprobación headless:** `--dangerously-skip-permissions` (Claude) /
  `--dangerously-bypass-approvals-and-sandbox` (Codex) evitan el bloqueo
  interactivo. El aislamiento real viene del worktree + ScopeChecker, no del modo
  de aprobación del CLI.
- **Registry data-driven:** los executors son datos (profile + descriptor), no
  clases — una sola máquina (`CliAgentExecutor`) maneja todos los CLIs.
