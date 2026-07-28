# Decision retry runner handoff dead-end

## Observado

En `retry-9` N=4, la corrección ambiental verificable permitió responder
`retry` a la decisión `resolve_conflict`. `decision.resolved` quedó persistido
en la secuencia 34, pero la route intentó reclamar inmediatamente otra
ejecución mientras el lease anterior seguía activo y devolvió 409. Al liberarse
ese lease, el run quedó `waiting_for_input` sin decisión pendiente. `/run`
aceptaba sólo `running` y `/resume` sólo `paused`.

## Causa raíz

Había dos responsabilidades mezcladas:

1. resolver la decisión bajo la autoridad vigente;
2. comenzar otro driver antes de que esa autoridad terminara su `finally`.

Además, hacer que `decision.resolved` forzara `running` habría inventado
readiness y fallaba con múltiples decisiones.

## Corrección

Commit `60eb12f`.

- `decision.resolved` sólo elimina el ID resuelto de la lista de decisiones
  pendientes; conserva el lifecycle hasta una observación real.
- una continuación de decisión puede reclamar `running` o
  `waiting_for_input`;
- si existe un runner activo, el sucesor espera el conjunto de background tasks
  ya activo antes de reclamar;
- el `V2ExecutionDriver` recalcula y persiste `readiness.observed`, que recién
  entonces decide entre `running` y `waiting_for_input`.

TDD y revisión:

- RED inicial: el run permanecía sin una transición utilizable;
- RED de re-review: una transición optimista producía `running` sin readiness;
- GREEN final enfocado `17/17`;
- Standards detectó P1/P2 en la primera revisión; ambos quedaron cerrados;
  re-review Standards y Spec PASS.

## Qué no se concluye

- No demuestra aún que el camino HTTP original complete una celda productiva;
  eso exige el N=4 del freeze sucesor.
- No autoriza mutar o reanudar el journal histórico de `retry-9`.
- No cambia política C, fórmulas, umbrales, estímulo ni oráculo.
