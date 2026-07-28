# Dos contratos del oráculo ancho compartían identificador

## Observación

Los recibos de `retry-2` usan `warehouse-wide-graph-v1` y verifican instalación,
gates, límites y determinismo. El oráculo fue ampliado después para comparar
cada respuesta contra el specimen, pero conservó el mismo identificador y no
declaró ese check en el recibo.

Una reevaluación del SHA N=4 bajo el contrato nuevo produce FAIL por orden del
catálogo, mientras el recibo v1 preservado produce PASS. La diferencia no es
contradictoria: los contratos no preguntan lo mismo.

## Impacto

Sin versionado, un lector podía atribuir checks value-aware a recibos que nunca
los ejecutaron y tratar resultados de estímulos incompatibles como comparables.

## Corrección

El contrato value-aware se identifica como `warehouse-wide-graph-v2` y declara
`oracleContractVersion: 2`. Sus recibos acumulan sólo los checks efectivamente
ejecutados. `specimen-values` aparece únicamente cuando el orden del catálogo
permite alcanzar la comparación de valores.

Los README de N=4 y N=8 marcan sus recibos v1 como estructurales históricos sin
reescribir los JSON originales. El recheck v2 de N=4 se conserva por separado.

## Regresiones

- `tests/wide-graph-oracle-checkout.test.ts` fija la identidad y la lista de
  checks de un recibo v2 exitoso.
- `tests/wide-graph-oracle.test.ts` fija que una salida con orden incorrecto no
  llegó a comparar valores y que una salida canónica sí lo hizo.

## Qué no se concluye

- No se concluye que los recibos v1 sean evidencia value-aware.
- No se concluye que v1 y v2 sean comparables.
- No se concluye que un FAIL v2 sobre el estímulo retirado sea un fallo de la
  arquitectura o de la política C.
- No se concluye que `retry-7` vaya a producir PASS.
