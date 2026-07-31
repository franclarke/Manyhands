# G6 · Etapa 1 — consumo medido

Celda `g6-01-T1-A-r1`, run `c52f823e-2979-4869-b5ec-9963e05d05d0`, ejecutor
`claude-code-cli/sonnet`. Todas las cifras salen del journal preservado; ninguna
es una estimación.

## Lo que consumió

| | |
|---|---:|
| Duración de la celda | 18:10:39 → 18:53:25 = **42,8 min** |
| Intentos de planning | 3 (dos fallidos) |
| Intentos de ejecución | 1 |
| `tokensIn` del intento de ejecución | **4.287.040** |
| `tokensOut` del intento de ejecución | 37.681 |
| Total del intento de ejecución | **4.324.721** |
| Costo reportado por el proveedor | **USD 2,33** |

## El techo declarado no sirve como instrumento

El pre-registro fijó **2.000.000 de tokens para toda la serie**. Un solo intento
de ejecución de una sola celda consumió **más del doble**.

La razón no es que la celda se haya desbordado: `tokensIn` suma entrada, creación
de caché y **lectura de caché**, y en una tarea sobre 1650 líneas la lectura de
caché domina. Contar eso como si fuera consumo facturable confunde dos cosas
distintas. El costo reportado por el proveedor para ese mismo intento fue **USD
2,33**.

**El techo debe expresarse en dólares, no en tokens.** Es una corrección de
instrumento: no toca la hipótesis, ni el falsador, ni la métrica primaria, ni el
umbral. Queda declarada acá en vez de cambiarse en silencio.

Proyección con el número medido, si las seis celdas se parecieran a ésta:
**~USD 14 de costo reportado**, más el planning, que no está medido.

## Lo que no se pudo medir

**Los intentos de planning no registran `usage` en el journal.** La usage se
persiste en los hechos de intento de ejecución, y planning no emite uno. Esta
celda tuvo tres intentos de planning, dos de ellos fallidos, uno de los cuales
produjo 213.073 bytes de salida antes de cortarse.

Ese consumo es real y **no está contado en las cifras de arriba**. La celda
consumió más de lo que este documento puede acreditar, y se dice así en vez de
presentar el total del intento de ejecución como si fuera el total de la celda.

## Fallos de planning observados

| Intento | Resultado |
|---|---|
| 1 | `exit 1`, `envelopes=system`, 20.353 bytes, sin salida capturable |
| 2 | `exit 1`, 213.073 bytes, `output="API Error: Response stalled mid-stream. The response above may be incomplete."` |
| 3 | Plan compilado y aprobado |

El diagnóstico del intento 2 existe gracias al fix de observabilidad de esta
misma jornada. Sin él habría quedado un conteo de bytes y ninguna causa, que es
exactamente lo que dejó sin medición a la celda N=16 de la serie anterior.

Un corte del proveedor a mitad de stream **no cuenta como fallo de la
condición**, según la regla ya pre-registrada.
