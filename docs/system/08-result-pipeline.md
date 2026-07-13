# ResultRecorder y ValidationRunner

**Archivos fuente:** `packages/execution-core/src/result/recorder.ts`, `packages/execution-core/src/validation/runner.ts`

---

## Qué son

El `ResultRecorder` es el componente que toma el output bruto de una ejecución de agente y produce un `AgentExecutionResult` verificado y commiteado. El `ValidationRunner` ejecuta los comandos de validación definidos en el contrato (tests, typecheck, etc.) para determinar si el trabajo del agente es correcto.

---

## ResultRecorder

### Responsabilidad

Transformar "el proceso del executor terminó" en "sabemos exactamente qué cambió, si estuvo dentro de scope, y si el orquestador debe commitear". Es el componente que materializa la invariante D5 (git diff como verdad) y D6 (el orquestador commitea).

### Los tres caminos de un resultado

El `ResultRecorder` maneja tres situaciones distintas:

**Camino 1 — Fallo del executor:**
Si el agente terminó con un error (timeout, EPIPE, exit code ≠ 0), el recorder retorna inmediatamente con el status correspondiente (`timeout`, `executor_error`) y preserva los tails de stdout/stderr para diagnóstico. No hay nada que commitear, no hay diff que inspeccionar.

**Camino 2 — Commit inesperado detectado:**
El recorder llama a `WorktreeManager.detectUnexpectedCommit()`. Si el agente hizo un commit por su cuenta (`agentCommittedUnexpectedly: true`), se aplica la política configurada:
- `reject` (default): el resultado se descarta, el worktree se limpia, la hoja queda en `agent_committed_unexpectedly`.
- `accept`: se acepta el commit del agente, pero igualmente se valida scope y se corren los comandos de validación antes de avanzar.

**Camino 3 — Ejecución normal:**
Este es el camino feliz:
1. El staging usa `addAllExcluding` (`git add -A` menos los `DEFAULT_ARTIFACT_GLOBS`: `**/node_modules/**`, `**/dist/**`, `**/.next/**`, etc.) y `git diff --cached` captura los cambios del agente — la lista de archivos y el contenido del diff.
2. Si el diff está vacío y el agente terminó con exit 0, el resultado es `empty_diff` (el agente no hizo nada, lo cual puede ser un error de prompt o de scope).
3. `ScopeChecker.check()` valida que los archivos cambiados estén dentro del scope del contrato.
4. Si el scope check pasa, `ValidationRunner.run()` ejecuta los `leafValidationCommands`.
5. Si todo pasa, el orquestador hace `git commit` con un mensaje estructurado que incluye el taskId y el runId.
6. El recorder construye el `AgentExecutionResult` final con el diff, los archivos cambiados, el resultado del scope check, el resultado de la validación, y las métricas de duración.

Los tails de stdout/stderr se truncan a 4KB y se incluyen en el resultado para diagnóstico — la web app los muestra en el inspector del nodo cuando el agente falla, para que el usuario entienda qué pasó.

### La fuente de verdad

El `ResultRecorder` nunca mira el stdout del agente para determinar qué cambió. `git diff HEAD` es la única fuente de verdad. El agente puede decir en su stdout "modifiqué los archivos X, Y y Z" — pero si el diff no lo confirma, el recorder no lo registra.

### Higiene de artefactos (defensa en capas)

Un agente puede correr `npm install` legítimamente para testear su trabajo; lo que no puede pasar es que las dependencias terminen commiteadas (pasó en un run real contra un repo sin `.gitignore`: 4355 y 6678 archivos de `node_modules`). Defensa en tres capas, definida en `scope/artifacts.ts`:

1. **Provisioning:** `ensureGitInfoExclude` agrega los patrones default a `.git/info/exclude` del repo target (vía `--git-common-dir`, así cubre todos los worktrees del run). Idempotente, nunca toca el working tree ni el `.gitignore` del usuario.
2. **Staging:** el recorder, el grounding agent y el repair del Composer stagean con `addAllExcluding` en vez de `git add -A` pelado.
3. **Advisory de tamaño:** más de `OVERSIZED_CHANGE_THRESHOLD` (500) archivos cambiados tras el filtrado registra un `scope_advisory` con `reason: "oversized_change"` en el trace — señal de scope leak, nunca un hard fail.

