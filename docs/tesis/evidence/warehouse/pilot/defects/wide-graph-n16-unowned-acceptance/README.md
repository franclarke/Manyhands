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

## Corrección de la planificación

Rojo primero: `decomposer-adaptive-planning.test.ts` construyó un compuesto
con un intent requerido sólo en el raíz y verificó que toda hoja restaurada lo
referenciara; falló. Verde: la restauración C2 propaga los intents de ancestros
como cobertura heredada a las hojas. El allocator conserva el único criterio
compilado en el ancestro común más bajo, por lo que no duplica contratos ni
altera umbrales de granularidad. Las pruebas de planificación adaptativa,
asignación de aceptación y críticos, más el typecheck de `decomposer`, pasaron.

La repetición externa de N=16 queda pre-registrada en
`../../../wide-graph/retry-3/cells/warehouse-wide-n16.json`; todavía no existe
su veredicto porque el host local no tiene un ejecutor verificable disponible.

## Qué no se concluye

No se concluye que una carga N=16 sea incorrecta, que la política C deba
cambiar sus umbrales, ni que la ejecución o integración fallen: ninguna de
esas etapas empezó. Tampoco se deriva una medición de escalamiento de esta
celda. Sólo se concluye que el plan compilado para este estímulo viola el
invariante de que toda intención de aceptación requerida debe pertenecer a una
hoja.
