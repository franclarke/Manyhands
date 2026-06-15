# Auditoría de Documentación vs Implementación

> Fecha: 2026-06-15. Insumo de la pasada de documentación del repo
> (ver [`docs/superpowers/plans/2026-06-15-documentacion-repo-github.md`](../superpowers/plans/2026-06-15-documentacion-repo-github.md)).
> Base: lectura de los `src/index.ts` de cada paquete + `docs/system/README.md` + `DECISIONS.md`.

## Resumen

- **Inventario:** 11 paquetes activos + `apps/web` + `core` (legacy).
- **Drift sistémico:** conviven remanentes de la era *mock / Lab Mode* (retirada en `DECISIONS.md`) con el camino real del producto, en `decomposer`, `run-store` y `trace-store`. No rompen nada, pero confunden a quien lee el código por primera vez. La documentación debe describir **solo el camino real** y marcar lo legacy como tal.
- **Idioma:** `docs/system/README.md` ya está en español y alineado al código; falta verificar capítulos `01`–`11` durante la reescritura (Task 4).

## Inventario de paquetes (API real)

| Paquete | Responsabilidad real | Exports principales | Depende de |
|---|---|---|---|
| `shared` | Tipos base y helpers puros | `NonEmptyStringSchema`, `EntityIdSchema`, `IsoTimestampSchema`, `nowIso`, `uniqueValues`, `intersectValues`, `clamp01`, `pairKey` | — |
| `contracts` | Contrato orquestador↔agente e interfaces | `AgentTaskContract(Schema)`, `InterfaceContract`, `ExecutionScope`, `AllowedScope`/`ForbiddenScope`, `ContextPack`, `AcceptanceCriterion`, `ValidationCommand`, `ExecutionValidationCommand`, `validationCommandSafetyIssues`, `ValidationResult`/`Check`, `AgentRunResult`, `validateAgentTaskContract` | `shared` |
| `task-graph` | Modelo de DAG y operaciones | `TaskNode`/`TaskGraph(Schema)`, `TaskNodeStatus`/`Kind`, `validateTaskGraph`, `getLeafNodes`, `getTopologicalOrder`, `getReadyLeaves`/`getTaskReadiness`, `aggregateTaskStatus`, `addDependency`/`removeDependency`/`syncNodeDependencies`, `graftSubtree` | `contracts`, `shared` |
| `decomposer` | Descomposición recursiva interface-aware | **Real:** `RecursiveDecomposer`, `GeminiRecursiveDecomposer`, `buildStepPrompt`, `DecomposeStepOutputSchema`, `StepInterfaceSchema`, `AnthropicDecomposer`, `normalizeLlmDecomposition`, `runDecomposerGuards`, `buildDecomposerPrompt`, `GRANULARITY_PROFILES`. **Legacy:** `MockDecomposer`, `SingleTaskDecomposer`, `MetadataDrivenMockDecomposer` | `contracts`, `shared`, `task-graph` |
| `orchestrator-graph` | StateGraphs de planning/ejecución (LangGraph) | `RunStateAnnotation`, `JsonFileCheckpointSaver`, `buildPlanningGraph`, `buildExecutionGraph`, nodos de planning (`makeDecomposePlanNode`, `questionGateNode`, `degradedPlanGateNode`, `makeCriticReviewNode`, `approvalGateNode`) y de ejecución (`prepareExecutionNode`, `makeRouteFrontier`, `makeExecuteLeafNode`, `leafGateNode`, `budgetGateNode`, `makeIntegrateNextCompositeNode`, `conflictGateNode`, `makeRunValidationNode`) | `decomposer`, `execution-core`, `task-graph`, langgraph |
| `execution-core` | Worktrees, executors, scope, integración, validación | `WorktreeManager`, `SimpleGitRunner`, executor (`registry`, `factory`, `cli-executor`, `process`, `live-process-registry`, perfiles `gemini`/`claude-code`/`codex`, `failure`, `status-channel`), routing (`complexity`/`policy`/`availability`), scope (`glob`/`checker`/`artifacts`), `ResultRecorder`, `ValidationRunner`, integración (`agent`/`pre-merge`/`syntax-check`), `granularity/vector`, `ContextPacker`, run (`executor`, `world-reconciler`, `graph-guards`, `grounding-agent`, `skeleton-scaffolder`, `amendments-engine`), `pricing` | `contracts`, `task-graph`, `shared`, … |
| `scheduler` | Selección de waves consciente de scope/riesgo | `scheduleTasks`, `selectScopeAwareWave`, `applyHumanGateToSchedule`, `SchedulingPolicy`, `ExecutionBatch`, `SchedulerPlan`, `HumanGate*` | `conflict-risk`, `contracts`, `task-graph` |
| `conflict-risk` | Riesgo de conflicto pairwise (señales estáticas v0) | `buildTaskPairRiskMatrix`, `predictConflict`, `buildStaticConflictSignals`, `findRiskPrediction`, `ConflictPrediction`, `ConflictRiskLevel`, `StaticConflictSignal` | `contracts`, `repository-index`, `shared` |
| `repository-index` | Índice estructural de TypeScript (grounding) | `TypeScriptRepositoryIndexer`, `buildRepositoryIndex`, `summarizeRepositoryIndex`, `RepositoryIndex(Schema)`, `RepositorySymbolIndex` | `shared`, `typescript` |
| `run-store` | Persistencia JSON de snapshots de run | `JsonRunStore` (`PersistentTraceStore`), `RunSnapshot(Schema)`, `withRunSnapshotHashes`, `computeRunSnapshotOutputHash` | `conflict-risk`, `contracts`, `decomposer`, `scheduler`, `task-graph`, `trace-store` |
| `trace-store` | Eventos de traza append-only | `TraceEvent(Schema)`, `TraceEventType`, `InMemoryTraceStore`, `TraceStore` | `shared` |
| `core` | Barrel legacy — evitar en código nuevo | — | — |
| `apps/web` | Sala de control (Next.js) | Command Center, Run Workspace, `run-model` (reducer/selectores), hosts de planning/ejecución, APIs, SSE | paquetes activos |

