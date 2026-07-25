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

**2. Resumibilidad de la serie.** El driver corre W1–W8 en un único proceso y
corta en el primer fallo. Como la base de cada incremento es la entrega
verificada del anterior, la cadena es conceptualmente resumible, pero no existe
`--from Wn`. Medido hoy: una ventana de cuota fresca alcanza para unos 40
minutos de piloto, y la serie necesita ocho incrementos de hasta 30 minutos cada
uno. **Con el executor y la cuenta actuales la serie completa no entra en una
sola ventana de cuota.** Sin reanudación por incremento, cada ventana empieza de
cero en W1.

## Estado

Ninguna corrección aplicada todavía; ambos puntos quedan como el próximo bloque
de trabajo. Resultado acumulado del piloto: **0/8**.
