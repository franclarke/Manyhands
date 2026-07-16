# Fase 1 — System Coverage Audit (ManyHands)

> Estado: **partial** (cobertura estructural amplia; zonas listadas en §22 quedan para continuación).
> Ledger reanudable: [`phase-1-coverage-ledger.json`](phase-1-coverage-ledger.json).
> Auditado: branch `main`, HEAD `deb370a1`, working tree con cambios locales solo de docs.

## 1. Executive summary

ManyHands es un monorepo pnpm de 1 app (`@manyhands/web`, Next.js) y 12 paquetes.
El producto está sustancialmente conectado de punta a punta: creación de run con
selecciones independientes de planner/executor, planning vía StateGraph LangGraph,
ejecución por waves `risk_aware` con worktrees + ScopeChecker, integración
bottom-up con cherry-pick y repair semántico acotado (4 intentos), log durable
JSONL de `RunEvent` como fuente canónica de la UI (SSE con cursor), y máquina de
lifecycle centralizada con leases/fencing.

Los desvíos principales respecto del comportamiento canónico declarado:

1. **No existe descubrimiento dinámico de capabilities.** El catálogo de
   CLIs/modelos/efforts es estático y hardcodeado (`packages/shared/src/executor-registry.ts`);
   la "detección" solo prueba `<bin> --version` y credenciales.
2. **El effort no es independiente por etapa**: hay un único
   `executionConfig.reasoningEffort` que comparten planning y execution, y la UI
   solo lo muestra según el modelo de *execution*.
3. **La ruta de regeneración de subárboles ignora la selección de planning del
   run** (usa el decomposer default con el modelo de execution) — finding confirmado.
4. Persisten restos legacy conectados o semi-conectados: bus de eventos
   `StreamEvent` sin suscriptores productivos, barrel `@manyhands/core` con
   `runMockPlanningFlow` (mal llamado "mock": es el harness real de planning),
   lanes de routing por complejidad con un model id inexistente, ruta `/runs/proto`
   con fixtures shippeada, y `@manyhands/run-store` sin consumidores funcionales claros.

## 2. Alcance y metodología

- Auditoría estructural del working tree completo (HEAD + cambios locales).
- Sin runs reales ni invocaciones a modelos externos. Sin mutaciones fuera de `docs/audits/`.
- Métodos: lectura dirigida de código, grep de símbolos/consumidores, comandos
  git read-only, y 2 ejecuciones de tests unitarios muy dirigidos (13 tests, todos verdes).
- Independiente: no se leyeron auditorías anteriores (`docs/repository-completion-audit.md`
  está borrado localmente y no se consultó).

## 3. Repository baseline

- Fecha: 2026-07-12T23:56:45-03:00 · Branch `main` · HEAD `deb370a14d6dca2bf63a50c4564d8d2fa8fa160a`.
- `git status --short`: `M .claude/launch.json`; 6 docs eliminados sin commit
  (`docs/implementation-progress-phase-*.md`, `docs/repository-completion-audit.md`).
- Untracked: `docs/presentation/` (8 archivos), `docs/tesis/` (3 archivos) — solo documentación.
- **Ningún cambio local toca `apps/` ni `packages/`**: el código productivo auditado es el de HEAD.

## 4. Monorepo map

Workspaces (`pnpm-workspace.yaml`: `packages/*`, `apps/*`). Dependencias internas
declaradas (todas respetan `apps → packages → shared` a nivel manifest; no se
encontró ningún import de `apps` dentro de paquetes en las inspecciones hechas):