## Drift detectado (a reflejar en la documentación)

1. **`decomposer` — maquinaria mock/controlled-conflict retirada sigue exportada.**
   `MockDecomposer`, `SingleTaskDecomposer`, `MetadataDrivenMockDecomposer` y las plantillas de escenarios (`shared_schema_conflict`, `public_api_contract_conflict`, …) son de la era `mock-v0`/`conflict-v0`, marcada *superseded* en `DECISIONS.md`.
   **Acción:** la doc (README de `decomposer` + `docs/system/03`) describe **solo** `RecursiveDecomposer`/`GeminiRecursiveDecomposer` como camino de producto; los mocks se mencionan, si acaso, como fixtures de test. No documentarlos como features.

2. **`run-store` — `RunSnapshot` es persistencia legacy.**
   El esquema arrastra `deterministic`, `sourceFixture`, `datasetVersion` y `ScopeValidationResult` ("round-trip legacy Lab-mode runs"). El producto vivo persiste vía **checkpoints JSON de `orchestrator-graph`** + **event log del `run-model`** en `apps/web`, no vía `RunSnapshot`.
   **Acción:** el README de `run-store` y `docs/system` aclaran que `RunSnapshot` es la persistencia más antigua/secundaria; el estado vivo viene de checkpoints + RunEvent.

3. **`trace-store` — taxonomía de eventos mixta.**
   Conviven eventos legacy (`mock_worktree_created`, `batch_scheduled`, `human_gate_*`) con los reales de `execution-core` (`worktree_created`, `cherry_pick_attempted`/`_conflict`, `executor_repair_started`, `integration_*`, `run_completed`).
   **Acción:** documentar el conjunto de eventos vigente; señalar los legacy como tales.

4. **Tres capas de evento/estado coexisten.** `trace-store` (`TraceEvent`), `run-store` (`RunSnapshot`) y el `run-model` de `apps/web` (`RunEvent`, fuente de verdad de la UI). Conviene una nota en la arquitectura que explique cuál es la vigente para la UI (RunEvent + checkpoints) y cuáles son históricas.

## Faltantes (código sin doc dedicada)

- **`scheduler.selectScopeAwareWave`** — selección de wave consciente de scope; central para el claim de paralelismo. Merece explicación propia (hoy `docs/system` solo menciona "selección de wave").
- **`repository-index`** — sin capítulo en `docs/system`; sustenta grounding y señales estáticas.
- **`conflict-risk` (señales estáticas v0)** — documentado en `ADR-0008` pero sin capítulo de sistema.
- **`execution-core/run`**: `amendments-engine`, `grounding-agent`, `skeleton-scaffolder`, `world-reconciler` — probablemente sub-documentados.
- **`task-graph.graftSubtree`** — re-decomposición selectiva de subárbol; relevante para resume/replan.

## Notas para la reescritura (Task 4)

- Verificar capítulos `docs/system/01`–`11` uno por uno contra el código (idioma + exactitud); el README ya es buena base.
- No reintroducir narrativa de Lab Mode / benchmarks / B0-B4 (retirados).
- `GranularityVector` se mantiene como instrumento de métricas; no implica metodología académica activa.
