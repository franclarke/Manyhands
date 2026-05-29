# ManyHands — Contexto para Claude

> Este archivo es la fuente de verdad para continuar el desarrollo en sesiones nuevas.
> Francisco es el único desarrollador. Comunicación en español. Decisiones ya cerradas no se renegocian.

---

## Qué es ManyHands

Sistema de orquestación de agentes LLM para desarrollo de software. Toma una feature en lenguaje natural, la descompone en un DAG jerárquico (recursivo), ejecuta las hojas en git worktrees aislados con **Codex CLI** (`codex exec`), anticipa conflictos entre hojas concurrentes, integra resultados de abajo hacia arriba con cherry-pick.

**Contexto académico:** Tesis de Ingeniería en Sistemas. Pregunta de investigación: ¿existe una granularidad óptima de descomposición DAG que maximiza la calidad del output de agentes LLM paralelos?

**No es:** un agente de código, un RAG system, una herramienta de memoria organizacional, ni un plugin de IDE.

---

## Estado Actual (post Etapa 0 — Execution Core scaffold)

### Tests y builds
- `pnpm test` → 295/295 passing
- `pnpm -F @manyhands/execution-core typecheck` → 0 errores
- `pnpm build` → 14 packages OK
- `pnpm web:typecheck` → 0 errores

### Fases completadas
- **Fase 0** — Modelo de nodos: `root`, `integrator` kinds; `goal` (reemplaza `intent`); `auto` granularity; validación por kind; `prompt`, `acceptanceCriteria`, `output`, `dependencies` en TaskNode
- **Fase 1** — Prompt-only runs: `POST /api/runs` sin `scenarioId`; `buildFeatureRequestFromPrompt()`; D3 enforced (sin fallback silencioso en prompt-only path)
- **Etapa 0 — Execution Core scaffold** (7 commits):
  - Package `@manyhands/execution-core` con `tsup` build (ESM + CJS + DTS)
  - 14 Zod schemas en `src/types.ts`: `AgentResultStatusSchema`, `WorktreeRecordSchema`, `AgentExecutionResultSchema`, `IntegrationResultSchema`, `ExecutionConfigSchema`, `GranularityVectorSchema`, etc.
  - 7 error classes en `src/errors.ts`: `ExecutionCoreError` base + 6 subclases con type guards y structured context
  - 16 trace event types agregados a `trace-store` (`worktree_created` → `run_completed`)
  - Contract V2: `ExecutionValidationCommandSchema`, `ExecutionScopeSchema`, 5 campos opcionales en `AgentTaskContractSchema`
  - ADRs 18-26 documentando decisiones D4-D10 y diseño de ejecución
  - Benchmark fixture `benchmarks/task-manager-api/` (Express REST API con tests)
  - 67 tests nuevos: 35 para schemas, 32 para error hierarchy

### Próximo: Execution Core v0.1 (Etapa 1 — Implementación)

El siguiente trabajo es implementar los componentes funcionales del pipeline de ejecución:

**Orden de implementación (commits 8-18):**
8. `WorktreeManager` (create, clean, detect unexpected commits)
9. `MockCodexCliExecutor` (test double determinístico)
10. `ScopeChecker` (file overlap, path validation)
11. `ResultRecorder` (git diff, patch + trace persistence)
12. `CodexCliExecutor` real (codex exec wrapper)
13. `IntegrationAgent` (cherry-pick + codex repair fallback)
14. `BatchScheduler` (maxParallel=3, concurrency control)
15. `RunExecutor` (orquestador top-level)
16. `GranularityVector` (métricas de experimento)
17. Wire en web app: `runner.ts` + SSE events + API routes
18. Tests de integración E2E con MockCodexCliExecutor

---

## Decisiones Cerradas (NO renegociar)