| Workspace | Rol | Deps internas |
|---|---|---|
| shared | registry de executors + base | — |
| contracts | AgentTaskContract / InterfaceContract / scopes | shared |
| task-graph | TaskNode/TaskGraph/DAG | contracts, shared |
| repository-index | grounding estructural | shared |
| trace-store | trazas | shared |
| conflict-risk | señales/matriz de riesgo | contracts, repository-index, shared |
| decomposer | decomposers recursivos CLI + Anthropic + mock | contracts, shared, task-graph |
| scheduler | waves risk_aware | conflict-risk, contracts, task-graph |
| execution-core | worktrees, executors, scope, recorder, validación, integración, routing, grounding | 7 paquetes |
| orchestrator-graph | StateGraphs LangGraph + checkpointer JSON | contracts, execution-core, task-graph, trace-store |
| run-store | RunSnapshot / persistencia legacy | 8 paquetes |
| core | **barrel legacy** + mock/planning flows | 8 paquetes |
| web (app) | UI + APIs + runner + hosts | 9 paquetes |

Auxiliares: `scripts/manyhands-dev.mjs` (launcher dev), `design-system/` (tokens/specs),
`tests/` (173 tests raíz), `patches/`, `tmp/`, `t/`, `output/playwright`.

## 5. Product architecture

Camino productivo principal (server-side de `apps/web`):

```
POST /api/runs ──(background)──► runPlanningPipeline ─► planning StateGraph (LangGraph)
                                    │ decompose ⇄ questionGate → critics → approvalGate (interrupts nativos)
                                    │ pickDecomposer → ClaudeCode|Codex RecursiveDecomposer
                                    ▼
                        RunRecord (needs_review) ─ aprobación ─► POST /api/runs/[id]/run
                                    ▼
                execution-pipeline: preflight → repo lock/lease → provision → execution StateGraph
                    prepare → waveJoin → Send(executeLeaf)* → leafGate → integrationJoin
                    → integrateNextComposite (IntegrationAgent: cherry-pick + repair ≤4)
                    → conflictGate (decisión humana) → runValidation → END
                                    ▼
                FinalArtifactManifest → applyFinalPatch (rama manyhands/run-*) → delivery.ts
```

Todo el estado observable de la UI se deriva del JSONL durable de `RunEvent`
(`run-model-event-log.ts`) servido por SSE (`/api/runs/[id]/run-events`) y
reducido en el cliente (`lib/run-model/reducer.ts` + selectores).

## 6. Component registry

Registro completo (con evidencia, riesgos y madurez) en `components[]` del ledger.
Resumen de estados:

| Componente | Conexión | Madurez |
|---|---|---|
| executor-registry (shared) | productive | complete |
| provider-readiness | productive | mostly-complete |
| models-ui (`lib/models.ts`) | productive | complete |
| run-create route | productive | complete |
| executor-selection | productive | complete |
| decomposer-policy | productive | mostly-complete |
| planning pipeline/host | productive | mostly-complete |
| execution pipeline/host | productive | mostly-complete |
| RunExecutor (execution-core) | productive | mostly-complete |
| IntegrationAgent | productive | mostly-complete |
| scheduler risk_aware | productive | mostly-complete |
| run-model (reducer/selectores) | productive | mostly-complete |
| run-model-event-log (JSONL) | productive | mostly-complete |
| lifecycle-guard | productive | complete |
| durable-ops (lease/lock/supervisión) | productive | unverified (profundidad Fase 2) |
| terminal-sessions | productive | unverified |
| ComplexityRoutingPolicy | partial | partial |
| core barrel + mock flows | partial | obsolete (naming engañoso; ver §18) |
| run-store | partial | unverified |
| legacy event-bus | disconnected | obsolete |
| run-model/sse-adapter.ts | disconnected | obsolete |
| /runs/proto + fixtures golden | test-only | complete |

## 7. CLI, model and effort capability pipeline

