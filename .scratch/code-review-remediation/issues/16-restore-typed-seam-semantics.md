# 16 — Restaurar la semántica tipada de seams

**What to build:** `SeamBinding` expresa compatibilidad contractual sin convertirse en una dependencia de ejecución; artifacts y restricciones ordenantes conservan la detección de ciclos.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] Regresiones RED/GREEN cubren artifact + seam inverso y loops sólo de seams.
- [ ] El prompt distingue producer, consumer y comandos sin consumidor interno.
- [ ] Contrato técnico, evidencia histórica y HANDOFF no llaman ciclo material al falso positivo.
- [ ] Suites y typechecks afectados pasan.
- [ ] Reviews independientes Standards y Spec pasan sin P0/P1/P2.
