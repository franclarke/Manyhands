# ManyHands — Reporte de Avance

**Fecha:** 28 de mayo de 2025
**Autor:** Francisco Clarke
**Contexto:** Tesis de Ingeniería en Sistemas — Pregunta de investigación: ¿existe una granularidad óptima de descomposición DAG que maximiza la calidad del output de agentes LLM paralelos?

---

## 1. Resumen Ejecutivo

ManyHands es un sistema de orquestación de agentes LLM para desarrollo de software. Toma una feature en lenguaje natural, la descompone en un DAG jerárquico, ejecuta las hojas en git worktrees aislados con Codex CLI, y luego integra los resultados de abajo hacia arriba con cherry-pick.

En esta iteración se completó la **Etapa 0 del Execution Core** — el módulo que eventualmente ejecutará agentes LLM en paralelo sobre worktrees Git aislados. Esta etapa cubre exclusivamente el scaffold técnico: tipos del dominio, errores tipados, eventos de trazabilidad, extensiones de contratos, decisiones de arquitectura documentadas (ADRs), y una fixture de benchmark para los experimentos de granularidad.

**No hay lógica de ejecución real en esta etapa.** Todo lo construido es infraestructura tipada que las etapas siguientes consumirán.

### Métricas del sistema

| Métrica | Antes (Fase 1) | Después (Etapa 0) |
|---------|-----------------|---------------------|
| Tests | 228 | 295 (+67) |
| Packages | 13 | 14 (+execution-core) |
| ADRs | 17 | 26 (+9) |
| Líneas nuevas (código) | — | ~960 (types + errors + barrel) |
| Líneas nuevas (tests) | — | ~584 |
| Líneas nuevas (ADRs) | — | ~413 |
| Líneas nuevas (fixture) | — | ~323 |

---

## 2. Qué se Implementó

### 2.1. Package `@manyhands/execution-core`

Se creó un nuevo package en el monorepo (`packages/execution-core/`) siguiendo el patrón establecido por los 13 packages existentes:

- **Build dual:** ESM + CommonJS + declaraciones TypeScript (via `tsup`)
- **Dependencias internas:** reutiliza schemas de `@manyhands/shared` (EntityId, IsoTimestamp, NonEmptyString)
- **Aliases:** configurado en `tsconfig.base.json` y `vitest.config.ts` para resolución directa del source en desarrollo

**Contenido actual:**

```
packages/execution-core/
  src/
    index.ts      — barrel (re-exports types + errors)
    types.ts      — 14 Zod schemas con tipos TypeScript inferidos
    errors.ts     — 7 clases de error con type guards y contexto estructurado
```

### 2.2. Sistema de Tipos (14 Zod schemas)

Todos los tipos del dominio de ejecución están definidos como **Zod schemas** con tipos TypeScript inferidos via `z.infer<>`. Esto permite:
- Validación en runtime de datos entrantes (resultados de Codex, configuración de usuario)
- Generación automática de tipos TypeScript estáticos
- Defaults explícitos (p.ej. `maxParallel` defaultea a 3, `sandboxMode` a "workspace-write")

**Schemas principales:**

| Schema | Campos | Propósito |
|--------|--------|-----------|
| `AgentResultStatusSchema` | 8 literals | Resultado de una ejecución de agente: success, empty_diff, scope_violation, validation_failed, codex_error, timeout, agent_committed_unexpectedly, internal_error |
| `WorktreeRecordSchema` | 9 campos | Registro de un git worktree: taskId, runId, kind (leaf/integration), path, branch, baseCommit, status, timestamps |
| `AgentExecutionResultSchema` | 14 campos | Resultado completo por hoja: diff, changedFiles, scopeCheck, validationResult, tokens, costo, etc. |
| `IntegrationResultSchema` | 7 campos | Resultado de integración cherry-pick: status, childResults, conflictDetails, repairResult |
| `ExecutionConfigSchema` | 5 campos con defaults | Configuración: maxParallel=3, leafTimeout=5min, integrationTimeout=10min, sandbox, unexpectedCommitPolicy |
| `GranularityVectorSchema` | 17 campos | Vector de métricas para el experimento de tesis (9 pre-ejecución + 8 post-ejecución) |
| `CodexCliExecutorOptionsSchema` | 7 campos | Opciones de invocación de Codex CLI: cwd, instructionFilePath, model, timeout, sandbox, etc. |

