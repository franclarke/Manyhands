# Evidencia técnica — ManyHands

Documento complementario del Artifact. Todas las rutas son relativas a la raíz del repo.
Fuente: lectura directa del código (julio 2026, branch `main`, commit `0afc178`). Se priorizan rutas y símbolos sobre números de línea.

---

## 0. Mapa rápido slide -> evidencia

Deck corto (10 slides, 10-15 min); las slides 3, 4 y 5 fusionan lo que antes eran
varias slides separadas, así que cada una mapea a varias secciones de este documento.

| Slide | Tema | Secciones útiles |
|---|---|---|
| 1 | Qué es ManyHands | 1, 2, 11 |
| 2 | Qué problema resuelve | 4, 5, 6, 8, 9, 10 |
| 3 | La unidad de trabajo (DAG, contrato, seam) | 2, 3 |
| 4 | Ejecución y verificación | 5, 6 |
| 5 | Paralelismo e integración | 4, 7 |
| 6 | Garantías y límites | 8, 9, 10, 12 |
| — | Preguntas de trazabilidad puntual («¿dónde está eso?») | todo el documento |

---

## 1. Entry points reales

| Entry point | Ruta | Qué dispara |
|---|---|---|
| Crear run | `apps/web/src/app/api/runs/route.ts` → `POST` | Valida `RunCreateRequestSchema`, persiste `RunRecord` (status `created`), lanza `runPlanningPipeline` en background |
| Run workspace (UI) | `apps/web/src/app/runs/[runId]/page.tsx` | Siembra el reducer con `ensureRunModelEventLogForRun(run)` y monta `RunModelView` |
| Stream de eventos | `apps/web/src/app/api/runs/[id]/run-events/route.ts` → `GET` (SSE) | Replay del JSONL + suscripción al bus, cursor `?after=seq` / `Last-Event-ID` |
| Decisiones humanas | `apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts` → `POST` | Resuelve `approve_plan` / `clarify` / `resolve_conflict` / `approve_amendment` / `approve_merge` |
| Control de ciclo de vida | `pause`, `resume`, `cancel`, `restart`, `fork`, `deliver`, `answer` bajo `apps/web/src/app/api/runs/[id]/` | Todas consultan `assertRunActionAllowed` / claims antes de mutar |

## 2. Pipeline de planning

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| Pipeline web | `apps/web/src/lib/server/runs/planning-pipeline.ts` | `runPlanningPipeline`, `resumePlanningPipeline`, `transitionTo`, `projectPlanningOutcome` | Proyecta outcomes del grafo a `RunRecord` (question → `paused`, degraded → gate INV-5, awaiting_approval → `needs_review`); autonomía W6 auto-aprueba/auto-responde |
| Host | `apps/web/src/lib/server/runs/planning-host.ts` | `buildPlanningHost`, `drivePlanning`, `decomposePlanForRun`, `runCriticsForRun`, `PLAN_DEGRADED_NODE_ID` | Wiring del decomposer con streaming vivo (`livePlanningNodes`, `plan.node.*`); grounding digest del repo; D3: sin fallback silencioso |
| StateGraph | `packages/orchestrator-graph/src/graphs/planning-graph.ts` | `buildPlanningGraph`, `planningThreadId` | Topología `decomposePlan ⇄ questionGate → criticReview → approvalGate`; thread `<runId>__planning` |
| Nodos/gates | `packages/orchestrator-graph/src/nodes/planning-nodes.ts` | `questionGateNode`, `approvalGateNode`, `degradedPlanGateNode` | Interrupts nativos; resume con `Command({resume})` |
| Flujo de planning (nombre legacy) | `packages/core/src/mock-planning-flow.ts` | `runMockPlanningFlow` | Es el flujo REAL: decompose → `validateTaskGraph` + validación de contratos (throw si hay issues) → `buildStaticConflictSignals` → `buildTaskPairRiskMatrix` → `scheduleTasks` (preview de batches) |
| Decomposer recursivo | `packages/decomposer/src/llm/recursive/recursive-decomposer.ts` | `RecursiveDecomposer`, `RecursiveStepPlanningState`, `syncNodeDependencyShortcuts` | Un paso LLM por nodo: `atomic \| decompose \| question`; seams heredados (`inheritedInterfaces`, `consumes`/`produces`); 3 intentos con backoff; step cache reanudable; comentario explícito: "`graph.dependencies` stays canonical" |
| Variantes CLI | `packages/decomposer/src/llm/recursive/claude-code-recursive-decomposer.ts`, `codex-recursive-decomposer.ts` | — | Decomposición vía CLI del executor seleccionado |
| Critics | `apps/web/src/lib/plan-critic.ts` (consumido por `runCriticsForRun`) | `runPlanCritic`, `runSeamCritic` | Deterministas; findings viajan al interrupt de aprobación; persisten en `planningCritic`/`seamCritic` |
| Replan selectivo | `packages/task-graph/src/index.ts` | `graftSubtree` | Injerta un subárbol re-descompuesto sin descartar el resto; valida o lanza |