```
local environment           binarios `claude`/`codex` en PATH u override MANYHANDS_{CLAUDE,CODEX}_BIN
→ CLI detection             readiness.ts defaultCheckCli: `<bin> --version` (10s). Solo presencia+versión.
→ capability/model registry ESTÁTICO: packages/shared/src/executor-registry.ts:15-27.
                            claude-code-cli {haiku,sonnet,opus}, codex-cli {gpt-5.5,gpt-5.4,gpt-5.4-mini},
                            opencode-cli enabled:false. Capabilities por modelo (solo sonnet y gpt-5.5 tienen "planning").
→ API/server representation /api/providers/readiness devuelve ProviderReadiness[] (checks CLI/auth/repo/branch/commands/quota).
                            Las OPCIONES de modelo NO viajan por API: la UI importa MODEL_OPTIONS estáticas de lib/models.ts.
→ UI options                command-center-shell.client.tsx + model-picker/effort-control: pickers independientes
                            planning y execution ("executorId/modelId"); effort visible solo si el modelo de
                            execution ∈ EFFORT_CAPABLE_MODEL_IDS (models.ts:42 — hardcodeado, familia GPT-5).
→ user selection            POST /api/runs {planningModel, planningExecutorId, defaultExecutionSelection,
                            defaultRepairSelection, executionConfig.reasoningEffort}
→ validation                validateSelectionForCapability por etapa contra capabilities del registry;
                            rechazo explícito 400 (runs/route.ts:69-114). Verificado con tests (5/5 pass).
→ run configuration         withDefaultReasoningEffort inyecta "medium" si execution=codex sin effort;
                            routing forzado a "fixed" (runs/route.ts:127).
→ persisted state           RunRecord: model (=execution), planningModel, planningExecutorId,
                            defaultExecutionSelection, defaultRepairSelection, executionConfig.
→ planning invocation       planningSelection(run) (executor-selection.ts:16) → planning-host →
                            pickDecomposer({executorId, model, reasoningEffort}) → decomposer CLI.
→ execution invocation      executionSelection(run) → execution-host executeLeaf (execution-host.ts:383)
                            → RunExecutor.runNode({defaultExecutionSelection}) → perfil CLI
                            (codex.ts:21 agrega `-c model_reasoning_effort=...`; claude-code solo --model).
```

Distinciones verificadas:

- **Disponibilidad de CLI**: readiness `--version` + `probeExecutorAvailability`
  (esta última solo para routing por complejidad, no para selecciones fijas).
- **Disponibilidad de modelo**: *no se verifica nunca* contra el CLI real; solo pertenencia al registry.
- **Effort permitido**: enum estático `low|medium|high|xhigh` (execution-core/types.ts:349);
  el gate por modelo vive duplicado en la UI (models.ts:42), no en el registry.
- **Seleccionado vs persistido vs efectivo**: coinciden vía executor-selection.ts,
  salvo la excepción del regen (finding F1).
- **Fallback silencioso**: `withDefaultReasoningEffort→medium` (codex) y
  `normalizeExecutorSelection` (string legacy → claude-code-cli) son fallbacks
  silenciosos deliberados; el fallback de decomposer mock **no** es silencioso en
  planning (guard D3, planning-host.ts:628-641 lanza error accionable) pero el
  regen lo permite bajo `MANYHANDS_FORCE_FALLBACK` (F5).
- **Reanudar con selección no disponible**: no hay re-validación; el fallo
  aparecería al spawn del CLI en el leaf (comportamiento exacto no confirmado — open question).

## 8. Planning configuration trace

`planningSelection(run)` = `{planningExecutorId, planningModel ?? model}` con
fallback legacy (executor-selection.ts:16-24). El host (planning-host.ts:211-267)
pasa `executorId`, `model` y `run.executionConfig.reasoningEffort` a
`pickDecomposer` (decomposer-policy.ts:64-144):

- `codex-cli` → `CodexRecursiveDecomposer` (usa reasoningEffort).
- `claude-code-cli` → `ClaudeCodeRecursiveDecomposer` (recibe reasoningEffort pero no lo usa: el CLI no tiene flag).
- otro executorId → error explícito.
- sin executorId → default ClaudeCode (solo camino legacy/regen).
- env `MANYHANDS_DECOMPOSER=single-pass|anthropic-recursive` → Anthropic API (requiere ANTHROPIC_API_KEY; si falta → mock → rechazado por guard D3).

