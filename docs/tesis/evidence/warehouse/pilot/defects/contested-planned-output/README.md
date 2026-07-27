# Una conflict constraint no remedia un output disputado

Clasificación: **defecto de revisión del plan**. El sistema modeló el conflicto
correctamente y aun así ejecutó un plan que no podía integrar.

## Observación

`warehouse-wide-n16`, run `bc859c1d`. El planner asignó el mismo planned path a
las dieciséis proyecciones:

    projection-01  ["src/analytics/projection-01.ts", "src/analytics/projections.test.ts"]
    projection-02  ["src/analytics/projection-02.ts", "src/analytics/projections.test.ts"]
    ...
    projection-16  ["src/analytics/projection-16.ts", "src/analytics/projections.test.ts"]

El compilador **sí lo vio**. Emitió 171 conflict constraints — exactamente
C(19,2), todos los pares — con `risk: high` en los 171. De ésos, 120 son
C(16,2), los pares de proyecciones, y su razón nombra literalmente
`src/analytics/projections.test.ts`.

El plan pasó la revisión, se aprobó, y las 19 hojas quedaron
`Verified [1/1 passed]`. El run murió en la integración de la raíz:

    failure.classified  integration:conflict  "Integration required semantic repair."
    integration.failed  "The single semantic repair attempt failed."

La reparación falló sobre ese mismo archivo compartido.

## Causa

`reviewCompiledPlan` comparaba scopes por pares y sólo reportaba error cuando el
solapamiento **no** estaba cubierto por una conflict constraint:

```ts
const constrained = input.graph.conflictConstraints.some(/* … este par … */);
if (!constrained) findings.push(finding("scope_isolation", "error", "unmodeled_scope_overlap", …));
```

Como el compilador había emitido una constraint para cada par solapado,
`constrained` era siempre `true` y el crítico no producía **ningún** finding.

La constraint es un remedio válido para un path **compartido de lectura**:
serializa el acceso. No lo es para dos unidades que declaran el mismo path como
su propio **output**. Cada hoja commitea su versión completa del archivo desde su
worktree, y la integración bottom-up tiene que hacer cherry-pick de dieciséis
versiones que se contradicen entre sí. Serializar los intentos no serializa la
base sobre la que cada uno construye.

## Corrección TDD

- Rojo: dos hojas hermanas declarando el mismo planned path, **con** su conflict
  constraint emitida, producían `findings == []`.
- Verde: un planned path declarado por más de una unidad es error
  (`contested_planned_output`), tenga o no constraint.
- Control negativo: dos hojas con outputs distintos no producen el finding, y la
  constraint por pares se sigue emitiendo — la rechazo viene de la propiedad
  disputada, no de que el compilador haya dejado de ver el conflicto.

Resultó más fuerte de lo diseñado: como `compileGraphRevision` invoca
`assertPlanReview`, el plan ahora **no compila**. Un fallo de integración a los
cuarenta minutos pasa a ser un rechazo de planning en segundos, con feedback de
reparación para el planner.

## Qué no se concluye

No se concluye que esto habilite N=16. El corte sigue teniendo el defecto de
dirección de seam corregido aparte, y la política C **igual no dividiría** este
grafo por utilidad propia — ver
[`policy-c-refuses-a-clean-wide-cut`](../policy-c-refuses-a-clean-wide-cut/README.md).
Lo que queda establecido es que este plan concreto nunca debió compilar.