Tests: `tests/decomposer-recursive-planning-flow.test.ts`, `tests/decomposer-recursive-recovery.test.ts`, `tests/decomposer-interactive-planning.test.ts`, `packages/orchestrator-graph/src/graphs/planning-graph.test.ts`, `tests/plan-approval-service.test.ts`, `tests/plan-critic.test.ts`, `tests/task-graph-graft.test.ts`, `tests/replan-question-gate.test.ts`.

## 3. Grafo y contratos

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| DAG | `packages/task-graph/src/index.ts` | `TaskNodeSchema` (kind `root\|composite\|leaf\|integrator`, campo canónico `goal`), `TaskGraphSchema` (`dependencies` canónico), `validateTaskGraph`, `validateExecutableTaskGraph`, `getTopologicalOrder`, `getTaskReadiness`, `syncNodeDependencies` | 20 códigos de issue (`cycle_detected`, `orphan_node`, `leaf_without_contract`, `empty_scope`, `duplicate_produced_interface`, `orphan_consumed_interface`, `dependency_sync_divergence`, …) |
| Contratos | `packages/contracts/src/index.ts` | `AgentTaskContractSchema`, `InterfaceContractSchema`, `validateAgentTaskContractBoundary`, `validationCommandSafetyIssues`, `ExecutionScopeSchema` | `acceptance.min(1)`; paths seguros (sin absolutos/`..`); validation commands como argv estructurado (rechaza shell fragments); seams con firma TS real |
| Guard pre-ejecución | `packages/execution-core/src/run/graph-guards.ts` | `assertExecutableGraph` | I7: rechaza el grafo antes de crear worktrees |

Tests: `tests/domain.test.ts`, `tests/contract-boundary-validation.test.ts`, `tests/contracts-interface-contract.test.ts`, `tests/execution-core-graph-guards.test.ts`, `tests/dependency-validation.test.ts`.

## 4. Scheduling por waves

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| Selección de wave | `packages/scheduler/src/index.ts` | `selectScopeAwareWave`, `buildSchedulingSafetyContext`, `scopeSignature`, `withoutCoordinationFiles`, `scheduleTasks` | Pares high/blocking nunca co-programados; overlap de scopes serializa; configPaths y archivos de coordinación (≥3 tareas) excluidos del overlap (O-7); sin contrato/scope ⇒ serialización conservadora; frontera nunca se muere (slice(0,1)) |
| Wiring productivo | `apps/web/src/lib/server/runs/execution-host.ts` → `frontierDeps.selectWave` | `selectAndPersistSchedulingWave` | Policy fija `"risk_aware"`; risk matrix + señales estáticas desde `run.planning` |
| Auditoría | `apps/web/src/lib/server/runs/scheduling-audit-events.ts` | `selectAndPersistSchedulingWave` → `appendRunEventRequired("run.scheduling.wave_selected")` | Se persiste ANTES de devolver la wave; payload: ready/selected/blocked + `blockedReasons` + `riskSummary` + fallbacks |
| Frontera | `packages/orchestrator-graph/src/nodes/execution-nodes.ts` | `executionFrontier`, `dependencySatisfied`, `makeRouteFrontier` | `dependencySatisfied` refleja `childSettled` (fallos aceptados desbloquean; ver `repro-stranding.test.ts`) |
| Riesgo | `packages/conflict-risk/src/index.ts` | `buildTaskPairRiskMatrix`, `predictConflict`, `buildStaticConflictSignals`, `findRiskPrediction` | Evidencia ponderada: file/path/symbol overlap, producer-consumer, critical paths, fixtures compartidas + 8 familias de señales estáticas del índice |
| Índice del repo | `packages/repository-index/src/index.ts` | `RepositoryIndex`, `summarizeRepositoryIndex`, `computeRepositoryIndexHash` | Cacheado en `apps/web/src/lib/server/runs/repo-index-cache.ts` |