Si `planningExecutorId === "codex-cli"` y no hay effort, el host persiste
`reasoningEffort: "medium"` silenciosamente (planning-host.ts:216-222) aunque la
UI nunca haya mostrado el control (solo lo muestra para el modelo de execution).

## 9. Execution configuration trace

`executionSelection(run)` = `defaultExecutionSelection ?? planningSelection` y
`repairSelection` = `defaultRepairSelection ?? executionSelection`
(executor-selection.ts:26-43). `executeLeaf`/`repairLeaf` (execution-host.ts:379-500)
crean un `RunExecutor` y pasan la selección; el effort viaja por
`executionConfig.reasoningEffort` al perfil de CLI. Config efectiva: `ExecutionConfigSchema.parse`
con defaults (`maxParallel=6`, `scopePolicy=advisory`, `unexpectedCommitPolicy=reject`)
persistida por `persistEffectiveExecutionConfig` antes del scheduler.

Routing: el producto crea runs con `routing:"fixed"`; `routerFor` devuelve
`ComplexityRoutingPolicy` solo para runs legacy sin selección explícita
(execution-host.ts:351-357) — ver F3/R3.

## 10. End-to-end product flows

| # | Etapa | Estado | Evidencia clave |
|---|---|---|---|
| 1-4 | Arranque, detección CLIs, "descubrimiento" de modelos/efforts, capabilities→UI | verified (estático) | §7 |
| 5-10 | The Goal: objetivo, workspace, granularidad, planner y executor independientes | verified | command-center-shell.client.tsx:160-220; RunCreateRequestSchema |
| 11 | Creación y persistencia del run | verified (+tests) | runs/route.ts:88-168 |
| 12 | Grounding/indexación | mapped-unverified | repo-index-cache.ts, run/grounding-agent.ts, groundingSelection |
| 13-15 | Planning, DAG, contratos | partially-verified | planning-graph.ts, runMockPlanningFlow harness, decomposer recursivo |
| 16 | Aprobación/aclaración/replan/amendment | mapped-unverified | plan-approval-service.ts, replan-service.ts, amendments-engine.ts, interrupts nativos |
| 17-19 | Waves, risk_aware, dispatch | partially-verified (+8 tests wave audit) | scheduling-audit-events.ts (selectAndPersist… persiste wave_selected con seq), scheduler/index.ts:216-388 |
| 20-22 | Worktrees, executor, detección de cambios reales | partially-verified | WorktreeManager (executor.ts:183-201), perfiles CLI, diff/currentHead en attempt journal |
| 23 | Scopes | partially-verified | ScopeChecker en ResultRecorder e IntegrationAgent; sintéticos {passed:true} solo para composites (executor.ts:1412-1472) |
| 24-25 | Validación y commit del orquestador | partially-verified | validation/runner.ts, transitionAttempt commit_created (execution-host.ts:437) |
| 26-28 | Integración bottom-up, cherry-pick, repair semántico | partially-verified | IntegrationAgent, DEFAULT_MAX_REPAIRS_PER_INTEGRATION=4 (agent.ts:67) |
| 29 | Decisiones humanas bloqueantes | partially-verified | conflictGate/leafGate en execution-graph.ts; decisions route; gated derivado (selectors.ts:304-310) |
| 30-32 | Root, artifact, finalización | mapped-unverified | final-apply.ts (applied/exported_patch/failed), final-artifact.ts, delivery.ts |
| 33 | Eventos y checkpoints | verified | run-model-event-log.ts (seq, atomic rename), JsonFileCheckpointSaver |
| 34 | SSE + estado derivado | verified | run-events/route.ts (cursor after/Last-Event-ID) → reducer/selectores |
| 35 | Pause/resume/cancel/recovery | partially-verified | cancel-service.ts (orden documentado y implementado: CAS cancelling → invalidar lease → abort → kill verificado allDead → interrupted), world-reconcile.ts (INV-3), interrupted.ts |

## 11. Lifecycle and persistence map