| ID | Decisión |
|----|----------|
| D1 | `graph.dependencies` es canónico. `node.dependencies` es shortcut sincronizado. Mutación via helpers (`addDependency`, `removeDependency`, `syncNodeDependencies`). |
| D2 | Campo canónico es `goal` (no `intent`). Aplicado globalmente en Fase 0. Si aparece `intent` en fixtures legacy, normalizar en el parser, nunca persistir. |
| D3 | Sin `scenarioId` + LLM falla → run FALLA. Error message: "Graph generation requires an API key..." o "Graph generation failed: {detail}. Retry, switch model, or configure API key." Sin fallback silencioso. El `MetadataDrivenMockDecomposer` solo se usa cuando hay `scenarioId` (Lab Mode). |
| D4 | **Codex CLI** (`codex exec`) es el único executor de subagentes. No Claude Code SDK, no `child_process.exec` directo sin el wrapper. |
| D5 | `git diff HEAD` es la fuente de verdad del resultado. No stdout de Codex, no logs. |
| D6 | **El orquestador hace commit.** Codex nunca debe hacer commit. Si Codex hace commit (`agentCommittedUnexpectedly: true`), política configurable: `reject` (default) o `accept`. |
| D7 | Sandbox default: `workspace-write`. `danger-full-access` requiere opt-in explícito del usuario + confirmación. Nunca como default. |
| D8 | Integración: **cherry-pick** de commits hijo sobre rama padre. Si hay conflicto de cherry-pick → Codex como reparador semántico (prompt con contexto del conflicto). Codex repair falla → `IntegrationStatus: codex_repair_failed`. |
| D9 | `maxParallel = 3` hojas en paralelo por batch (configurable, default 3). Límite de worktrees simultáneos. |
| D10 | Timeouts: hoja `timeoutMs = 300_000` (5 min), integración `timeoutMs = 600_000` (10 min). Configurables por contrato. |

---

## Arquitectura de Paquetes

```
packages/
  shared/         KEEP — sin cambios
  task-graph/     KEEP + REWORK — core del MVP, ya actualizado (Fase 0)
  contracts/      KEEP + REWORK — simplificar campos, agregar V2 fields
  decomposer/     KEEP — funcional, ya actualizado (Fase 0)
  scheduler/      KEEP — sequential_dag, parallel_naive, risk_aware
  run-store/      KEEP — RunSnapshot, patches
  trace-store/    KEEP + extended — 16 execution trace event types agregados (50 total)
  execution-core/ CREATED — scaffold completo: types, errors, barrel. Falta implementación
  conflict-risk/  DEFER — no en path crítico MVP
  scope-validation/ DEFER
  worktree-runner/  DEFER (legacy mock, reference only)
  repository-index/ DEFER
  evaluator/      DEFER (tesis infraestructura, Lab Mode)
  core/           DEPRECATED — barrel de compat
```

---

## Tipos de Execution Core (implementados como Zod schemas)

Todos los tipos están implementados en `packages/execution-core/src/types.ts` como Zod schemas con tipos TypeScript inferidos. Los schemas canónicos son:

| Schema | Descripción |
|--------|-------------|
| `AgentResultStatusSchema` | Union de 8 literals: `success`, `empty_diff`, `scope_violation`, etc. |
| `WorktreeKindSchema` | `"leaf" \| "integration"` |
| `WorktreeStatusSchema` | `"pending" \| "active" \| "committed" \| "cleaned" \| "error"` |
| `WorktreeRecordSchema` | Registro completo por worktree (taskId, runId, kind, path, branch, etc.) |
| `ScopeCheckResultSchema` | `{ passed, violations[] }` — defaults `violations` a `[]` |
| `ValidationRunResultSchema` | `{ passed, output, exitCode }` |
| `AgentExecutionResultSchema` | Resultado completo por hoja (14 campos, 5 opcionales) |
| `IntegrationStatusSchema` | Union de 7 literals para resultado de integración |
| `ConflictDetailSchema` | `{ files[], cherryPickOutput }` |
| `IntegrationResultSchema` | Resultado completo de integración cherry-pick |
| `SandboxModeSchema` | `"workspace-write" \| "danger-full-access"` |
| `CodexCliExecutorOptionsSchema` | Opciones de invocación de Codex CLI |
| `ExecutionConfigSchema` | Config con defaults: maxParallel=3, leafTimeout=300s, etc. |
| `GranularityVectorSchema` | 17 campos (9 pre + 8 post), rates validados 0-1 |

