# La muerte del proceso dueño deja la celda sin resultado atribuible

## Hecho observado

Las tres celdas de `retry-11` (freeze `4f64258`) terminaron `not_delivered` con
la razón `executor_stuck_after_process_exit_without_terminal_transition`. En las
tres, el journal se detiene sin hecho terminal y el record conserva
`activeOperation` con heartbeat congelado.

La celda N=4 (`67b52f91-d4d4-4d1f-a1de-4f09cdf80363`) es la que más lejos llegó
y la que permite fechar la interrupción:

| Instante (UTC) | Hecho |
|---|---|
| 00:47:29.567 | se registra el child `codex` PID 35208 del intento 1 |
| 00:54:13.352 | el child sale por su cuenta; el registro anota `exitedAt` |
| 00:54:15.834 | traza `agent_committed`: el orquestador commitea `469c9391` con 12 archivos |
| 00:54:22.432 | último heartbeat de `activeOperation` |
| — | ningún evento posterior en el journal |

El intervalo de heartbeat es de **4 s**
(`apps/web/src/lib/server/runs/runner-heartbeat.ts`). Que el heartbeat se
detenga a los 4 s del último latido descarta un cuelgue: un `await` bloqueado
sobre un hijo no detiene un timer asíncrono de 4 s. Y ni el `catch` ni el
`finally` de `driveClaimedExecutionV2` llegaron a ejecutarse — no hay
`attempt.failed` ni liberación de la lease. La firma corresponde a una **muerte
abrupta del proceso dueño**, no a un error de la ruta productiva.

N=8 (`4e853223…`) muestra la misma firma antes: su child `codex` PID 39516
quedó registrado **sin** `exitedAt` y las trazas se cortan a las 01:04:17.955
en medio de comandos del agente. N=16 (`2ac013d5…`) quedó con
`planning-v2-attempt-2` PID 42196 registrado y sin salida, después de que su
intento 1 fallara por el sandbox de Codex.

## Ruta bajo examen

Hasta el commit, ManyHands hizo lo correcto: `ResultRecorder` verificó scope,
commiteó y persistió la traza (`packages/execution-core/src/result/recorder.ts`).
Lo que falta después es responsabilidad del proceso que murió.

La recuperación **existe y es fail-closed por diseño** (ticket 21): una lease
sin latidos por más de `DEFAULT_STALE_MS` = 10 min puede ser tomada por un claim
nuevo — `claimExecutionV2` y `claimControlOperation` pasan
`takeoverStaleAfterMs`, y el takeover exige `allDead=true` y quiescencia del
repositorio antes de publicar. Es decir: el run no queda muerto para siempre,
queda **esperando un claim que nadie hizo**.

El hueco real no está en el producto sino en el **instrumento**: el driver de
serie (`docs/tesis/evidence/scripts/run-g5.mjs` →
`run-experiment.mjs`) no detecta que el dueño de la celda murió, no reclama la
operación vencida y no fuerza un resultado terminal atribuible. La celda quedó
etiquetada `not_delivered` a mano, después del hecho.

## Evidencia primaria

- `docs/tesis/evidence/warehouse/wide-graph/retry-11/runtime-runs/processes/*.json`
- `docs/tesis/evidence/warehouse/wide-graph/retry-11/runtime-runs/67b52f91-*/traces.jsonl`
- `docs/tesis/evidence/warehouse/wide-graph/retry-11/runs/*-executor-stuck/run.json`
- `apps/web/src/lib/server/runs/v2/execution-pipeline.ts`
- `apps/web/src/lib/server/runs/run-operation-lease.ts`
- `apps/web/src/lib/server/runs/runner-heartbeat.ts`

## Qué no se concluye

- **No se concluye por qué murió el proceso dueño.** La evidencia preservada no
  lo determina. Las entradas admisibles que sí lo determinarían — el stdout y
  stderr del launcher para la ventana 00:54:15–00:54:30, el log del cliente
  `run-experiment.mjs`, o un registro del sistema operativo sobre la
  terminación — no fueron preservadas por la sesión que corrió `retry-11`.
- No se concluye que exista un defecto de ManyHands en esta clase. Todo lo
  observable de la ruta productiva, hasta el commit inclusive, fue correcto, y
  el takeover por lease vencida está implementado y probado.
- No se concluye que el trabajo del agente sea correcto ni incorrecto: el commit
  `469c9391` nunca fue validado, no hubo candidate, receipt ni oráculo, y la
  disposición del oráculo permanece `not_run`.
- No se concluye nada sobre H2 a partir de estas celdas: una interrupción cuya
  causa no está registrada **no es** evidencia sobre la arquitectura de grafos.
- No se corrige el producto a partir de esta observación. Cambiar la ruta de
  ejecución para atacar una causa no identificada sería un fix plausible a un
  término que no liga.

## Consecuencia operativa adoptada

Para la serie de medición sucesora:

1. el servidor corre aislado del checkout que se está editando — no se escriben
   archivos del repositorio mientras una celda está viva;
2. el driver preserva su propio log por celda, junto al journal;
3. el driver vigila el heartbeat de `activeOperation` y, ante una lease vencida,
   registra un resultado terminal atribuible en vez de dejar la celda colgada.