Máquina central en `lifecycle.ts:4-28` (`ALLOWED_TRANSITIONS`), con `assertTransition`
y acciones validadas (`RunLifecycleAction`). Estados terminales separados por
outcome (`completed`, `completed_with_accepted`, `partial`, `unverified`,
`needs_delivery`, `failed_artifact`, `failed_delivery`) reabribles vía `approved`.
Escrituras protegidas por operation lease (CAS + fencing, `run-operation-lease.ts`),
repo lease con heartbeat (`repo-lock.ts`), supervisión de procesos (`process-supervision.ts`)
y watchdog de presupuesto. Orden en cancel (verificado en código y comentario):
persistencia CAS → invalidación de lease → abort → kill verificado → estado
`interrupted` + evento durable antes de responder.

Riesgo anotado (sin profundizar): la dualidad `RunRecord` (repository.ts) +
JSONL de eventos + checkpoints LangGraph implica tres almacenes que deben
converger; `world-reconcile.ts` existe precisamente para eso en cold-restart —
unidad candidata a auditoría profunda de atomicidad/idempotencia.

## 12. Event and derived-state map

- Canónico: `RunEvent` JSONL por run (append con seq y rename atómico, write
  chains por bundle en globalThis) → bus en memoria `run-model-event-bus` → SSE.
- El cliente reduce a `RunModel` y deriva vistas; `gated` se deriva exclusivamente
  de decisiones pendientes (selectors.ts:304-321) — cumple el invariante.
- **Duplicado muerto**: `event-bus.ts` (StreamEvent) tiene ~8 publicadores y cero
  suscriptores productivos (solo tests). F2.
- Reducers para eventos nunca emitidos / eventos sin reducer: no auditado
  exhaustivamente (pendiente Fase 2 con la matriz RunEventType ↔ reducer).

## 13. Integration and artifact application map

- `IntegrationAgent` (execution-core/integration/agent.ts): cherry-pick por hijo,
  pre-merge findings, repair semántico ≤4 por integración, resultado con
  `repairAttempts` para trazas. Conflictos no resueltos → `conflictGate` (interrupt).
- `applyFinalPatch` (final-apply.ts): rama `manyhands/run-*`; degradación a
  `exported_patch` y `failed` explícitas; subprocesos supervisados; repo lease.
- `delivery.ts`: merge/discard/cleanup sobre la rama del run, rehúsa working tree sucio.
- `FinalArtifactManifest` separa execution/artifact/delivery outcomes (schema.ts) —
  consistente con la regla "no llamar completed a un artifact parcial".

## 14. Connection and maturity matrix

Ver tabla de §6 y `components[]` del ledger (campos completos: consumers,
eventos, side effects, evidencia, riesgos, preguntas).

## 15. Confirmed findings

1. **F1 — Regen ignora la selección de planning.**
   `regen/route.ts:110-114` llama `pickDecomposer` sin `executorId` y con
   `model: run.model` (modelo de execution). Un run planificado con Codex
   regenera subárboles con Claude Code y modelo equivocado, sin effort.
   Causa inmediata: ruta legada no migrada a `executor-selection.ts`.
2. **F2 — Bus StreamEvent legacy es un sink muerto.** Publicado desde 8+ módulos;
   `subscribeRunEvents`/`getRunEventHistory` solo se usan en `tests/run-runner.test.ts`.
   El SSE real consume el JSONL durable. Doble emisión + memoria + confusión de fuente de verdad.
3. **F3 — `DEFAULT_TIER_ROUTES` referencia `gpt-5-codex`, inexistente en el registry**
   (routing/policy.ts:48-68 vs executor-registry.ts:21-25). Alcanzable solo por
   runs legacy con routing `complexity` (ver R3).
4. **F4 — Effort único run-level, no por etapa.** Un solo
   `executionConfig.reasoningEffort` compartido; UI condicionada al modelo de
   *execution*; si planning=codex y execution=claude, el control se oculta y
   planning-host inyecta `medium` silenciosamente (planning-host.ts:216-222).
