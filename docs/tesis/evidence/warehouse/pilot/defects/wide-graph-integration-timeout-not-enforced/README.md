# Integración de grafo ancho que excede su timeout

## Hecho observado

El run real `bc859c1d-7165-4ddf-8472-835eef8788ac`, creado desde la interfaz
local contra `warehouse-control-tower-pilot-14` (`71f61c9`), emitió
`integration.started` para el nodo raíz a las `2026-07-26T23:27:12.093Z`.
Su configuración persistida declara `integrationTimeoutMs: 600000`. A las
`2026-07-26T23:40:07Z` el journal seguía sin hecho terminal de integración y
el run renovaba su heartbeat. Hasta el inicio de la integración, las 19 hojas
habían emitido candidato y validación aceptados.

## Ruta bajo examen

La inspección física encontró un `cherry-pick` conflictivo en
`pilot-14/.manyhands/worktree-pool/.../slot-000`: `projection-07.ts` y
`projections.test.ts` quedaron en conflicto, mientras los otros cinco slots
estaban limpios. La ruta V2 entregaba el timeout al ejecutor de reparación,
pero no le entregaba una señal que representara el deadline completo de la
integración ni comprobaba esa señal dentro de `IntegrationManifestExecutor`.

La corrección crea una señal de deadline de integración, la combina con la
cancelación del run, la pasa a la reparación y hace que el manifest la
compruebe antes/después de operaciones asíncronas. La regresión de manifest
prueba que una señal vencida impide materializar el primer artefacto.

## Evidencia primaria

- `.manyhands/runs/bc859c1d-7165-4ddf-8472-835eef8788ac.json`
- `.manyhands/runs/bc859c1d-7165-4ddf-8472-835eef8788ac.events.v2.jsonl`
- `packages/execution-core/src/v2/node-executor.ts`
- `packages/execution-core/src/integration/manifest.ts`
- `tests/integration-manifest.test.ts`

## Qué no se concluye

- No se concluye que la integración nunca vaya a terminar ni que sus commits
  candidatos sean incorrectos.
- No se concluye que exista un conflicto semántico: todavía no se emitió
  `integration.failed` ni una observación de reparación.
- No se autoriza limpiar worktrees, pools ni artefactos; el run y su journal
  se conservan para la evidencia terminal.
