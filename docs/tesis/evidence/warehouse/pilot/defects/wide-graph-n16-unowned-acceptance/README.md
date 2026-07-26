# N=16 no superó la revisión de ownership de aceptación

Clasificación: **defecto de compilación del plan**, observado antes de crear
una hoja, worktree o candidato de entrega.

## Observación

El cell `warehouse-wide-n16` inició el run
`39557620-34c1-4de2-9ee7-a00928dfd9e0` desde W1. Su journal terminó en
`planning.failed` con el motivo exacto:

```text
Compiled plan review failed: unowned_acceptance: Required acceptance intent
acceptance-constraints has no leaf owner.
```

El resultado bruto y el journal se conservan en
`../../../wide-graph/retry-2/runs/warehouse-wide-n16/`. El driver terminó con
`lifecycle: failed`, sin SHA final ni receipt. El piloto permanece en W1.

## Qué no se concluye

No se concluye que una carga N=16 sea incorrecta, que la política C deba
cambiar sus umbrales, ni que la ejecución o integración fallen: ninguna de
esas etapas empezó. Tampoco se deriva una medición de escalamiento de esta
celda. Sólo se concluye que el plan compilado para este estímulo viola el
invariante de que toda intención de aceptación requerida debe pertenecer a una
hoja.