Tests: `tests/scheduler-scope-aware-wave.test.ts` (14 casos), `tests/run-scheduling-audit-events.test.ts`, `tests/repository-aware-scheduling.test.ts`, `packages/orchestrator-graph/src/graphs/execution-graph.test.ts` ("honours the adaptive selectWave subset").

## 5. Ejecución aislada

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| Grafo de ejecución | `packages/orchestrator-graph/src/graphs/execution-graph.ts` | `buildExecutionGraph`, `executionRecursionLimit` | `START → prepare → waveJoin →[routeFrontier]→ Send(executeLeaf)* \| leafGate \| budgetGate \| integrationJoin`; gates puros con `interrupt()` primero |
| Estado del grafo | `packages/orchestrator-graph/src/state.ts` | `RunStateAnnotation`, `mergeById`, `mergeIntegrationResults` | Retry reemplaza resultado (identity merge); tombstone `retry_pending` borra integración fallida |
| Host | `apps/web/src/lib/server/runs/execution-host.ts` | `buildExecutionHost`, `driveExecution`, `persistExecutionPause`, `clearExecutionPause`, `resumeCommand`, `gateFromInterrupt` (gateId único) | Deps reconstruidas desde el `RunRecord` persistido (resume idéntico tras restart) |
| Pipeline web | `apps/web/src/lib/server/runs/execution-pipeline.ts` | `runExecutionPipeline`, `resumeExecutionPipeline`, `settleExecutionOutcome`, `settleExecutionException` | provision → repo lock (U7) → preflight → world reconcile (INV-3) → grounding → drive → settle; excepción con checkpoint ⇒ `interrupted` reanudable |
| Ejecutor por nodo | `packages/execution-core/src/run/executor.ts` | `RunExecutor.runNode`, `executeLeafInWorktree`, `repairLeaf`, `buildLeafInstructions`, `resolveExecutorSelection` | Instrucciones: objetivo + criterios + scope como guía + forbidden duro + seams exactos + "Do not commit"; `RunExecutor.run()` (batch) queda para tests/paths secundarios |
| Worktrees | `packages/execution-core/src/worktree/manager.ts` | `WorktreeManager.create/clean/gcRun/headOf/detectUnexpectedCommit`, `worktreeBranchFor` (= `mh/<run>/<task>`), `runWorktreesRootFor` | Junction de node_modules; presupuesto de path win32; GC preserva branches con evidencia |
| Executors CLI | `packages/execution-core/src/executor/` (`cli-executor.ts`, `registry.ts`, `profiles/claude-code.ts`, `profiles/codex.ts`, `status-channel.ts`, `kill.ts`) | `AgentExecutor`, `DefaultAgentExecutorFactory`, `AGENT_STATUS_PROTOCOL_INSTRUCTIONS` | Subprocess con timeout/abort; canal `MH_STATUS`; kill de árbol verificado (INV-2) |
| Routing | `packages/execution-core/src/routing/policy.ts`, `complexity.ts`, `availability.ts` | `ComplexityRoutingPolicy`, `resolveRoutedSelection`, `probeExecutorAvailability` | metadata del nodo → router → default; `routing:"fixed"` clava la selección (y es el default al crear runs desde la ruta) |
| Grounding | `packages/execution-core/src/run/grounding-agent.ts`, `skeleton-scaffolder.ts`, `grounding-stub.ts` | `GroundingAgent.run`, `scaffoldInterfaces`, `GROUNDING_STUB_PATTERN` | Scaffold determinista + fallback LLM por lotes + gate de sintaxis; commit `mh-grounding: walking skeleton scaffold` pasa a ser `baseCommit` |

