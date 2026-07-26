# Series 13 — preflight de W2 sin run creado

Estado: **no ejecutada**.

El driver forkeado generó la configuración de W2 desde el W1 verificado de
`series-12`, pero `run-experiment.mjs` rechazó la solicitud antes de crear un
run porque el servidor local no tenía exportado un `MANYHANDS_SESSION_TOKEN`
compatible. No existe journal, snapshot, attempt, commit candidato ni resultado
de oráculo para esta serie.

La configuración se preserva sólo como evidencia del preflight. La reanudación
de W2 continúa en una serie posterior, con un servidor iniciado con token.
