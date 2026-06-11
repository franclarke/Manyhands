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

## PR-2 — Cancelación real con kill verificado y GC (U1, INV-2) `[ ]`
- [ ] POSIX process-group kill (`detached` + `kill(-pid)`); win32 ya usa `taskkill /t /f`
- [ ] Verificación post-kill con reintento y traza `process.kill.escalated`
- [ ] `LiveProcessRegistry` por runId; cancel espera la verificación antes de responder
- [ ] Loop del host abort-aware (corta el stream entre chunks; checkpoint del último superstep queda)
- [ ] GC de worktrees del run cancelado + `git worktree prune` + traza `cancel.gc.completed`
- [ ] Tests: kill-verify (proceso que ignora señales), cancel mid-wave (mtime scan), reanudable post-cancel

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