Importante: los artefactos se **excluyen del commit**, no se agregan a `forbiddenPaths` — forbidden es hard-fail y mataría runs legítimos. El preflight emite un warning (no bloqueante) si el repo target no tiene `.gitignore`.

---

## ValidationRunner

### Responsabilidad

Ejecutar comandos de shell definidos en el contrato para verificar que el trabajo del agente es correcto. Es el mecanismo que conecta "el agente dijo que terminó" con "el código realmente funciona".

### Tres niveles de validación

Los comandos de validación operan en tres momentos distintos del ciclo de vida:

- **`leafValidationCommands`:** se ejecutan después de cada hoja, antes del commit del orquestador. Si fallan, la hoja queda en `validation_failed` y el resultado se descarta sin commitear. Típicamente: `pnpm test --filter <scope>`, `tsc --noEmit`.

- **`parentValidationCommands`:** se ejecutan después de integrar los hijos de un composite. Son los tests de integración que verifican que las costuras entre hojas quedaron correctas — que el tokenizer y el parser hablan el mismo idioma, por ejemplo. Si fallan, la integración queda en `validation_failed`.

- **`runValidationCommands`:** se ejecutan al finalizar el run completo. Para verificar el sistema entero con todos los cambios integrados.

### Cómo ejecuta cada comando

Cada `ExecutionValidationCommand` especifica:
- `command` y `args[]`: el ejecutable y sus argumentos
- `timeoutMs`: cuánto tiempo esperar antes de matar el proceso (default 60 segundos por comando)
- `cwd`: si ejecutar en `"worktree"` (el directorio de la hoja) o en `"repo-root"` (el directorio raíz del repositorio)

El `ValidationRunner` lanza el proceso, espera su terminación o el timeout, y retorna `{ passed: boolean, output: string, exitCode: number }`. Si el exit code es 0, pasó. Cualquier otro código es un fallo.

Detalles operativos (post-mortem Windows):

- En win32 spawnea con `shell: true` — npm/pnpm/yarn/npx son shims `.cmd` que un spawn directo no resuelve (`ENOENT`).
- Los comandos vienen del LLM: pasan por `validationCommandSafetyIssues` (charset whitelist en `@manyhands/contracts`) en el parse del decomposer y de nuevo en el runner. Un comando rechazado no se spawnea y devuelve exit `126`.
- Timeout devuelve exit `124` y mata el **árbol** de procesos (`killProcessTree`) — bajo shell, un SIGKILL al cmd.exe dejaría huérfano al proceso real.
- "Binario no encontrado" se normaliza a exit `127` aunque bajo shell el error llegue como salida de texto ("is not recognized…"). Estos tres códigos sintéticos permiten clasificar el fallo como de **infraestructura** (ver `09-composer.md`) en vez de atribuirlo al código.

---

## Interfaces

**ResultRecorder:**
- Recibe: `AgentRawResult` (del executor) + `WorktreeRecord` + `AgentTaskContract` + policy de commits inesperados
- Produce: `AgentExecutionResult` con `{ status, diff, changedFiles, scopeCheck, validationResult, stderrTail, stdoutTail, durationMs, ... }`
- Lo invoca: `RunExecutor` después de cada ejecución de agente

**ValidationRunner:**
- Recibe: lista de `ExecutionValidationCommand[]` + el path donde ejecutar
- Produce: `ValidationRunResult = { passed, output, exitCode }`
- Lo invoca: `ResultRecorder` (para leaf validation) y `IntegrationAgent` (para parent validation)

---

## Decisiones de diseño

El `ResultRecorder` es intencionalmente el único componente que commitea. Centralizar el commit aquí — en vez de dejarlo en el `RunExecutor` o en el `WorktreeManager` — garantiza que el commit solo ocurre después de que scope check y validación pasaron. Es el gate final antes de que el cambio entre al historial de git.

Los tres niveles de validación (leaf, parent, run) existen porque distintos tipos de errores aparecen en distintos momentos: un test unitario falla al nivel de hoja, un test de integración falla al nivel de composite, y un test end-to-end puede fallar solo cuando todo está integrado. Tener los tres niveles permite detectar el error lo más temprano posible.
