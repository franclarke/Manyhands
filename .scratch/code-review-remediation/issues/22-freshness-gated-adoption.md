# 22 — Adoptar sólo con freshness y fingerprint vigentes

**What to build:** la ruta V2 usa el único gate productivo de adopción y vuelve stale todo intento cuyos inputs materiales o revisión cambian.

**Blocked by:** 21.

**Status:** ready-for-agent

- [ ] RED cambia un input durante el intento y obtiene `attempt.stale` sin artifact adoption.
- [ ] Driver V2 no construye adopciones por fuera del gate canónico.
- [ ] Fencing y exact-commit validation permanecen verdes.
- [ ] Reviews Standards/Spec pasan.
