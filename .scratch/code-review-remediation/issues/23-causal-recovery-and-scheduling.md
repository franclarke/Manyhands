# 23 — Ejecutar recuperación causal y scheduling real

**What to build:** timeout, auth, recursos e infraestructura activan políticas acotadas; readiness usa presupuesto, recursos, circuit breakers y riesgo vigente.

**Blocked by:** 22.

**Status:** closed

## Evidencia de trabajo - 2026-07-29

- RED focal en `tests/causal-recovery-scheduling-v2.test.ts` y
  `tests/run-v2-execution-driver.test.ts`: expiracion/modo advisory/circuit
  breaker no se respetaban y `transient:` levantaba una decision sin
  reintento.
- GREEN inicial: el selector descarta evidencia expirada, distingue advisory
  de serializacion y explica circuit breakers; el driver reintenta fallos
  transitorios dentro del presupuesto causal. Suite focal: 9/9 PASS.
- Ticket permanece abierto hasta cablear proveedores productivos, persistencia
  de razones/configuracion/riesgo y revisiones Standards/Spec.

## Cierre - 2026-07-29

- La ruta productiva V2 codifica causas reales del executor (`timeout`,
  `auth`, `binary_missing`, `quota`) y aplica retry transitorio acotado,
  suspension del recurso afectado, circuit breaker de infraestructura y
  descarte por scope; las decisiones quedan vinculadas al intento y la
  reanudacion tras resolverlas libera el recovery.
- El scheduler consume disponibilidad de binario, intentos running, usage
  persistido, limites efectivos, constraints con modo/resourceId y cursor de
  expiracion; con presupuesto no demostrable serializa y bloquea fail-closed.
  Las razones, evidencia efectiva, configuracion, cursor y wave quedan en
  eventos canonicos tipados y son reconstruibles por replay.
- RED/GREEN: `tests/causal-recovery-scheduling-v2.test.ts` (3),
  `tests/run-v2-execution-driver.test.ts` (10),
  `tests/execution-failure-cause-classification.test.ts` (7),
  `tests/run-coordinator-lifecycle.test.ts` (9) y las dos suites scheduler
  (15): 44/44 PASS.
- Gates: typechecks de scheduler, execution-core, run-coordinator,
  orchestrator-graph y web PASS; builds de execution-core, scheduler,
  run-coordinator y orchestrator-graph PASS; `git diff --check` PASS.
- Review read-only inicial Standards/Spec encontro P1/P2; las correcciones se
  aplicaron solo despues. Re-review independiente Standards/Spec del diff
  final: PASS, sin P0/P1/P2/P3; no se modificaron archivos durante los
  reviews.

- [x] RED cubre retry transient, suspensión de auth/binary, circuit breaker y descarte por scope.
- [x] RED impide dispatch con presupuesto agotado o recurso exclusivo ocupado.
- [x] Evidence de conflicto expirada no se consume como vigente.
- [x] Scheduler persiste inputs/decisión reproducibles y reviews pasan.
- [x] CLAIM-020/021 sólo se elevan con caller productivo probado; CLAIM-053 sigue `partial` hasta tickets 24–25.
