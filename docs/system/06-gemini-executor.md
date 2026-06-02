# GeminiCliExecutor y MockAgentExecutor

**Archivos fuente:** `packages/execution-core/src/executor/gemini-cli.ts`, `packages/execution-core/src/executor/mock.ts`, `packages/execution-core/src/executor/types.ts`

---

## Qué es

El `GeminiCliExecutor` es el componente que traduce un conjunto de instrucciones de tarea en una invocación de Gemini CLI y captura el resultado bruto. El `MockAgentExecutor` es su test double — produce resultados determinísticos sin invocar ningún proceso externo.

---

## Responsabilidad

Esta capa tiene una responsabilidad única y bien delimitada: invocar el agente LLM de la manera más segura posible para una ejecución headless, y retornar exactamente lo que el agente hizo — sin interpretar ni evaluar si el trabajo estuvo bien. La evaluación (scope check, validación) la hacen los componentes posteriores.

---

## Cómo funciona

### La interfaz AgentExecutor

Tanto el `GeminiCliExecutor` como el `MockAgentExecutor` implementan la misma interfaz `AgentExecutor`:

```typescript
interface AgentExecutor {
  execute(options: AgentExecutorOptions): Promise<AgentRawResult>
}
```

El `AgentExecutorOptions` incluye: el directorio de trabajo (`cwd` — el worktree), el contenido del prompt (las instrucciones de la tarea), el modelo a usar, y el timeout en milisegundos.

Esta interfaz es el seam provider-agnóstico del sistema. Todo el pipeline de ejecución habla con `AgentExecutor`, nunca con `GeminiCliExecutor` directamente. Reemplazar Gemini por otro CLI en el futuro requiere solo un nuevo adapter que implemente esta interfaz.

### Invocación de Gemini CLI

El `GeminiCliExecutor.execute()` hace lo siguiente:

1. **Escribe las instrucciones a un archivo temporal.** El prompt completo (objetivo, archivos de contexto, interfaces consumidas, acceptance criteria, todo) se escribe a un archivo en el worktree. El proceso de Gemini lo leerá desde stdin.

2. **Construye los argumentos del CLI:**
   - `--model <model>` — el modelo a usar
   - `--approval-mode yolo` — auto-aprueba todas las tool calls sin intervención humana. Sin esto, Gemini se bloquearía esperando que alguien confirme cada acción
   - `--skip-trust` — evita el prompt interactivo de confianza en el primer run
   - `-o text` — output en texto plano
   - `-p STDIN_DIRECTIVE` — indica a Gemini que lea el prompt desde stdin

3. **Lanza el proceso** con `child_process.spawn()` en el directorio del worktree. El prompt se envía por stdin.

4. **Monitorea** stdout y stderr, acumulando las últimas 4KB de cada uno (truncado) para diagnóstico.

5. **Enforce del timeout:** si el proceso excede `timeoutMs` (default 5 minutos), se mata el proceso y se retorna `{ timedOut: true }`.

### Kill del proceso en Windows

En sistemas Unix, matar el proceso padre es suficiente. En Windows, Gemini puede haber lanzado subprocesos propios que quedan huérfanos si solo se mata el padre. Por eso en Windows el `GeminiCliExecutor` usa `taskkill /T /F /PID <pid>` — el flag `/T` mata el árbol de procesos completo.

### Resultado bruto

El executor retorna un objeto con:
- `exitCode` — el código de salida del proceso
- `timedOut` — si el proceso fue terminado por timeout
- `stdoutTail` — las últimas 4KB de stdout (solo para diagnóstico)
- `stderrTail` — las últimas 4KB de stderr (solo para diagnóstico)

**Importante:** el executor no retorna "qué cambió el agente". Esa información viene exclusivamente de `git diff HEAD` en el componente posterior (`ResultRecorder`). El stdout/stderr se persiste únicamente para diagnóstico cuando algo falla — nunca para determinar el resultado del trabajo.

### MockAgentExecutor

Para tests, el `MockAgentExecutor` implementa `AgentExecutor` pero en vez de invocar ningún proceso, ejecuta una función configurada en el momento de construcción. Esta función puede producir cualquier comportamiento determinístico: un resultado exitoso, un timeout, un error de exit code, o incluso simular que el agente hizo un commit inesperado.

El `MockAgentExecutor` es lo que permite testear el pipeline completo de `RunExecutor` (con todos sus componentes reales: `WorktreeManager`, `ScopeChecker`, `ResultRecorder`, etc.) sin necesitar Gemini instalado ni hacer llamadas reales. Los 455 tests del proyecto incluyen tests E2E del pipeline completo usando el mock.

---

## Interfaces

**Recibe:** `AgentExecutorOptions` con `{ cwd, instructionContent, model, timeoutMs }`.

**Produce:** `AgentRawResult` con `{ exitCode, timedOut, stdoutTail, stderrTail }`.

**Lo invoca:** `ResultRecorder`, que llama a `execute()` y luego inspecciona el worktree con `git diff HEAD` para determinar qué cambió.

---

## Decisiones de diseño

La elección de stdin sobre archivo de instrucciones (comparado con Codex, que usaba `--instructions-file`) simplifica el proceso: no hace falta gestionar un archivo temporal adicional. El prompt llega directo al proceso.

`--approval-mode yolo` es la única forma práctica de ejecutar Gemini en modo headless. Sin auto-aprobación, cualquier tool call (leer un archivo, ejecutar un comando) haría que el proceso se bloqueara esperando confirmación interactiva. El aislamiento real viene del worktree y el ScopeChecker — no del modo de aprobación del CLI.