**Decisión de diseño:** Se usó Zod en lugar de interfaces TypeScript planas porque los datos de ejecución provienen de fuentes no confiables (output de Codex CLI, configuración del usuario). Zod valida en runtime y coerce tipos, lo cual es esencial para un pipeline que interactúa con subprocesos externos.

### 2.3. Jerarquía de Errores (7 clases)

Se diseñó una jerarquía de errores tipados con contexto estructurado:

```
ExecutionCoreError (base)
│   - code: string (para serialización, p.ej. "WORKTREE_ERROR")
│   - cause?: unknown (error original encadenado)
│   - static is(err): type guard
│
├── WorktreeError
│     taskId, worktreePath?, operation: "create"|"clean"|"detect"
│
├── CodexExecutionError
│     taskId, exitCode, timedOut, durationMs
│
├── ScopeViolationError
│     taskId, violations: string[]
│
├── ExecutionValidationError
│     taskId, command, exitCode, output
│
├── IntegrationError
│     compositeTaskId, childTaskIds[], phase: "cherry_pick"|"repair"|"validation"
│
└── UnexpectedCommitError
      taskId, commitSha, policy: "reject"|"accept"
```

**Decisiones clave:**
- Cada clase tiene un **`static is()` type guard** que permite pattern matching seguro: `if (WorktreeError.is(err)) { /* err.taskId está tipado */ }`
- Los type guards son **mutuamente excluyentes** entre subclasses — `WorktreeError.is(err)` retorna false para un `CodexExecutionError`, pero `ExecutionCoreError.is(err)` retorna true para ambos
- Los campos de contexto son `readonly` — los errores son inmutables una vez creados
- El campo `code` es un string constante por clase, que facilita serialización a JSON y matching en logs

**¿Por qué no un solo error genérico?** Un error genérico `ExecutionError` con un campo `kind` sería más simple, pero perdería la type safety de los campos de contexto. Con la jerarquía, TypeScript sabe que un `IntegrationError` tiene `compositeTaskId` y `childTaskIds` — no hace falta castear ni hacer assertions.

### 2.4. Eventos de Trazabilidad (16 nuevos trace events)

Se extendió el union type `TraceEventTypeSchema` en `packages/trace-store/` con 16 nuevos literals que cubren todo el ciclo de vida de ejecución:

| Fase | Eventos |
|------|---------|
| Worktree | `worktree_created` |
| Agente | `agent_started`, `codex_started`, `codex_completed`, `agent_committed` |
| Detecciones | `unexpected_commit_detected`, `scope_check_failed` |
| Validación | `validation_started` |
| Integración | `integration_started`, `cherry_pick_attempted`, `cherry_pick_conflict`, `codex_repair_started`, `integration_completed` |
| Orquestación | `batch_started`, `batch_completed`, `run_completed` |

**¿Por qué son aditivos al union existente?** El trace-store ya tenía 34 event types para el pipeline de planning. Se verificó que ningún código hace exhaustive match sobre el union (solo `findByType()` que filtra por string). Agregar literals al union es backward-compatible — los 228 tests existentes siguieron pasando sin modificación.

### 2.5. Contract V2 (extensión del package contracts)

Se extendió `AgentTaskContractSchema` con 5 campos opcionales para ejecución real:

