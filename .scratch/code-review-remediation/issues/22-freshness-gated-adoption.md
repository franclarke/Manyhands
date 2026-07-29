# 22 — Adoptar sólo con freshness y fingerprint vigentes

**What to build:** la ruta V2 usa el único gate productivo de adopción y vuelve stale todo intento cuyos inputs materiales o revisión cambian.

**Blocked by:** 21.

**Status:** closed

- [x] RED cambia un input durante el intento y obtiene `attempt.stale` sin artifact adoption.
- [x] Driver V2 no construye adopciones por fuera del gate canónico.
- [x] Fencing y exact-commit validation permanecen verdes.
- [x] Reviews Standards/Spec pasan.
