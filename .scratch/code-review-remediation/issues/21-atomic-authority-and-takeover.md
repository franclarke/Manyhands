# 21 — Unificar autoridad, fencing y takeover

**What to build:** claim y fence canónico no dejan una ventana de doble autoridad; todo takeover reconcilia y verifica procesos anteriores antes de despachar.

**Blocked by:** 20.

**Status:** ready-for-agent

- [ ] RED reproduce crash entre claim y advanceFence y rechaza writes del dueño anterior.
- [ ] RED reproduce takeover con child vivo y exige receipt `allDead` antes del nuevo dispatch.
- [ ] La pérdida de repository lease aborta efectos en vuelo.
- [ ] CLAIM-053 permanece `partial` hasta cerrar también recovery, journal y stores productivos.
- [ ] Tests de concurrencia, gates afectados y reviews Standards/Spec pasan.