```typescript
// Nuevo schema independiente (no extiende el ValidationCommandSchema existente)
ExecutionValidationCommandSchema = {
  command: string,     // p.ej. "pnpm"
  args: string[],      // p.ej. ["test", "--run"]
  timeoutMs: number,   // default 60_000
  cwd: "worktree" | "repo-root"
}

ExecutionScopeSchema = {
  implementationPaths: string[],  // globs: ["src/auth/**"]
  testPaths: string[],            // globs: ["tests/auth/**"]
  configPaths: string[]           // globs: [".env.example"]
}

// Campos agregados a AgentTaskContractSchema (todos opcionales):
executionScope?: ExecutionScopeSchema
forbiddenPaths?: string[]
leafValidationCommands?: ExecutionValidationCommand[]
parentValidationCommands?: ExecutionValidationCommand[]
runValidationCommands?: ExecutionValidationCommand[]
```

**Decisión clave:** `ExecutionValidationCommandSchema` es un schema **nuevo**, no extiende el `ValidationCommandSchema` existente. El existente tiene `{ kind, command, timeoutMs?, blocking }` — un shape completamente diferente pensado para validación de planning. El V2 tiene `{ command, args[], timeoutMs, cwd }` — pensado para ejecución real en worktrees. Crear un schema separado evita contaminar el modelo de planning con concerns de ejecución.

**¿Por qué opcionales?** Todos los campos V2 son opcionales para mantener backward compatibility con los 228 tests existentes que construyen contratos sin estos campos. Los tests pasaron sin modificación.

### 2.6. Benchmark Fixture (`benchmarks/task-manager-api/`)

Se creó un repositorio Express REST API standalone que sirve como **target** para los experimentos de granularidad:

| Endpoint | Estado |
|----------|--------|
| GET /health | Implementado |
| GET /tasks | Implementado |
| GET /tasks/:id | Implementado |
| POST /tasks | Implementado |
| PUT /tasks/:id | **Stub** (retorna 404) |
| DELETE /tasks/:id | **Stub** (retorna 404) |

- **Tests con Vitest + supertest**: 14 tests definen el comportamiento esperado completo. Los tests de GET/POST pasan; los de PUT/DELETE fallan por diseño (el agente debe completar la implementación).
- **In-memory store**: un `Map<string, Task>` — sin base de datos, sin I/O externo. Determinístico y rápido.
- **Standalone**: NO es miembro del pnpm workspace. Es un codebase independiente con su propio `package.json` y `tsconfig.json`.

**¿Por qué este fixture y no un repo real?** Un repositorio real tiene demasiadas variables confounding: tamaño, bugs existentes, complejidad del framework. Este fixture es lo suficientemente simple para que un agente lo complete en minutos, pero lo suficientemente complejo para exponer conflictos cuando múltiples agentes trabajan en PUT y DELETE en paralelo.

### 2.7. ADRs 18-26 (Decisiones de Arquitectura)

Se documentaron 9 Architecture Decision Records que formalizan las decisiones de diseño del pipeline de ejecución:

| ADR | Tema | Decisión clave |
|-----|------|----------------|
| 0018 | Sandbox modes | Default `workspace-write` (agente solo puede escribir en su worktree). `danger-full-access` requiere opt-in explícito + confirmación del usuario. |
| 0019 | Codex no-interactivo | `codex exec` con `--instructions-file` + `bypassApprovals: true`. El agente nunca recibe prompts interactivos. Codex CLI es el **único** executor. |
| 0020 | Git diff como verdad | `git diff HEAD` es la fuente canónica de qué cambió el agente. No se confía en stdout/stderr de Codex. `empty_diff` + exit 0 = "empty_diff", no "success". |
| 0021 | El orquestador hace commit | Codex **nunca** debe hacer commit. El orquestador: diff → scope check → validación → commit. Si Codex hace commit, se detecta via comparación de SHA. |
| 0022 | Política de commit inesperado | Configurable: `reject` (default, descarta resultado) o `accept` (acepta commit del agente pero valida scope/tests de todos modos). |
| 0023 | Scope refinement | Tres categorías de paths (implementation, test, config) + `forbiddenPaths` global. Deny wins (forbidden siempre gana sobre allowed). |
| 0024 | Validación en tres niveles | `leaf` (post-hoja, pre-commit), `parent` (post-integración), `run` (post-run final). Cada nivel con su propio timeout y working directory. |
| 0025 | Integración cherry-pick | Cherry-pick de commits hijo sobre rama padre. Conflicto → Codex como reparador semántico. Máximo 1 retry. Failure → `codex_repair_failed`. |
| 0026 | Diseño experimental | `GranularityVector` de 17 campos. 5 baselines (B0-B4) × 3 granularidades (G3/G6/G9) = 15 configuraciones. Fixture: task-manager-api. |

