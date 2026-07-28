# El oráculo ancho no atribuía el veredicto al commit entregado

## Observación

`run-wide-graph-oracle.mjs` recibía una ruta mediante `--target`, ejecutaba los
checks en ese checkout y emitía la misma ruta en el recibo. No clonaba el
repositorio ni registraba el SHA observado. Un cambio concurrente del target
podía hacer que un PASS no correspondiera al commit publicado por el run.

## Impacto

Los recibos históricos preservan qué directorio se usó, pero por sí solos no
prueban qué objeto Git fue verificado. Sus conclusiones deben combinarse con el
receipt de entrega y limitarse al contrato histórico del oráculo.

## Corrección

La CLI exige ahora `--repository` y `--delivered-sha`, crea un clon temporal
fuera del target, hace checkout detached del SHA completo y confirma
`git rev-parse HEAD` antes de instalar o ejecutar gates. El recibo registra
`sourceRepository` y `verifiedSha`. La excepción de ownership de Git se limita
al repositorio fuente con `git -c safe.directory=...`; no modifica configuración
global.

La regresión `tests/wide-graph-oracle-checkout.test.ts` crea dos commits reales:
el entregado pasa y el HEAD posterior falla. El oráculo sólo puede pasar si
verifica el primero.

## Evidencia productiva

El commit histórico N=4
`b7a8838b1db9fa136103e5024df38697072ad3c9` se reabrió desde un clon externo.
`retry-2/runs/warehouse-wide-n04/oracle-v2-recheck.json` registra exactamente ese
SHA y el veredicto del contrato v2.

## Qué no se concluye

- No se concluye que los PASS históricos hayan ejecutado checks de valores.
- No se concluye que la nueva serie `retry-7` entregue o pase su oráculo.
- No se concluye que el FAIL del recheck v2 invalide el PASS estructural v1:
  pertenecen a estímulos y contratos distintos.
