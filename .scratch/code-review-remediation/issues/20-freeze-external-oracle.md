# 20 — Congelar el oráculo externo y sus gates

**What to build:** un oráculo independiente, versionado y hashable detecta falsos positivos conocidos antes de autorizar nueva evidencia empírica.

**Blocked by:** 19.

**Status:** agent-working

- [ ] Tests RED/GREEN cubren el falso positivo histórico y un control correcto.
- [ ] Policy marker, dist hash, manifest y receta quedan congelados en commit limpio.
- [ ] Gate P0 y mutación autenticada pasan sobre el mismo commit.
- [ ] Reviews Standards/Spec pasan y HANDOFF registra el freeze.

## Hipótesis operativa

- Éxito: una celda recién generada congela identidad, versión, hashes y mapeo de
  criterios del oráculo; el driver rechaza antes de crear un run cualquier
  ausencia o drift y sólo autoriza delivery tras un único PASS atribuible al SHA
  candidato exacto.
- Refutación: una celda sin contrato, un asset mutado o un recibo con
  id/version/hash/SHA distinto alcanza creación de run o aprobación de delivery.

## Evidencia de trabajo

- RED: el generador no incluía contrato de oráculo; el driver aceptaba una
  celda sin él y el recibo no fijaba hashes ni mapeos.
- GREEN: manifest/celdas v2 congelan id, versión, evaluator/runner SHA-256,
  digest y cinco mapeos criterion–checks. El preflight rechaza ausencia, drift o
  desacuerdo serie–celda antes de crear el run.
- El runner registra hashes y todos los checks; la atribución exige PASS sobre
  el SHA candidato exacto y cada check mapeado antes de aprobar delivery.
- Un restart reutiliza el único `oracle-result.json`; si el recibo fue alterado,
  el driver falla cerrado sin llamar a delivery.
- Tests afectados actuales: 10 archivos/80 tests PASS; el test integrado crea un
  repositorio Git real, ejecuta el oráculo en clon externo, comprueba el orden
  oracle-before-delivery, reuso sin retry y rechazo de receipt drift.
- `node --check` pasa para los cinco scripts tocados; generación material de
  tres celdas v2 y preflight `run-g5 --only no-such-cell` pasan fuera del repo.

## Reviews sobre `8c445ec`

- Standards FAIL: 3 P1. El freeze omitía dependencias transitivas; el gate se
  decidía por prefijo de `cellId`; y `completed` no reconciliaba el delivery
  receipt contra el SHA aprobado por el oráculo.
- Spec FAIL: 1 P1 por el bypass de `cellId` y 1 P2 porque freeze P0/mutación
  seguían pendientes. Ningún reviewer implementó correcciones.

## Remediación posterior

- RED/GREEN congela el cierre transitivo ejecutable: catálogo de métricas, plan,
  core, specimen, resolver de pnpm y el propio módulo contractual, además de
  evaluator y runner.
- Manifest y celdas llevan el discriminante contractual
  `{ id: "warehouse-wide-graph", version: 2 }`; un cambio de `cellId` ya no
  omite el preflight ni el oráculo.
- Al observar `completed`, el driver vuelve a atribuir el receipt preservado al
  `finalSha`; un SHA distinto devuelve resultado fallido. La regresión integrada
  cubre el drift.
- 10 archivos/80 tests afectados vuelven a pasar. Pendientes: commit, re-reviews
  y luego el freeze P0/mutación señalado como P2.
