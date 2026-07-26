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

`V2PhysicalNodeExecutor.executeComposite` invoca
`IntegrationManifestExecutor.integrate(...)` sin propagar un timeout o una
señal derivada de `input.config.integrationTimeoutMs`. El mismo valor sí se
propaga a la reparación de integración. Esta diferencia es una hipótesis de
causa que debe cubrirse con una regresión antes de modificar el código.

## Evidencia primaria

- `.manyhands/runs/bc859c1d-7165-4ddf-8472-835eef8788ac.json`
- `.manyhands/runs/bc859c1d-7165-4ddf-8472-835eef8788ac.events.v2.jsonl`
- `packages/execution-core/src/v2/node-executor.ts`

## Qué no se concluye

- No se concluye que la integración nunca vaya a terminar ni que sus commits
  candidatos sean incorrectos.
- No se concluye que exista un conflicto semántico: todavía no se emitió
  `integration.failed` ni una observación de reparación.
- No se autoriza limpiar worktrees, pools ni artefactos; el run y su journal
  se conservan para la evidencia terminal.