Tests: `tests/execution-core-worktree.test.ts`, `tests/execution-core-run-executor.test.ts`, `tests/execution-core-leaf-instructions.test.ts`, `tests/execution-core-routing.test.ts`, `tests/execution-core-kill-verify.test.ts`, `tests/execution-core-skeleton-scaffolder.test.ts`, `tests/execution-core-e2e.test.ts`, `packages/orchestrator-graph/src/graphs/execution-graph.test.ts`.

## 6. Fuente de verdad del resultado

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| Recorder | `packages/execution-core/src/result/recorder.ts` | `ResultRecorder.record`, `baselineSatisfiesContract` | Orden: cortes por timeout/exit≠0 → detección de commit del agente (`HEAD !== expectedHead`) → staging `addAllExcluding(DEFAULT_ARTIFACT_GLOBS)` → `diffCachedNameOnly`/`diffCached` → `empty_diff` salvo no-op probado → `ScopeChecker` → commit del orquestador (`mh: <task>`) |
| Scope | `packages/execution-core/src/scope/checker.ts` | `ScopeChecker.check` | Forbidden (deny) = `violation` dura; allow-list = `outOfScope` advisory (ADR-0023); doc-comment explícito del porqué |
| Git plumbing | `packages/execution-core/src/git/runner.ts` | `GitRunner`, `SimpleGitRunner` (`addAllExcluding`, `diffCached*`, `diffRange*`, `cherryPick`, `showFile`) | Abstracción inyectable; FakeGitRunner en tests |
| Statuses | `packages/execution-core/src/types.ts` | `AgentResultStatus`: `success \| empty_diff \| scope_violation \| validation_failed \| agent_committed_unexpectedly \| timeout \| executor_error \| internal_error`; `ExecutionConfigSchema` (maxParallel 6, leafTimeout 300s, integrationTimeout 600s, `unexpectedCommitPolicy` default `reject`) | |
| Validación | `packages/execution-core/src/validation/runner.ts`, `dependencies.ts` | `ChildProcessValidationRunner`, `ChildProcessDependencyInstaller` | argv estructurado sin shell; exit 127 en hoja se difiere como `toolchain_missing` (gate real a nivel run) |

Tests: `tests/execution-core-recorder.test.ts` (19 casos: unexpected commit reject/accept, expectedHead en repair, empty_diff, no-op contra skeleton, artifact hygiene, advisory vs violación), `tests/execution-core-scope.test.ts`, `tests/execution-core-validation-runner.test.ts`, `tests/execution-core-artifact-hygiene.test.ts`.

