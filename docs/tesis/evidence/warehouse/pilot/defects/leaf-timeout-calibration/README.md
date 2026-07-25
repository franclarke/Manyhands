# El timeout de hoja truncaba el primer incremento

Clasificación: **calibración del instrumento, no defecto del sistema**.

## Observación

W1 de `series-8` (run `9d0fc2fc-c1bd-4778-b64c-5960b14cec82`, ManyHands
`32d686d`) superó planning y llegó a ejecución real. El attempt de la hoja
arrancó 12:23:18Z y murió 12:33:23Z:

    timeout: The agent hit the hard timeout. Consider a longer per-task timeout
    or a faster executor for this node

Diez minutos y cuatro segundos: consumió el `leafTimeoutMs` de 600000 ms
completo. No hubo error del executor, ni repair, ni salida no reconocible. El
agente seguía trabajando cuando se lo mató. El candidate se descartó
(`discardCandidate: true`), así que no queda worktree que inspeccionar.

Planning volvió a ser estocástico: los intentos 1 y 2 no emitieron el documento
final (`No JSON object found in response` y `Model emitted planning progress but
no complete WorkBreakdown JSON`), y el 3 sí. El presupuesto de reintentos lo
absorbió, pero conviene registrarlo como costo real del executor.

## Causa

El valor 600000 ms venía de los runs de estabilidad C2, cuyo target era un
repositorio existente de unas 1000 líneas donde cada hoja hacía un cambio
acotado. W1 no es eso: construye un proyecto entero desde un seed vacío
—toolchain, dominio, escenario, la sonda pública y sus tests— en una sola hoja,
porque C2 evaluó que dividir no compensaba.

Además el techo de hoja (600 s) estaba por debajo del de integración (900 s), de
modo que construir el proyecto completo tenía menos presupuesto que integrar sus
partes.

## Corrección

`leafTimeoutMs` e `integrationTimeoutMs` pasan a 1800000 ms.

El valor se fija por la forma del trabajo, no ajustándolo hasta que un run pase:
es tres veces el heredado, queda holgadamente dentro del wall clock de 7200000
ms por run, y es uniforme para W1–W8 para no privilegiar ningún incremento. El
valor que el piloto deje asentado se congela para la serie final.

## Qué no se concluye

Este run no dice que la hoja única de C2 fuera correcta ni incorrecta. Dice que
la medición estaba truncada: con el techo anterior no era posible distinguir
"la frontera elegida era demasiado grande" de "el reloj era demasiado corto".
Recién con un techo que no trunca se puede leer esa señal.

Resultado acumulado del piloto: **0/8**.
