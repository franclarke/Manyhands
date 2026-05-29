# ManyHands

ManyHands es un sistema de orquestación de agentes de software para tesis de Ingeniería en Sistemas. Toma una descripción de feature en lenguaje natural, la descompone recursivamente en un DAG jerárquico de sub-tareas, ejecuta las tareas hoja en git worktrees aislados mediante subagentes LLM, anticipa conflictos entre hojas concurrentes, e integra resultados de abajo hacia arriba.

**Pregunta de investigación:** ¿Existe una granularidad óptima de descomposición que maximiza la calidad del output de agentes LLM paralelos? ¿La anticipación de conflictos reduce fallos de integración frente a paralelismo naive?

```
prompt / feature description
  → recursive LLM decomposition (DAG)
  → leaf contracts with acceptance criteria
  → parallel subagents in git worktrees (via Codex CLI)
  → static conflict anticipation
  → bottom-up integration with cherry-pick
  → merged result + traces + metrics
```

---

## Estado de Implementación

### Completado

**Modelo de dominio (packages/)**
- `task-graph` — TaskGraph con 4 kinds de nodos (`root`, `composite`, `leaf`, `integrator`), validación de 12 reglas, topological sort (Kahn), readiness, status aggregation
- `decomposer` — AnthropicDecomposer (LLM) + MetadataDrivenMockDecomposer (determinístico), guards, normalize, fallback transparente
- `contracts` — AgentTaskContract con scope, acceptance criteria, dependencias
- `scheduler` — políticas `sequential_dag`, `parallel_naive`, `risk_aware`
- `conflict-risk` — señales estáticas por archivos/símbolos/contratos
- `run-store` — RunSnapshot con patches append-only, JSON persistence
- `trace-store` — TraceEvent interface + InMemoryTraceStore
- `shared` — schemas base (EntityId, timestamps)
- `evaluator` — métricas de benchmark, GranularityVector (infraestructura de tesis)
- `core` — barrel de re-exports (deprecated, en reemplazo por `engine`)

**Web app (apps/web/) — Next.js 15**
- Command Center (prompt-first, workspace picker, granularity selector, model picker)
- DAG Canvas con ReactFlow: 3 tipos de edges (dependency, risk, gate), inspector view
- Node editing: 5 tipos de patch (rename, objective, paths, acceptance, manual)
- Subtree regeneration con LLM (POST .../regen)
- Run lifecycle completo: 9 estados con SSE, heartbeat, sweeper
- Patch system auditable: append-only con trace events
- Lab Mode: benchmarks determinísticos, replay, scenario picker
- API Routes: runs CRUD, lifecycle, nodes editing, integrator, serialize, risks

**Fases implementadas:**
- Fase 0 — Evolución del modelo de nodos (`root`, `integrator`, `goal`, `auto` granularity)
- Fase 1 — Desacoplar pipeline de scenarios (prompt-only runs sin scenarioId)

### Próximo: Execution Core v0.1

**Paquete nuevo: `packages/execution-core/`**

El núcleo de ejecución real que conecta el DAG con Codex CLI:

```
packages/execution-core/
  src/
    types.ts           # WorktreeRecord, AgentExecutionResult, AgentResultStatus
    errors.ts          # ExecutionCoreError, WorktreeError, AgentTimeoutError, ...
    worktree-manager.ts # git worktree lifecycle
    codex-cli-executor.ts # codex exec wrapper
    scope-checker.ts   # file overlap / path validation
    result-recorder.ts # patch + trace persistence
    integration-agent.ts # cherry-pick + codex repair
    batch-scheduler.ts # parallelism control (maxParallel=3)
    run-executor.ts    # top-level orchestrator
    granularity-vector.ts # experiment metrics
    index.ts
```

**Etapas de implementación:**
- Etapa 0 — Scaffold + fixtures (package.json, tsconfig, ADR-18..26, repo fixture `task-manager-api`)
- Etapa 1 — Worktree lifecycle + MockCodexCliExecutor
- Etapa 2 — Codex CLI integration + scope checks + result recording
- Etapa 3 — Integration agent (cherry-pick + repair)
- Etapa 4 — Batch scheduler + run orchestrator
- Etapa 5 — GranularityVector + experiment baselines B0-B4

---

## Arquitectura