## 7. Integración bottom-up

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| Composer | `packages/execution-core/src/integration/agent.ts` | `IntegrationAgent.integrate`, `attemptRepair`, `buildRepairPrompt`, `validateChildCommits`, `DEFAULT_MAX_REPAIRS_PER_INTEGRATION = 4`, `MAX_REPAIR_PASSES = 2` | Cherry-pick por hijo en orden; conflicto → repair con parentGoal + `sharedInterfaces` + `childIntents` + diffs de hermanos + `preMergeFindings` + `predictedConflicts`; gate de sintaxis re-inyecta diagnósticos del compilador; presupuesto agotado ⇒ aborta cherry-pick y PRESERVA el commit parcial |
| Pre-merge | `packages/execution-core/src/integration/pre-merge.ts`, `syntax-check.ts` | `computePreMergeFindings`, `checkRepairedFiles` | Diagnóstico determinista previo al gasto de executor |
| Orden bottom-up | `packages/orchestrator-graph/src/nodes/execution-nodes.ts` | `nextIntegrableComposite` (sort `depth desc`), `integrateNextCompositeNode` (uno por superstep), `childSettled`, `settledResultFor` | Composite integrado se vuelve hijo sintético de su padre; fallo aceptado solo desbloquea al padre si dejó commit |
| Conflictos predichos | `apps/web/src/lib/server/runs/execution-pipeline.ts` | `derivePredictedConflicts` | Reusa el cómputo de la UI (`deriveConflictList`) para que foresight y repair sean consistentes (D8/Pieza 2) |
| Validación a nivel run | `execution-host.ts` → `validateRun` | comandos del contrato del root sobre el worktree del root integrado | Fallos aceptados por el humano cuentan como resueltos (P2b) |
| Entrega | `apps/web/src/lib/server/runs/final-apply.ts` | `applyFinalPatch`, `buildRunBranchName` (`manyhands/run-<id>-<slug>`) | Worktree detached aislado desde `baseCommit`; degrada a `exported_patch`/`failed`, nunca crash opaco |

Tests: `tests/execution-core-integration.test.ts` (22 casos), `tests/execution-core-pre-merge.test.ts`, `tests/execution-core-syntax-check.test.ts`, `tests/final-apply.test.ts`, `tests/deliver-route-guard.test.ts`, `packages/orchestrator-graph/src/graphs/repro-stranding.test.ts`.

## 8. Event log, reducer y selectors

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| Vocabulario | `apps/web/src/lib/run-model/types.ts` | `RunEvent` (seq/at/runId/actor/type/payload), `RUN_EVENT_TYPES` (~40 tipos v1), `Decision`, `Seam`, `Amendment`, `RunSchedulingWaveSelectedPayload` | `RUN_EVENT_TYPES_V2` definidos pero no emitidos (declarado en el propio archivo) |
| Log persistente | `apps/web/src/lib/server/runs/run-model-event-log.ts` | `appendRunEventRequired`, `appendRunEventBestEffort`, `readRunModelEvents`, `withLock` | JSONL por run; seq bajo write-chain lock global; required = la operación falla si no se puede escribir |
| Espejo de traces | `apps/web/src/lib/server/runs/live-trace-store.ts` + `run-model-trace-adapter.ts` | `LiveExecutionTraceStore`, `runModelEventsFromTrace` | `executor_started → node.execution.started`, cherry-pick/validation → eventos de integración; `agent_started` deliberadamente NO mapeado (F-003) |
| SSE | `apps/web/src/app/api/runs/[id]/run-events/route.ts` + `apps/web/src/components/run-model/use-live-run-model.ts` | cursor `?after=` / `Last-Event-ID`, backoff con jitter, full replay ante gap (INV-7) | |
| Reducer | `apps/web/src/lib/run-model/reducer.ts` | `reduceRunEvent` (idempotente por `seq <= cursor`), `createInitialRunModel` | Entidades solamente; sin `node.invalidated`; `seam.amended` no marca stale |
| Selectors | `apps/web/src/lib/run-model/selectors.ts` | `selectPhase`, `selectHealth`, `selectWavefront`, `selectAttention`, `selectFreshness` (stale ⇔ revisión anterior + cambio de FIRMA), `selectInvalidatedNodes`, `selectRenderableNodeState` (`gated`, `obsolete`) | La UI pinta solo `display` |
| View-models | `apps/web/src/lib/run-model/workspace-view.ts`, `focus-view.ts`, `timeline-view.ts`, `decision-channel-view.ts` | — | Consumidos por `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx` |

Tests: `tests/run-model-reducer.test.ts`, `tests/run-model-selectors.test.ts`, `tests/run-model-invariants.test.ts`, `tests/run-model-fixtures.test.ts` (golden: happy path, planning question, verify auto-repair, behavioral conflict, seam amendment blast radius, execution failed, planning fallback), `tests/run-events-replay.test.ts`, `tests/run-model-live.test.ts`, `tests/run-event-persistence.test.ts`.