5. **F5 — Guard anti-mock inconsistente.** Planning rechaza el decomposer
   determinístico con error accionable para las tres razones (planning-host.ts:628-641,
   confirmado por stderr del test), pero el regen lo permite cuando
   `fallbackReason === "forced_by_env"` (regen/route.ts:115).

## 16. Strong risks

- **R2 — `/runs/proto` + fixtures golden shippeados** en el build de producto (superficie no productiva).
- **R3 — Default de `routing` divergente**: schema default `complexity`
  (types.ts:356) vs `fixed` forzado al crear (runs/route.ts:127). Runs legacy sin
  executionConfig normalizan a `complexity` y activan lanes obsoletas (F3).
- **R4 — Sin re-validación de disponibilidad al reanudar**: una selección fija
  cuyo CLI fue desinstalado falla tarde, por leaf, en el spawn.
- **R5 — Conocimiento de capabilities duplicado**: `EFFORT_CAPABLE_MODEL_IDS`
  (models.ts:42) vive fuera del registry; renombrar modelos rompe silenciosamente el gate de effort.

## 17. Hypotheses for deeper investigation

- **H2** (parcialmente mitigada por 8 tests verdes de wave audit): garantizar que
  `run.scheduling.wave_selected` se persiste estrictamente antes del dispatch en
  *todos* los caminos (incl. resume/reseed).
- **H3**: `run-store` no aporta ninguna función ejecutada en producto (solo el tipo `RunSnapshot`).
- **H4**: consistencia RunRecord ↔ JSONL ↔ checkpoint bajo crash en cada frontera
  (post-persist/pre-evento, etc.) — requiere auditoría dirigida de `audited-mutation.ts` y `world-reconcile.ts`.
- (H1 cerrada: los `scopeCheck` sintéticos son solo para resultados compuestos.)

## 18. Disconnected, duplicate and obsolete code

| Elemento | Clase | Evidencia | Nota |
|---|---|---|---|
| `lib/server/runs/event-bus.ts` + call sites `publishRunEvent` | duplicate | sin suscriptores productivos | superseded por run-model-event-log |
| `lib/run-model/sse-adapter.ts` | disconnected | 0 imports | adaptador legacy→RunEvent nunca cableado |
| `@manyhands/core` (barrel) | obsolete (parcial) | CLAUDE.md lo veda; web aún importa tipos y `runMockPlanningFlow` | **ojo**: `mock-planning-flow.ts` es el harness productivo real de planning con nombre engañoso; no borrar sin renombrar/mover |
| `@manyhands/run-store` | unknown | único consumidor: core (re-export); web usa solo el tipo `RunSnapshot` | confirmar H3 |
| `opencode-cli` en registry | obsolete | `enabled:false`, comentario "historical selection" | riesgo bajo-medio: runs persistidos históricos |
| `/runs/proto` + `run-model/fixtures/golden-*` | test-only | consumidos solo por proto y tests | mover fixtures a tests, quitar la ruta |
| `ComplexityRoutingPolicy` + lanes | partial | solo alcanzable por runs legacy | decisión de producto: conservar (y arreglar F3) o eliminar |
| Comentario "gemini-only box" (execution-host.ts:348) | obsolete-doc | CLAUDE.md prohíbe Gemini | trivial |

## 19. Removal candidates

Detalle con riesgo de eliminación y validaciones necesarias en
`removalCandidates[]` del ledger. Orden sugerido por riesgo ascendente:
sse-adapter → comentario gemini → proto/fixtures → event-bus legacy →
opencode-cli → complexity routing (decisión) → core barrel + run-store (requiere
migración de imports y renombre del harness de planning).

## 20. Verification commands and results

| Comando | Propósito | Resultado |
|---|---|---|
| `git branch/rev-parse/status`, `date` | baseline | main @ deb370a; cambios locales solo docs |
| `node -e` sobre manifests | grafo de deps | 13 workspaces, direcciones correctas |
| greps dirigidos (≈15) | trazas de config, consumidores, eventos | ver ledger `commandsExecuted` |
| `node -e JSON.parse(ledger)` | validez del ledger | OK |
| `npx vitest run tests/run-create-route.test.ts` | validar traza de creación/selecciones/effort | 5/5 pass; stderr confirmó guard D3 |
| `npx vitest run tests/run-scheduling-audit-events.test.ts` | validar persistencia de wave audit | 8/8 pass |

