# La primera célula de grafo ancho quedó bloqueada por un slot huérfano

Clasificación: **infraestructura de worktree pool**. No es un fallo de la
política C ni una observación sobre escalabilidad.

## Observación

La célula N=4 `warehouse-wide-n04` creó el run
`1ac4af47-aa2c-493d-a17a-bd80ddb62417` sobre W1 verificado. Su primera hoja
falló antes de invocar al agente con:

```text
worktree_pool_unavailable: could not remove invalid slot slot-000
```

El journal y el resultado están en
`../../../wide-graph/pilot/runs/warehouse-wide-n04/`. El orquestador lo
clasificó como `shared_infrastructure`, que es la clase correcta, y dejó una
decisión local sin responder por el driver.

La inspección posterior comprobó que
`warehouse-control-tower-pilot-13/.manyhands/worktree-pool/c074245274f5/slot-000`
existe físicamente, no contiene `.git` y no aparece en `git worktree list`.
Un proceso Vite residual de W2 sigue ejecutándose desde ese directorio. Es un
nuevo huérfano físico, distinto del slot autorizado y eliminado en `pilot-12`.

## Qué no se concluye

No se concluye que N=4 haya planificado, ejecutado o validado módulos
independientes; no llegó a esas etapas. Tampoco se concluye que el arreglo del
pool sea insuficiente en general: éste propagó correctamente la indisponibilidad
en vez de continuar contra un worktree inválido. La causa de que el Vite residual
no fuera terminado por el timeout de W2 requiere una investigación separada.