## 9. Human-in-the-loop y ciclo de vida

| Pieza | Ruta | Símbolos | Notas |
|---|---|---|---|
| Matriz de acciones | `apps/web/src/lib/server/runs/lifecycle.ts` | `ALLOWED_TRANSITIONS`, `assertTransition`, `ACTION_ALLOWED_STATUSES`, `assertRunActionAllowed`, `restartResumesExecution`, `isTerminalStatus` | `deliver` solo terminal; `fork` solo estados estables; `answer_gate` solo `paused` |
| Gates de ejecución | `packages/orchestrator-graph/src/nodes/execution-nodes.ts` | `leafGateNode`, `conflictGateNode`, `budgetGateNode`, `LeafGateDecision`, `ConflictGateDecision`, `BudgetGateDecision` | interrupt-first (reanudar no re-ejecuta agentes); budget siempre ENTRE waves |
| Proyección de pausa | `apps/web/src/lib/server/runs/execution-host.ts` | `persistExecutionPause` (mint de `gateId`), `clearExecutionPause` (claim con status+gateId+version), `mergeConflictGateCopy` (copy por failureClass) | INV-4: duplicados/tabs viejos ⇒ 409 |
| Concurrencia | `apps/web/src/lib/server/runs/mutation-guard.ts` | `claimRunMutation` | CAS por `version` del RunRecord |
| Rutas | `decisions/[decisionId]/route.ts`, `answer/route.ts`, `execution-gate-service.ts`, `plan-approval-service.ts`, `replan-service.ts` | `answerExecutionGate`, `processPlanApproval`, `resumeReplanWithAnswer` | `decision.resolved` es evento required |
| Autonomía | `apps/web/src/lib/server/runs/schema.ts` (`AutonomySchema`) + `planning-pipeline.ts` (W6) | supervised / semi / autonomous | autonomous auto-responde clarify con la primera opción (recomendada) |

Tests: `tests/run-lifecycle.test.ts`, `tests/mutation-concurrency.test.ts`, `tests/answer-route-execution-gate.test.ts`, `tests/decision-route-choice-validation.test.ts`, `tests/resume-route-concurrency.test.ts`, `tests/run-start-cas.test.ts`, `tests/execution-gate-copy.test.ts`.

## 10. Robustez operativa

| Pieza | Ruta | Símbolos |
|---|---|---|
| Checkpoints | `packages/orchestrator-graph/src/checkpointer.ts` — `JsonFileCheckpointSaver`, `ThreadCheckpointHealth` (ok/degraded/lost/missing) |
| Reconciliación en frío | `packages/execution-core/src/run/world-reconciler.ts` + `apps/web/src/lib/server/runs/world-reconcile.ts` — `reconcileExecutionWorld` (INV-3; evento `world.reconciled`) |
| Lock por repo | `apps/web/src/lib/server/runs/repo-lock.ts` — `acquireRepoLock` (U7, robo de locks stale) |
| Watchdogs | `runner-watchdog.ts` (wall-clock), `runner-heartbeat.ts` + `interrupted.ts` (sweep de runners muertos) |
| Cancelación | `run-abort-registry.ts` + `executor/kill.ts` + `cancel/route.ts` — kill verificado, evento `run.cancelled` con inventario |
| Amendments | `packages/execution-core/src/run/amendments-engine.ts` + ruta de decisiones (`approve_amendment`) — invalida el closure, resetea el thread, re-ejecuta solo lo inválido |

Tests: `packages/orchestrator-graph/src/checkpointer.test.ts`, `tests/checkpointer-corruption.test.ts`, `tests/world-reconciler.test.ts`, `tests/world-reconcile-web.test.ts`, `tests/repo-lock.test.ts`, `tests/cancel-route.test.ts`, `tests/run-interrupted-sweep.test.ts`, `tests/execution-core-replan-invalidation.test.ts`.

## 11. Relaciones entre componentes (flujo de datos)