### 2.8. Test Suites (67 tests nuevos)

| Archivo | Tests | Qué valida |
|---------|-------|------------|
| `tests/execution-core-types.test.ts` | 35 | Parsing correcto de los 14 Zod schemas, rechazo de datos inválidos, verificación de defaults, validación de rangos (rates 0-1), campos opcionales |
| `tests/execution-core-errors.test.ts` | 32 | Instanciación de las 7 clases de error, type guards (`static is()`), campos de contexto, exclusividad mutua entre subclasses, herencia de Error/ExecutionCoreError |

---

## 3. Decisiones de Diseño y Justificación

### 3.1. ¿Por qué scaffold primero, sin lógica?

La experiencia con las fases 0 y 1 mostró que definir tipos y contratos **antes** de implementar lógica evita retrabajos. En Fase 0, el modelo de nodos (`TaskNode`, `TaskGraph`) se estabilizó antes de que el decomposer lo consumiera. En Fase 1, el schema de `RunRecord` se definió antes de la API route. Siguiendo el mismo patrón:

1. Los tipos (`AgentExecutionResult`, `WorktreeRecord`, etc.) definen el contrato entre componentes antes de que existan.
2. Los errores tipados definen el vocabulario de fallos antes de que haya código que falle.
3. Los ADRs documentan el "por qué" de cada decisión antes de que se implemente.
4. El fixture de benchmark existe antes de que haya un executor — se puede inspeccionar, entender, y ajustar sin presión de implementación.

### 3.2. ¿Por qué Codex CLI y no un SDK directo?

**(Decisión D4 — ADR-0019)**

Codex CLI provee tres cosas que un SDK directo no ofrece sin trabajo significativo:
1. **Sandboxing del filesystem** — `--sandbox workspace-write` restringe al agente a su worktree
2. **Tool use integrado** — el agente puede leer archivos, ejecutar comandos, etc., sin que el orquestador implemente cada tool
3. **Model selection** — el CLI soporta múltiples modelos sin cambios en el orquestador

La alternativa (Claude Code SDK o `child_process.exec` directo con prompts) requeriría reimplementar sandboxing, tool routing, y timeouts. Codex CLI los resuelve out-of-the-box.

### 3.3. ¿Por qué `git diff` y no el output de Codex?

**(Decisión D5 — ADR-0020)**

El output de un agente LLM puede ser alucinado. El agente puede reportar "implementé la función X" pero no haber tocado el archivo. `git diff HEAD` es **objetivo y verificable**: muestra exactamente qué cambió en el filesystem, sin depender de la auto-evaluación del agente.

Además, el diff alimenta directamente al pipeline de integración (cherry-pick) y al scope checker, creando un flujo de datos unificado.

### 3.4. ¿Por qué el orquestador hace commit y no el agente?

**(Decisión D6 — ADR-0021)**

Si el agente hace commits arbitrarios:
- Los mensajes de commit no son estructurados — dificultan el audit trail
- El orquestador pierde control sobre el commit graph — cherry-pick se vuelve impredecible
- No hay oportunidad de validar scope/tests antes de que el cambio entre al historial

Con el orquestador como committer, el flujo es: Codex trabaja → diff → scope check → validación → commit. Cada paso es un gate que puede rechazar el cambio antes de que entre al historial de Git.

### 3.5. ¿Por qué cherry-pick para integración?

