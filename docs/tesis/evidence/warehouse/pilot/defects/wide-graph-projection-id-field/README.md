# El oráculo N=8 no reconocía `projectionId`

Clasificación: **defecto de instrumentación del oráculo externo**, no defecto
del candidato N=8 ni de la política C.

## Observación

El primer resultado externo de N=8, conservado en
`../../../wide-graph/retry-2/runs/warehouse-wide-n08/oracle-result-instrumentation-failure.json`,
falló por orden de proyecciones. La sonda real del mismo SHA entregado devolvía
ocho objetos ordenados con el campo `projectionId`, que es el campo producido
por `study:wide-graph`; el extractor del oráculo aceptaba sólo cadenas o `id`.

## Corrección y repetición

Rojo primero: la regresión `wide-graph-oracle.test.ts` pasó objetos con
`projectionId` ordenados y falló. Verde: el extractor acepta `projectionId` y
mantiene compatibilidad con `id`. La repetición se hizo sobre el mismo clon
externo y SHA, y el resultado PASS está en
`../../../wide-graph/retry-2/runs/warehouse-wide-n08/oracle-result.json`.

## Qué no se concluye

No se concluye que el candidato tuviera un orden incorrecto, ni que la
planificación, el grafo o la política C fallaran. El primer veredicto no era
válido porque el verificador no interpretaba el formato contractual de su
propia sonda. Tampoco se concluye nada sobre rendimiento a partir de ese FAIL.
