# 23 — Ejecutar recuperación causal y scheduling real

**What to build:** timeout, auth, recursos e infraestructura activan políticas acotadas; readiness usa presupuesto, recursos, circuit breakers y riesgo vigente.

**Blocked by:** 22.

**Status:** ready-for-agent

- [ ] RED cubre retry transient, suspensión de auth/binary, circuit breaker y descarte por scope.
- [ ] RED impide dispatch con presupuesto agotado o recurso exclusivo ocupado.
- [ ] Evidence de conflicto expirada no se consume como vigente.
- [ ] Scheduler persiste inputs/decisión reproducibles y reviews pasan.
