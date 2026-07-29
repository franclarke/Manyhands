# 17 — Representar resultados de evidencia honestamente

**What to build:** la UI distingue `verified`, `unverified`, `failed` y pendiente sin fallthrough y no habilita publicación sin candidato vigente y matriz final verificada.

**Blocked by:** 16.

**Status:** ready-for-agent

- [ ] Tests RED prueban que matrices unverified/failed nunca muestran Verified ni habilitan entrega.
- [ ] El reducer conserva el outcome como autoridad visible.
- [ ] La UI presenta filas de criterio y referencias de evidencia sin sobreafirmar.
- [ ] Tests web, typecheck y reviews Standards/Spec pasan.

## Progreso TDD

- RED con Node 22.23.1/pnpm 7.29.3: 2 fallos válidos. La UI devolvía `Verified [evidence recorded]` para outcome `unverified`; el reducer aceptaba `final_candidate.verified` sin matriz verificada exacta.
- GREEN focal: 23/23; regresiones amplias de lifecycle/delivery/crash/model V2: 18/18; typechecks run-coordinator/web PASS.
- Implementado: estados explícitos verified/unverified/failed/pending, resumen de outcome durable en el reducer, guard exacto matrix-id + candidate-commit y filas de criterio/referencias en la UI.
- Pendiente: gate amplio, commit limpio y reviews independientes Standards/Spec.
