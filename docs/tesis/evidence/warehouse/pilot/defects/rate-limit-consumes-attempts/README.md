# El rate limit consume intentos de planning

Clasificación: **defecto productivo de clasificación de fallos + límite
operativo del programa**.

## Observación

W1 de `series-9` (run `89486bfa-3fbf-48f4-9a00-e246dd560d0f`, ManyHands
`fa154ff`) perdió sus tres intentos de planning:

    1  No JSON object found in response
    2  claude-code-cli planning failed with exit code 1
       (envelopes=assistant,rate_limit_event,stream_event,...)
    3  claude-code-cli planning failed with exit code 1
       (envelopes=assistant,rate_limit_event,result,stream_event,system,user;
        stdoutBytes=246936)

El intento 3 alcanzó a emitir cuatro `planning.node_discovered` antes de morir.

Inmediatamente después, un probe mínimo al mismo CLI y modelo respondió normal:

    claude -p "Reply with exactly: OK" --model sonnet --output-format json
    -> {"type":"result","is_error":false,"result":"OK",...}

## Causa

No es el límite duro de sesión documentado en
`claude-session-limit-2026-07-25.md`. Es rate limiting sobre las requests
grandes: el prompt de planning es extenso y la respuesta ronda los 240 KB. El
CLI emite un `rate_limit_event` en su stream y termina con código 1.

ManyHands trata esa salida como un fallo de planning más y descuenta uno de los
tres intentos. Un throttle transitorio —que se resolvería esperando— queda así
indistinguible de un modelo que no supo producir el documento, y agota el
presupuesto de reintentos sin que ninguna corrección de prompt o de esquema
pueda ayudar.

## Dos consecuencias distintas

**1. Clasificación.** `rate_limit_event` con exit 1 debería clasificarse como
condición de capacidad reintentable, con backoff, y no consumir presupuesto de
intentos. Hoy un fallo externo se contabiliza como fallo del sistema bajo
estudio, que es exactamente la confusión que el protocolo intenta evitar en
todas partes.

**2. Resumibilidad de la serie — corrección.** Una versión previa de esta nota
afirmó que el driver no podía reanudar la cadena y que cada ventana de cuota
volvía a empezar en W1. **Es falso.** El driver persiste `chain-state.json` tras
cada oráculo PASS, con `completed` y `currentBase`, y arranca en
`INCREMENTS.slice(state.completed.length)`. Reejecutarlo con el mismo `--out` y
el mismo `--target` retoma en el incremento siguiente.

Las series 4 a 9 reiniciaron en W1 porque cada una usó target y directorio de
salida nuevos, decisión deliberada: cada una corría sobre una versión conductual
distinta y mezclarlas habría violado el protocolo. Eso es una consecuencia de
estar corrigiendo defectos, no un límite de la herramienta.

Sigue siendo cierto el dato de capacidad: una ventana fresca sostuvo hoy unos 40
minutos de piloto, y la serie necesita ocho incrementos de hasta 30 minutos. Con
la versión conductual ya congelada, el procedimiento correcto es conservar un
único target y un único `--out`, y reejecutar el driver después de cada reset;
la cadena avanza desde donde quedó.

## Corrección TDD

- Rojo: con `maxAttempts: 1`, dos throttles seguidos de una respuesta válida
  debían resolver el plan y no lo hacían; y agotar el presupuesto de throttle
  debía dar un error de capacidad distinguible.
- Verde: `PlanningCapacityError` es una clase propia. El planner la absorbe con
  backoff creciente sin consumir el intento —`attempt` no avanza— hasta
  `maxCapacityRetries`, y recién ahí falla con un mensaje que nombra la
  capacidad y no la calidad del plan. `run-coordinator-host` la emite cuando el
  CLI sale distinto de cero y su texto coincide con el vocabulario de capacidad
  (véase la corrección al pie: la primera versión miraba el envelope y estaba
  mal).
- Verificación: 47 tests de planning PASS; typechecks de `decomposer` y web PASS.

## Estado

Resultado acumulado del piloto: **0/8**.

## Corrección de la corrección — 2026-07-25

La primera versión de este fix detectaba capacidad preguntando si el stream
había emitido un envelope `rate_limit_event`. **Estaba mal.** Una llamada directa
al CLI con un prompt trivial, que devolvió el JSON pedido correctamente, listó:

    envelopes: system,stream_event,assistant,rate_limit_event,result

Es decir, `rate_limit_event` aparece también en llamadas exitosas: es una
notificación de estado de uso, no una señal de rechazo. Con esa condición,
cualquier salida no-cero habría quedado etiquetada como throttling y los fallos
genuinos de planning se habrían reintentado sin consumir nunca un intento.

La detección pasa a mirar **lo que el CLI dijo**, con el mismo vocabulario que
`classifyExecutorFailure` usa del lado de ejecución. Ambas capas reconocen las
mismas frases.

La hipótesis de que `--permission-mode plan` causaba las respuestas sin JSON
quedó **refutada** por el mismo experimento: con y sin la bandera, el CLI
devolvió el JSON pedido. Véase `planner-emits-no-document/README.md`.