```
POST /api/runs ──► RunRecord(created) ──► runPlanningPipeline
                                            │  planning-graph (thread <run>__planning, checkpoints JSON)
                                            │  decomposePlanForRun ──► RecursiveDecomposer (LLM CLI)
                                            │        └─ runMockPlanningFlow: validate graph+contracts,
                                            │           static signals + risk matrix + schedule preview
                                            │  criticReview ──► approvalGate (interrupt)
                                            ▼
                          Decision approve_plan (humano o autonomía)
                                            ▼
runExecutionPipeline ──► provision repo ──► repo lock ──► preflight ──► world reconcile
        ──► GroundingAgent (seam.frozen*, skeleton commit = baseCommit)
        ──► execution-graph (thread <runId>, checkpoints JSON)
              waveJoin ─[routeFrontier]─► selectAndPersistSchedulingWave
                                            │ (run.scheduling.wave_selected REQUERIDO)
                                            ▼
                              Send(executeLeaf) × wave
                                RunExecutor.runNode:
                                  WorktreeManager.create (mh/<run>/<task> @ skeleton)
                                  AgentExecutor.execute (CLI subprocess)
                                  ResultRecorder.record (diff → scope → commit orquestador)
                                  leafValidationCommands → repairLeaf → leafGate (interrupt)
              integrationJoin ─[routeIntegration]─► integrateNextComposite (1/superstep)
                                IntegrationAgent: cherry-pick* → Composer repair → parent validation
                                └─ fallo → conflictGate (interrupt)
              runValidation ──► settleExecutionOutcome ──► applyFinalPatch (branch manyhands/run-*)
                                            ▼
        eventos (LiveExecutionTraceStore + publishRunModelEvent) ──► <runId>.events.jsonl
                                            ▼
        SSE /run-events (seq cursor) ──► useLiveRunModel ──► reducer ──► selectors ──► workspace UI
```

## 12. Verificación de las invariantes solicitadas

| Invariante | Veredicto | Evidencia |
|---|---|---|
| `goal` es el campo canónico | ✅ | `TaskNodeSchema.goal` requerido; no existe `intent` en TaskNode (el `Run.intent` del run-model es el prompt del usuario, otra entidad) |
| `graph.dependencies` canónico | ✅ | `syncNodeDependencies`, issue `dependency_sync_divergence`, comentario en `syncNodeDependencyShortcuts` (decomposer) |
| `git diff HEAD` determina lo cambiado | ✅ con matiz | `ResultRecorder.record`: staging + `diffCached*` (≡ diff vs HEAD tras stagear; incluye untracked) o `diffRange` para rango commiteado; stdout jamás decide |
| Agentes no commitean; el orquestador sí | ✅ | prompts "Do not commit"; `git.commit` solo en recorder/integration/grounding; `agent_committed_unexpectedly` + política |
| Aislamiento = worktrees + ScopeChecker | ✅ con matiz | worktree por tarea + forbidden duro; allow-list es advisory por diseño (ADR-0023) |
| Scheduler productivo `risk_aware` por waves | ✅ | `selectAndPersistSchedulingWave` (policy hardcodeada) + `selectScopeAwareWave` en `frontierDeps.selectWave` |
| Integración bottom-up por cherry-pick | ✅ | `nextIntegrableComposite` (depth desc) + `IntegrationAgent.integrate` |
| Conflictos → reparación semántica (`IntegrationAgent`) | ✅ | `attemptRepair` + `buildRepairPrompt` con contrato |
| Acciones humanas bloqueantes = decisiones | ✅ | `decision.raised {blocking:true}` en gates; canal de decisiones |
| `gated` derivado de decisiones pendientes | ✅ | `selectRenderableNodeState` + `hasPendingBlockingDecision`; test "renders as gated" |
| Estado visible derivado del event log | ✅ | page seed + SSE → mismo reducer; selectors puros |
| `assertRunActionAllowed` protege transiciones | ✅ | matriz + uso en rutas; tests de lifecycle |
| `run.scheduling.wave_selected` antes del dispatch | ✅ | append REQUIRED antes de retornar la wave; test del fallo de append |
