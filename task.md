# Robustez E2E (U1–U8) — Plan aprobado 2026-06-11

Objetivo: flujo `created → preflight → planning → review → execution → integration → completed`
y todos sus caminos alternativos correctos, recuperables y auditables.
Invariantes INV-1…INV-7 y diseño por PR: `docs/design/future-frontier-tasks.md`
(§13 y sección "Plan de robustez E2E").

## PR-1 — Mutaciones seguras (U0, INV-4) `[x]`
- [x] `RunRecord.version` monotónico (repo-owned, bump dentro del write-lock)
- [x] `pendingDecision.gateId` acuñado por suspensión (`gateFromInterrupt`)
- [x] `mutation-guard.ts`: `claimRunMutation` + `RunMutationConflictError` (409 estructurado)
- [x] Rutas con claim: resume / restart / answer / approve-plan / decisions
- [x] `processPlanApproval` reclama `approved` antes del resume nativo
- [x] `restart` rechaza con runner in-process activo
- [x] API expone `version` + `pendingDecision`; UI trata el 409 estructurado como info
- [x] Tests: `mutation-concurrency.test.ts` (9) + `resume-route-concurrency.test.ts` (5)
- [x] Typechecks (web, execution-core, raíz) + suite completa verde (939/3 skipped)

## PR-2 — Cancelación real con kill verificado y GC (U1, INV-2) `[x]`
- [x] POSIX process-group kill (`detached: true` + `kill(-pid)` en `executor/kill.ts`); win32 sigue con `taskkill /t /f`
- [x] `killProcessTreeVerified`: poll del PID raíz, re-kill de escalación, outcome dead/escalated/survived
- [x] `live-process-registry.ts`: registro por runId vía `processOwnerId` (threaded por executor/grounding/composer); cancel espera `killOwnedProcessTrees` antes de responder
- [x] Loop del host abort-aware (`driveExecution(host, input, signal)` → outcome `aborted`); signal ahora llega a `runNode`/`repairLeaf` en el camino LangGraph (antes solo al engine mock)
- [x] `WorktreeManager.gcRun(runId)`: GC por convención de directorio + branch delete + `git worktree prune` (nuevo en GitRunner)
- [x] Evento auditado `run.cancelled` (durable antes del 200) con inventario kill/GC; respuesta con `cancellation`
- [x] Tests: `execution-core-kill-verify.test.ts` (6, procesos reales, group-kill POSIX), `cancel-route.test.ts` (3, git real e2e), `execution-host-abort.test.ts` (3)

## PR-3 — Reconciliador de mundo físico + checkpoints corruptos (U3, INV-3) `[x]`
- [x] `run/world-reconciler.ts` (core): evidencia validada por commit-resolve, sweep de worktrees (preservando branches de evidencia conservada), remoción de `index.lock` huérfano, casos a–d
- [x] `world-reconcile.ts` (web): salud del checkpoint + reconcile + filtrado del artifact + reset del thread → reseed con supervivientes; eventos durables `world.reconciled`/`checkpoint.degraded`/`checkpoint.lost`
- [x] Checkpointer: ENOENT ≠ corrupto; `getTuple` fallback al último checkpoint válido; `inspectThread` (ok/degraded/lost/missing); fix: `list()` ya no parsea `.writes.json` como checkpoint
- [x] `gcRun` con `preserveBranchesFor` (las branches de evidencia anclan los commits contra `git gc`); cancel route también preserva
- [x] Base commit inalcanzable → `RunNotResumableError` + run `interrupted` con mensaje accionable (gate terminal llega en PR-5)
- [x] Wiring en `runExecutionPipeline` (cold resume con checkpoint existente)
- [x] Tests: `checkpointer-corruption` (5), `world-reconciler` (3, git real), `world-reconcile-web` (4)

## PR-4 — Lock por repo + preflight endurecido (U7) `[x]`
- [x] `repo-lock.ts`: adquisición atómica (`wx`), re-entrante por runId, robo de locks stale (pid muerto / heartbeat silencioso), release owner-scoped
- [x] Pipelines start/resume reclaman el lock y lo liberan en finally; conflicto → `PreflightError("repo_busy")` nombrando al dueño
- [x] Preflight: `disk_space` (statfs, umbral 1 GiB, mensaje accionable) + fix latente: `.manyhands/` ya no cuenta como suciedad en `repo_clean` (los restarts fallaban su propio preflight)
- [x] Tests: `repo-lock.test.ts` (10: N concurrentes → 1 ganador, steal, corrupt lock, release scoped, preflight)
## PR-5 — Fallas recuperables → gates: planning degradado + replan-question (U2, U6, INV-5) `[x]`
- [x] `degradedPlanGate` en el planning graph (interrupt-first): fallo terminal del decomposer → retry (step-cache sobrevive) | abort (única vía sancionada a `failed`)
- [x] `decomposePlan` devuelve el fallo como DATO (`kind:"failed"`); host proyecta outcome `degraded`; pipeline lo proyecta como pendingQuestion `__plan_degraded__` + decision.raised
- [x] `planningResumeFor(nodeId, answer)`: traduce el answer del gate degradado a acción tipada en los 3 caminos de respuesta
- [x] U2: pregunta del decomposer durante replan → `pendingReplan` (step-cache + answers) + gate; `resumeReplanWithAnswer` reclama (INV-4), folda la respuesta y re-entra el replan
- [x] Barrido INV-5 en ejecución: excepción no clasificable con checkpoint → `interrupted` reanudable (no `failed`); `failed` queda solo para precondiciones y abort explícito
- [x] Tests: planning-graph degraded (3), `replan-question-gate.test.ts` (4)
## PR-6 — Presupuesto tokens/costo por wave con budgetGate (U5) `[x]`
- [x] `ExecutionConfigSchema` += `maxTokensTotal` / `maxCostUsd`; estado del grafo: `budgetLimits` + `finishPartial`
- [x] `computeBudgetSpend` (usage reportado de hojas + repairs del composer); chequeo en `routeFrontier` ENTRE waves (nunca corta una hoja en vuelo)
- [x] `budgetGate` (interrupt-first): `extend_budget` (nuevos límites o lift) | `finish_partial` (integra solo lo completo, cierre explícito) | `abort_run`
- [x] Proyección web: gate `budget_exceeded` en pendingDecision (spentTokens/spentUsd/pendingTasks), `BUDGET_GATE_OPTIONS`, decisionFromAnswer/isResumeDecision
- [x] Tests: execution-graph budget (4 — corte entre waves, extend completa, partial sin integrar incompletos, abort, sin límites = sin cambios)
## PR-7 — SSE Last-Event-ID + backoff + replay testeado (U8, INV-7) `[x]`
- [x] Frames con `id: <seq>` (el EventSource del browser gestiona Last-Event-ID solo)
- [x] Route `run-events` honra `Last-Event-ID` (gana el mayor entre header y `?after=`)
- [x] Cliente: reconexión manual con backoff exponencial + jitter, cursor `?after=` del máximo seq foldeado, gap no contiguo → un replay completo desde 0 (reducer cursor-idempotente absorbe duplicados)
- [x] Eliminado el endpoint SSE legacy `/events` (cero consumidores; política cero-legacy)
- [x] Tests: `run-events-replay.test.ts` (4 — ids en frames, resume exacto por header, max(after, LEI), INV-7: prefijo+sufijo ≡ stream continuo, overlap total idéntico)
## PR-8 — Visor de evidencia usable (U4) `[ ]`
