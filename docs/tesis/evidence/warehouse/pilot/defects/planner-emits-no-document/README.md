# El planner devuelve respuestas sin documento JSON

Clasificación: **defecto abierto; hipótesis principal identificada, sin corregir**.

## Observación

`No JSON object found in response` es el modo de fallo dominante de planning con
Claude Code `sonnet`, y aparece de forma reproducible a lo largo de las series:

| Serie | Dónde apareció |
|---|---|
| 5  | intento 1 |
| 8  | intento 1 |
| 9  | intento 1 |
| 11 | intento 3 |

En series-8 el intento 2 falló con la variante `Model emitted planning progress
but no complete WorkBreakdown JSON` —líneas `planning.node` presentes, documento
ausente— y el 3 sí produjo el plan. En series-11 el intento 2 alcanzó a emitir
dos nodos y murió por otra causa (`candidate seam-probe-json-contract cannot
consume its own output`) antes de que el 3 volviera a quedarse sin JSON.

El patrón es que el **primer** intento es el más propenso a no emitir documento,
y que los intentos posteriores —que llevan `repairIssues` adjuntos— tienden a
producirlo. No es aleatorio uniforme.

## Hipótesis principal

La invocación de planning usa `--permission-mode plan`:

    ["-p", "-", "--model", …, "--output-format", "stream-json",
     "--include-partial-messages", "--verbose", "--permission-mode", "plan"]

La bandera está para que el planner sea de sólo lectura, pero *plan mode* no es
únicamente un permiso: instruye al modelo a investigar y **presentar un plan**
en vez de emitir la salida pedida. Eso explicaría por qué la primera llamada
—sin `repairIssues` que reanclen la tarea a "devolvé el JSON completo otra vez"—
es la que más frecuentemente devuelve prosa.

Es una hipótesis, no una conclusión: no se ha inspeccionado todavía el texto
crudo de una respuesta fallida para confirmarla.

## Próximo paso propuesto

Capturar el `stdout` completo de un intento fallido y leerlo antes de tocar
nada. Si confirma la hipótesis, evaluar una invocación de sólo lectura que no
imponga el encuadre de plan mode. No cambiar la bandera de forma especulativa:
la lectura es barata y el run no lo es.

## Segunda causa observada

`candidate seam-probe-json-contract cannot consume its own output` reapareció en
series-11 pese a la regla añadida en `635062e`/`62564ef` que pide omitir un
candidato cuyo único consumidor sería su propio productor. El modelo puede
violar esa instrucción: no es una barrera suficiente por sí sola.

La entrada no llega a compilarse: `WorkBreakdownSchema` valida cada candidate
artifact y candidate seam contra las unidades declaradas y rechaza que
`consumerUnitKeys` incluya `producerUnitKey`. Esa validación determinista es la
frontera que emitió el mensaje observado y devuelve el problema como
`repairIssues` al siguiente intento del planner. Por lo tanto, no corresponde
duplicar una regla de prompt ni afirmar que el seam autoconsumido haya entrado
en la ruta de ejecución.

## Qué no se concluye

No se concluye que la validación haya evitado nuevas emisiones inválidas del
modelo; sólo que las rechaza antes de compilar contratos o ejecutar hojas. La
causa de que el modelo vuelva a proponer esa relación sigue sin evidencia
directa y permanece subordinada a la investigación de la salida cruda de
planning.

Resultado acumulado del piloto: **0/8**.