```
packages/
  shared/              # Schemas base (EntityId, timestamps) — SIN CAMBIOS
  task-graph/          # TaskNode (root|composite|leaf|integrator), validación, topo sort
  contracts/           # AgentTaskContract (scope, acceptance, validation commands)
  decomposer/          # AnthropicDecomposer + guards + normalize
  scheduler/           # sequential_dag, parallel_naive, risk_aware
  run-store/           # RunSnapshot, patches append-only, JSON persistence
  trace-store/         # TraceEvent, InMemoryTraceStore
  execution-core/      # [PRÓXIMO] Codex CLI, worktrees, integration, metrics
  conflict-risk/       # Señales estáticas (P2 en MVP)
  scope-validation/    # Scope enforcement (P2)
  worktree-runner/     # Mock runner legacy
  repository-index/    # TS AST parsing (P2)
  evaluator/           # Benchmark reports, GranularityVector
  core/                # Barrel deprecated (compat shim)

apps/
  web/                 # Next.js 15
    src/
      app/
        (command-center)/  # Homepage: prompt-first
        runs/[runId]/      # DAG canvas, inspector, action bar
        workspaces/        # Workspace management
        lab/               # Lab Mode (benchmarks, replay)
        api/               # REST endpoints
      lib/
        server/runs/       # Runner, lifecycle, patches, editing, schema
        server/workspaces/ # Workspace store
        *.ts               # View models, layout, granularity, models

docs/adr/              # 17 ADRs (0001–0017) + ADR-18..26 [PRÓXIMOS]
benchmarks/            # Fixtures determinísticos para Lab Mode
examples/              # Repo fixtures para experimentos
tests/                 # Integration tests (228 passing)
```

---

## Decisiones de Diseño Cerradas

| ID | Decisión |
|----|----------|
| D1 | Dependencies duplicadas: `graph.dependencies` (canónico) + `node.dependencies` (shortcut sincronizado) |
| D2 | `goal` es el campo canónico (no `intent`). Breaking change aplicado en Fase 0. |
| D3 | Sin scenarioId + LLM falla → run FALLA con error claro. Sin fallback silencioso. |
| D4 | Codex CLI (`codex exec`) es el único executor de subagentes. No Claude Code SDK. |
| D5 | Git diff es la fuente de verdad del resultado. No stdout de Codex. |
| D6 | El orquestador hace commit de los resultados. Codex nunca debe hacer commit. |
| D7 | Sandbox default: `workspace-write`. `danger-full-access` requiere confirmación explícita. |
| D8 | Cherry-pick como estrategia de integración. Codex como reparador semántico si hay conflicto. |

---

## Flujo Principal MVP

```
1. POST /api/runs { workspaceId, userPrompt, model, granularity }
   → buildFeatureRequestFromPrompt()
   → AnthropicDecomposer.decompose() [sin fallback si no hay API key]
   → TaskGraph: root + composites + leaves
   → Status: needs_review

2. Usuario inspecciona/edita el DAG (PATCH nodes, regen con LLM)
   → Patches append-only → validateTaskGraph post-patch

3. POST /api/runs/:id/approve-plan
   → Status: approved

4. POST /api/runs/:id/run
   → BatchScheduler: leaves en paralelo (maxParallel=3)
   → Por cada leaf: WorktreeManager + CodexCliExecutor
   → ScopeChecker + ResultRecorder (git diff, commits)
   → Al terminar composite: IntegrationAgent (cherry-pick)
   → Status: completed / failed
   → GranularityVector para métricas de experimento
```

---

## Comandos

```bash
# Setup
pnpm install

# Desarrollo
pnpm web:dev          # Next.js dev server (localhost:3000)

# Validación
pnpm test             # 228 tests (packages + integration)
pnpm typecheck        # All packages
pnpm web:typecheck    # Web app
pnpm lint
pnpm build

# Web app endpoints
curl http://localhost:3000/api/health
curl http://localhost:3000/api/benchmarks       # Lab Mode

# Demos deterministicos (Lab Mode)
pnpm demo:plan
pnpm demo:execute:mock
pnpm demo:benchmark:conflicts
pnpm demo:compare:granularity
```

---

## Contexto de Tesis

**Hipótesis principal:** Existe una granularidad óptima de descomposición DAG que maximiza la calidad del output de agentes LLM en ejecución paralela sobre git worktrees.

**Baselines experimentales:**
- B0 — Single agent (tarea completa, sin descomposición)
- B1 — Sequential DAG (una hoja a la vez)
- B2 — Parallel naive (todas las hojas en paralelo, sin anticipar conflictos)
- B3 — Parallel + integration (con IntegrationAgent bottom-up)
- B4 — Parallel + risk-aware scheduling + integration

**Targets de granularidad:**
- G3 (~3 hojas), G6 (~6 hojas), G9 (~9 hojas)

**Métricas via GranularityVector:** depth, leafCount, avgTokensPerLeaf, integrationSuccessRate, conflictRate, totalDurationMs, costUsd, testsPassedRate.

---

## Referencias

- `docs/adr/` — 17 ADRs con decisiones de diseño
- `ManyHands_KB_Codex.md` — Knowledge base completa para agentes de desarrollo
- `docs/research/` — Marco teórico y referencias académicas
- `docs/development/` — Roadmap, visión de producto, plan de tesis