## 21. Structural coverage accounting

- Apps inspeccionadas / encontradas: **1/1** (server-side en profundidad; UI client components solo listados).
- Packages inspeccionados / encontrados: **12/12 registrados**; en profundidad 5
  (shared, decomposer-policy+decomposer, execution-core parcial, core, scheduler grep),
  superficial 7.
- Entrypoints API clasificados / encontrados: **38/38 listados y agrupados**; leídos en detalle 4.
- Componentes clasificados / registrados: **22/22** (todos con conexión y madurez).
- Flujos trazados / requeridos: **35/35 pasos mapeados**; verificados 8, parcialmente 18, solo mapeados 9.
- Fórmula del agregado (si se necesita un número): media simple de las 5 razones
  anteriores usando "inspección profunda" como numerador estricto →
  (1 + 5/12 + 4/38 + 22/22 + 8/35) / 5 ≈ **0.55 profundo**, con cobertura de
  *registro/clasificación* ≈ **1.0**. No usar el 0.55 sin esta aclaración.

## 22. Uninspected or unresolved areas

- UI client components (command-center y run workspace) — solo listados.
- `orchestrator-graph`: nodes y checkpointer leídos solo por encabezado/topología.
- Rutas de lifecycle no leídas línea a línea: pause, resume, restart, fork,
  deliver, answer, decisions, plan-review, auto-resolve, integrator, artifacts,
  diagnostics, export, serialize, dependencies, risks, terminals, workspace-*.
- `terminal-sessions.ts` (superficie de seguridad), `workspaces` repo,
  `local-fs/pick-folder`, `run-titler`, `preflight`, `repo-provisioner`,
  `grounding-agent` en detalle, `design-system/`, `scripts/manyhands-dev.mjs`.
- Matriz exhaustiva RunEventType ↔ reducer (eventos huérfanos en ambas direcciones).
- Contenido de `tmp/`, `t/`, `output/` (presuntos descartables, no confirmado).

## 23. Recommended Phase 2 audit units

1. **U1 — Durabilidad y atomicidad** (H4): audited-mutation, run-operation-lease,
   repo-lock, world-reconcile, checkpointer; escenarios de crash en cada frontera.
2. **U2 — Selección efectiva y regen** (F1, F4, F5, R4, R5): unificar
   executor-selection en regen/titler/grounding; effort por etapa; re-validación al resume.
3. **U3 — Ejecución de leaves**: RunExecutor en profundidad (diff, scope advisory
   vs enforced, unexpected commits, validación, timeouts, kill).
4. **U4 — Integración y conflictos**: IntegrationAgent, conflictGate, decisiones
   recuperables, límites de repair, root integration + final apply + delivery E2E.
5. **U5 — Limpieza legacy** (F2, R2, §19): plan de eliminación con validaciones.
6. **U6 — Superficie de seguridad**: terminal-sessions, workspace-file/tree,
   local-fs, agent-env allowlist.
7. **U7 — Eventos y UI**: matriz evento↔reducer↔selector, SSE reconnect, obsolescencia.

Dependencias: U2 antes de U5 (regen usa el harness legacy); U1 informa a U3/U4.
Escenarios dinámicos a reproducir en fases posteriores: run E2E supervisado con
planner≠executor (claude/codex cruzados), cancel durante wave, resume tras kill
del server, conflicto de integración con decisión humana, CLI desinstalado a mitad de run.

## 24. Continuation handoff

Ver `continuation` en el ledger. Próxima acción: U-pendientes de §22 o iniciar
Fase 2 por U1/U2. Ambos entregables actualizados y consistentes a
2026-07-13T00:40-03:00.
