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
- Gate amplio preservado honestamente: la repetición limpia terminó con un
  único timeout de 30 s y cleanup `EBUSY` en `integration-real-git` bajo
  paralelismo. El mismo caso pasó focalmente 1/1 en 12.35 s; no se hace un
  tercer reintento ni se clasifica el suite completo como PASS.
- Working tree y `git diff --check` limpios en `b076da1`; pendiente: reviews
  independientes Standards/Spec sobre el punto fijo documentado.
- Reviews Standards/Spec del fixed point `d5bf07f`: ambas FAIL P1 porque las
  vistas seleccionaban por commit y podían mezclar matrices distintas del
  mismo SHA. No implementaron correcciones.
- Reapertura TDD: RED 2 fallos reprodujo medalla `Verified` y detalle sin
  identidad exacta; GREEN 15/15 focal y 28/28 del conjunto afectado. La medalla
  usa el ID de nodo/integración y el detalle final usa `matrixId + commit`.
  Typecheck web PASS. Pendiente: re-reviews Standards/Spec.
