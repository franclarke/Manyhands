# 20 — Congelar el oráculo externo y sus gates

**What to build:** un oráculo independiente, versionado y hashable detecta falsos positivos conocidos antes de autorizar nueva evidencia empírica.

**Blocked by:** 19.

**Status:** agent-working

- [x] Tests RED/GREEN cubren el falso positivo histórico y un control correcto.
- [x] Policy marker, dist hash, manifest y receta quedan congelados en commit limpio.
- [x] Gate P0 y mutación autenticada pasan sobre el mismo commit.
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

## Re-reviews sobre `fdcf0f1`

- Spec de código PASS, 0 P0/P1/P2/P3; el P2 operativo de freeze/P0 seguía
  correctamente pendiente.
- Standards confirmó resueltos los tres P1 anteriores y encontró 1 P1 nuevo:
  la atribución no comparaba `moduleCount`, por lo que un receipt N=4 podía
  reutilizarse para N=8 con igual SHA/outDir.
- RED/GREEN añade `moduleCount` al conjunto exacto de atribución tanto antes de
  delivery como al reconciliar `completed`. Focal 2 archivos/7 tests PASS.
- Commit `4fe8544`; re-reviews de código finales Standards y Spec PASS, ambas
  con 0 P0/P1/P2/P3.
- Freeze material `docs/tesis/evidence/warehouse/wide-graph/oracle-freeze-v2.json`
  fija source/tree, policy marker, dist/lock hashes, contrato transitivo y
  receta. Su test de reconciliación pasa 7/7. Pendiente ejecutar P0 completo y
  mutación autenticada sobre el commit que contiene este freeze.

## Gate exacto sobre `9d1c7d7`

- Gate P0 secuencial PASS sobre
  `9d1c7d72f29782a7aafcf69958d0fc9785b7a14a`: suite raíz 213 archivos,
  1481 tests passed y 2 skipped; seis typechecks de paquetes, web typecheck,
  build de los 12 packages y web build PASS. Node `v22.23.1`, pnpm `7.29.3`.
- Mutación autenticada sobre el servidor oficial iniciado desde el mismo
  commit: landing 200, lectura inicial 200, `POST /api/workspaces` 201 y lectura
  posterior 200. El workspace persistido
  `6c77f06e-80ca-4c93-a9b6-0138b289186e` apunta al clon físico limpio
  `manyhands-ticket20-mutation-target-9d1c7d7`, también fijado a `9d1c7d7`.
- El primer POST autenticado contra el clon de trabajo fue rechazado porque su
  identidad ya pertenecía al workspace de ticket 19; ese 500 se preservó como
  evidencia de conflicto y no se borró estado. El único reintento usó un clon
  físico distinto para evitar la colisión de identidad.
- Tras detener exclusivamente el árbol de siete procesos del servidor, el
  puerto 3020 quedó libre. El checkout de validación permaneció limpio y exacto;
  el hash de `packages/decomposer/dist/index.js` fue
  `f95b81959faf0a23b9f3a0c8814dd90cf894db8907ef17f8430419499bed16bc` y
  la reconciliación del freeze volvió a pasar 7/7.
- Logs y resultados se preservan fuera del repositorio bajo
  `C:\Users\franc_rgy\.codex\tmp\manyhands-ticket19-20260729-115928\runtime-logs`.
  Pendiente únicamente la revisión final independiente Standards/Spec del
  ticket completo.
