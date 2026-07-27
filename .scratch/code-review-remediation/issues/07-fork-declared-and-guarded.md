# 07 — El fork de cadena queda declarado y con guarda

**What to build:** reanudar una cadena verificada deja de eludir el falsador del protocolo. Hoy permite heredar un prefijo producido bajo una version anterior del sistema, sin guarda ni declaracion.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] El protocolo declara el fork y en que modos es admisible.
- [ ] El codigo rechaza forkear en modo final, con regresion roja primero.
- [ ] El test de aislamiento vacuo se reemplaza por uno que verifique la propiedad real.
