# 17 — Representar resultados de evidencia honestamente

**What to build:** la UI distingue `verified`, `unverified`, `failed` y pendiente sin fallthrough y no habilita publicación sin candidato vigente y matriz final verificada.

**Blocked by:** 16.

**Status:** ready-for-agent

- [ ] Tests RED prueban que matrices unverified/failed nunca muestran Verified ni habilitan entrega.
- [ ] El reducer conserva el outcome como autoridad visible.
- [ ] La UI presenta filas de criterio y referencias de evidencia sin sobreafirmar.
- [ ] Tests web, typecheck y reviews Standards/Spec pasan.