### Error hierarchy (`src/errors.ts`)

```
ExecutionCoreError (base, code: string, static is() type guard)
├── WorktreeError          { taskId, worktreePath?, operation: "create"|"clean"|"detect" }
├── CodexExecutionError    { taskId, exitCode, timedOut, durationMs }
├── ScopeViolationError    { taskId, violations: string[] }
├── ExecutionValidationError { taskId, command, exitCode, output }
├── IntegrationError       { compositeTaskId, childTaskIds, phase: "cherry_pick"|"repair"|"validation" }
└── UnexpectedCommitError  { taskId, commitSha, policy: "reject"|"accept" }
```

---

## TraceEvent Types para Execution (ya implementados)

16 trace events agregados al union en `packages/trace-store/src/index.ts`:
`worktree_created`, `agent_started`, `codex_started`, `codex_completed`, `unexpected_commit_detected`, `scope_check_failed`, `validation_started`, `agent_committed`, `integration_started`, `cherry_pick_attempted`, `cherry_pick_conflict`, `codex_repair_started`, `integration_completed`, `batch_started`, `batch_completed`, `run_completed`

---

## AgentTaskContract V2 (ya implementado en contracts)

Schemas nuevos en `packages/contracts/src/index.ts`:
- `ExecutionValidationCommandSchema` — `{ command, args[], timeoutMs (default 60_000), cwd: "worktree"|"repo-root" }`
- `ExecutionScopeSchema` — `{ implementationPaths[], testPaths[], configPaths[] }`

5 campos opcionales agregados a `AgentTaskContractSchema`:
- `executionScope?: ExecutionScopeSchema` — globs de paths permitidos por categoría
- `forbiddenPaths?: string[]` — globs siempre prohibidos
- `leafValidationCommands?: ExecutionValidationCommandSchema[]` — validación por hoja
- `parentValidationCommands?: ExecutionValidationCommandSchema[]` — al completar composite
- `runValidationCommands?: ExecutionValidationCommandSchema[]` — al completar run

---

## Benchmark Fixture (ya creada)

`benchmarks/task-manager-api/` — Express REST API standalone (NO workspace member):
- GET /health, GET /tasks, GET /tasks/:id, POST /tasks → implementados
- PUT /tasks/:id, DELETE /tasks/:id → stubs (retornan 404 siempre)
- Tests con Vitest + supertest: GET/POST pasan, PUT/DELETE fallan por diseño
- Los agentes completan la implementación durante experimentos de granularidad

---

## Experimentos de Granularidad

**Baselines:**
- B0 — Single agent (sin descomposición)
- B1 — Sequential DAG (una hoja a la vez)
- B2 — Parallel naive (todas en paralelo)
- B3 — Parallel + IntegrationAgent
- B4 — Parallel + risk-aware + IntegrationAgent

**Granularity targets:** G3 (~3 leaves), G6 (~6 leaves), G9 (~9 leaves)

**GranularityVector (métricas):**
```typescript
interface GranularityVector {
  // Pre-execution (estructura DAG)
  depth: number;
  leafCount: number;
  compositeCount: number;
  avgLeafDepth: number;
  maxLeafDepth: number;
  dependencyCount: number;
  avgAcceptanceCriteriaPerLeaf: number;
  estimatedTokensPerLeaf?: number;  // heuristic

  // Post-execution (resultados)
  integrationSuccessRate: number;     // 0-1
  leafSuccessRate: number;            // 0-1
  conflictRate: number;               // leaf pairs with conflicts / total pairs
  totalDurationMs: number;
  totalCostUsd?: number;
  testsPassedRate?: number;           // 0-1, si hay validation commands
  linesChanged: number;
  unexpectedCommitCount: number;
  scopeViolationCount: number;
}
```

---

## Reglas para Claude