**(Decisión D8 — ADR-0025)**

Alternativas consideradas:
- **`git merge`**: crea merge commits que complican el historial y dificultan rollback
- **`git rebase`**: reescribe historial, lo cual conflictúa con el tracking de commits del orquestador
- **Cherry-pick**: preserva cada commit hijo como un commit discreto en la rama padre, mantiene historial limpio, y los conflictos son detectables y reparables

Cuando cherry-pick produce un conflicto, se invoca Codex como **reparador semántico** — a diferencia de un merge textual, Codex entiende la intención del código y puede resolver conflictos que requieren comprensión semántica (p.ej. dos hojas que renombran la misma función de maneras diferentes).

### 3.6. ¿Por qué un GranularityVector de 17 campos?

**(ADR-0026)**

La pregunta de investigación requiere correlacionar **estructura del DAG** (cuántas hojas, qué tan profundas, cuántas dependencias) con **resultados de ejecución** (tasa de éxito, conflictos, costo, duración). Un único "score de calidad" perdería la multidimensionalidad del fenómeno.

El vector se divide en:
- **9 métricas pre-ejecución** (computables antes de ejecutar agentes): depth, leafCount, compositeCount, avgLeafDepth, maxLeafDepth, dependencyCount, avgAcceptanceCriteriaPerLeaf, estimatedTokensPerLeaf
- **8 métricas post-ejecución** (computables después): integrationSuccessRate, leafSuccessRate, conflictRate, totalDurationMs, totalCostUsd, testsPassedRate, linesChanged, unexpectedCommitCount, scopeViolationCount

Las rates (integrationSuccessRate, leafSuccessRate, conflictRate, testsPassedRate) están validadas con `z.number().min(0).max(1)` — Zod rechaza valores fuera del rango en runtime.

---

## 4. Qué Falta por Hacer

### Etapa 1: Implementación del Pipeline de Ejecución (commits 8-18)

| # | Componente | Responsabilidad | Dependencias |
|---|-----------|-----------------|--------------|
| 8 | `WorktreeManager` | Crear/limpiar git worktrees, detectar commits inesperados | types, errors |
| 9 | `MockCodexCliExecutor` | Test double determinístico (no invoca Codex real) | types |
| 10 | `ScopeChecker` | Validar changedFiles vs allowed/forbidden paths | contracts V2 |
| 11 | `ResultRecorder` | Capturar git diff, persistir patch + trace | trace-store |
| 12 | `CodexCliExecutor` | Wrapper real de `codex exec` | types, errors |
| 13 | `IntegrationAgent` | Cherry-pick + Codex repair fallback | WorktreeManager, CodexCliExecutor |
| 14 | `BatchScheduler` | Control de concurrencia (maxParallel=3) | — |
| 15 | `RunExecutor` | Orquestador top-level (combina todo) | todos los anteriores |
| 16 | `GranularityVector` | Calcular métricas pre/post ejecución | types |
| 17 | Wire web app | `runner.ts` + SSE events + API routes | RunExecutor |
| 18 | Tests E2E | Integración end-to-end con MockCodexCliExecutor | MockCodexCliExecutor |

### Orden estimado de implementación

```
WorktreeManager ──► MockCodexCliExecutor ──► ScopeChecker ──► ResultRecorder
                                                                    │
CodexCliExecutor ◄──────────────────────────────────────────────────┘
        │
        ▼
IntegrationAgent ──► BatchScheduler ──► RunExecutor ──► Wire web app ──► E2E tests
```

### Después de Etapa 1: Experimentos

Con el pipeline funcional, se ejecutarán los experimentos de granularidad:

1. **15 configuraciones**: 5 baselines (B0-B4) × 3 granularidades (G3/G6/G9)
2. **Fixture**: `benchmarks/task-manager-api/` — completar PUT/DELETE como tarea para los agentes
3. **Recolección**: GranularityVector por cada configuración
4. **Análisis**: correlación entre métricas de estructura DAG y métricas de resultado

