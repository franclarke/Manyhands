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

## PR-3 — Reconciliador de mundo físico + checkpoints corruptos (U3, INV-3) `[ ]`
- [ ] `world-reconciler.ts`: inventario físico (worktrees/branches/locks/baseCommit) vs lógico (checkpoint), resolución por hoja (casos a–d)
- [ ] `ReconciliationReport` → RunEvent `world.reconciled`; invalidados fuera del seed del wavefront
- [ ] Checkpointer: ENOENT ≠ corrupto; fallback al checkpoint anterior válido + `checkpoint.degraded` / `checkpoint.lost`
- [ ] Wiring en execution-pipeline (resume) y restart route
- [ ] Tests: crash-recovery con git real, corrupción de `latest.json`, branch borrada → re-ejecución

## PR-4 — Lock por repo + preflight endurecido (U7) `[ ]`
## PR-5 — Fallas recuperables → gates: planning degradado + replan-question (U2, U6, INV-5) `[ ]`
## PR-6 — Presupuesto tokens/costo por wave con budgetGate (U5) `[ ]`
## PR-7 — SSE Last-Event-ID + backoff + replay testeado (U8, INV-7) `[ ]`
## PR-8 — Visor de evidencia usable (U4) `[ ]`