1. **No renegociar decisiones D1-D10.** Si algo parece en tensión, señalarlo sin cambiar la decisión.
2. **Codex CLI es mandatorio.** No sugerir alternativas (subprocess directo, otros CLIs) sin preguntarle a Francisco.
3. **Git diff como verdad.** Nunca confiar en stdout de Codex para determinar qué cambió.
4. **El orquestador hace commit.** Nunca hacer que Codex haga commit (bypassApprovals: true ayuda pero no garantiza).
5. **Error claro sobre fallback silencioso** (D3). Si falta API key en prompt-only path → error accionable, no grafo genérico.
6. **Tests como safety net.** Antes de cualquier cambio en packages core (`task-graph`, `contracts`, `decomposer`), verificar que `pnpm test` pasa. Después también.
7. **295 tests deben pasar siempre.** Si un cambio rompe tests, arreglarlo en la misma sesión.
8. **Lab Mode es secundario.** Los escenarios determinísticos, benchmarks y replay son infraestructura de tesis, no el flujo principal de usuario.
9. **`@manyhands/core` está deprecado.** Nuevas dependencias van a packages específicos, no al barrel.
10. **Comunicación en español.** Francisco prefiere respuestas en español excepto para código y términos técnicos.

---

## Comandos de Verificación Rápida

```bash
pnpm test                  # 295 tests (todos los packages)
pnpm typecheck             # packages (errores pre-existentes en tests con @/ aliases)
pnpm -F @manyhands/execution-core typecheck  # execution-core aislado
pnpm web:typecheck         # web app
pnpm build                 # compilación de 14 packages
pnpm web:dev               # dev server en localhost:3000

# Verificar que el flujo principal funciona:
# 1. Ir a localhost:3000
# 2. Crear run con prompt (sin scenarioId)
# 3. Verificar que llega a needs_review con grafo generado
# 4. Editar nodo, regenerar subárbol
# 5. Aprobar plan
```

---

## Archivos Clave para Continuar

| Archivo | Descripción |
|---------|-------------|
| `packages/task-graph/src/index.ts` | TaskNode, TaskGraph, validación, topo sort |
| `packages/contracts/src/index.ts` | AgentTaskContract |
| `packages/decomposer/src/` | AnthropicDecomposer, guards, normalize |
| `apps/web/src/lib/server/runs/runner.ts` | Planning + execution pipeline |
| `apps/web/src/lib/server/runs/schema.ts` | RunRecord schema (Zod) |
| `apps/web/src/lib/server/runs/patches.ts` | Patch types y aplicación |
| `apps/web/src/lib/server/runs/lifecycle.ts` | State machine del run |
| `apps/web/src/app/api/runs/route.ts` | POST /api/runs |
| `apps/web/src/lib/graph-view-model.ts` | RunGraphViewModel, InspectorView |
| `packages/execution-core/src/types.ts` | 14 Zod schemas de ejecución |
| `packages/execution-core/src/errors.ts` | Jerarquía de 7 error classes |
| `docs/adr/` | 26 ADRs con decisiones de diseño (0001-0026) |
| `benchmarks/task-manager-api/` | Fixture Express API para experimentos |
| `tests/execution-core-types.test.ts` | 35 tests de schemas Zod |
| `tests/execution-core-errors.test.ts` | 32 tests de error hierarchy |
| `ManyHands_KB_Codex.md` | Knowledge base completa para agentes |

---

## Próxima Sesión: Empezar Etapa 1 — Implementación

```
Objetivo: Implementar los componentes funcionales del pipeline de ejecución.

Paso 1: pnpm test (verificar 295 tests passing)
Paso 2: WorktreeManager — create/clean worktrees, detect unexpected commits
Paso 3: MockCodexCliExecutor — test double determinístico para pipeline tests
Paso 4: ScopeChecker — validación de changedFiles vs allowed/forbidden paths
Paso 5: ResultRecorder — git diff → patch + trace persistence
Paso 6: CodexCliExecutor real — wrapper de codex exec
Paso 7: IntegrationAgent — cherry-pick + Codex repair fallback
Paso 8: BatchScheduler — maxParallel=3, concurrency control
Paso 9: RunExecutor — orquestador top-level
Paso 10: Wire en web app + tests E2E
```