---

## 5. Arquitectura del Sistema

### Packages del monorepo (14 packages)

```
packages/
  shared/           Utilidades compartidas (EntityId, IsoTimestamp, NonEmptyString)
  task-graph/        TaskNode, TaskGraph, validación, topological sort
  contracts/         AgentTaskContract (V1 + V2 execution fields)
  decomposer/        AnthropicDecomposer (LLM → DAG)
  scheduler/         Estrategias de scheduling (sequential, parallel, risk-aware)
  run-store/         RunSnapshot, patches
  trace-store/       TraceEvent (50 event types)
  execution-core/    [NUEVO] Types + errors para el pipeline de ejecución
  conflict-risk/     Señales estáticas de conflicto entre hojas
  scope-validation/  Validación de scope (legacy, será reemplazado por ScopeChecker)
  worktree-runner/   Mock runner legacy (referencia)
  repository-index/  Índice de archivos del repositorio
  evaluator/         Evaluación de quality (Lab Mode)
  core/              [DEPRECADO] Barrel de compatibilidad
```

### Flujo de ejecución (diseñado, pendiente de implementar)

```
Prompt del usuario
        │
        ▼
  AnthropicDecomposer ──► DAG jerárquico (TaskGraph)
        │
        ▼
  RunExecutor (orquestador)
        │
        ├──► BatchScheduler (maxParallel=3)
        │       │
        │       ├──► WorktreeManager.create()
        │       │       │
        │       │       ▼
        │       ├──► CodexCliExecutor.execute()  ← codex exec --sandbox workspace-write
        │       │       │
        │       │       ▼
        │       ├──► ScopeChecker.validate()     ← git diff --name-only vs allowed/forbidden
        │       │       │
        │       │       ▼
        │       ├──► ValidationCommands.run()    ← pnpm test, tsc --noEmit, etc.
        │       │       │
        │       │       ▼
        │       ├──► ResultRecorder.commit()      ← git commit (orchestrator)
        │       │       │
        │       │       ▼
        │       └──► WorktreeManager.clean()
        │
        ▼
  IntegrationAgent
        │
        ├──► git cherry-pick (por cada hijo)
        │       │
        │       ├─ limpio ──► siguiente hijo
        │       │
        │       └─ conflicto ──► CodexCliExecutor.repair()
        │                               │
        │                               ├─ éxito ──► siguiente hijo
        │                               └─ fallo ──► integration_failed
        │
        ▼
  RunValidation ──► GranularityVector ──► Resultado final
```

---

## 6. Stack Técnico

| Componente | Tecnología |
|-----------|------------|
| Lenguaje | TypeScript (strict mode, noImplicitOverride) |
| Monorepo | pnpm workspaces |
| Build | tsup (ESM + CJS + DTS) |
| Testing | Vitest |
| Validación | Zod (runtime schema validation) |
| Web app | Next.js 15 (App Router) |
| Agent executor | Codex CLI (`codex exec`) |
| VCS | Git (worktrees para aislamiento) |
| Fixture API | Express + supertest |

---

## 7. Historial de Commits (Etapa 0)

```
7e60079  feat: add benchmark fixture and execution-core test suites
70e689f  docs(adr): add ADRs 18-26 for execution core design decisions
c139719  feat(contracts): add V2 execution scope and validation command schemas
ccce869  feat(trace-store): add 16 execution core trace event types
a13678e  feat(execution-core): add typed error hierarchy for execution pipeline
4e7ce91  feat(execution-core): add Zod schemas for execution domain types
d755cb3  feat(execution-core): scaffold package with build, typecheck, and aliases
```

---

## 8. Verificación

```bash
pnpm test                                        # 295/295 passing
pnpm -F @manyhands/execution-core typecheck      # 0 errores
pnpm -F @manyhands/execution-core build          # dist/ generado (ESM + CJS + 25KB DTS)
pnpm build                                       # 14 packages OK
```
