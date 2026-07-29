# Los seams fueron tratados incorrectamente como dependencias de ejecucion

Clasificacion corregida: **defecto de validacion del grafo**. El diagnostico
original de este documento decia que los seams debian entrar al DAG para cerrar
ciclos. Eso contradice `docs/DECISIONS.md` A5 y
`docs/system/01-task-graph.md`: un `SeamBinding` congela compatibilidad entre
participantes, pero no materializa outputs ni impone readiness u orden.

## Observacion historica

El run ancho N=16 `bc859c1d` declaro:

    artifact-projection-registry     projection-registry     -> [study-wide-graph-script]
    seam-study-wide-graph-command    study-wide-graph-script -> [projection-registry]

La primera relacion si es una dependencia material: el script necesita el
registry. La segunda describe un seam de comando en direccion semantica dudosa,
pero no crea por si sola la dependencia inversa. El run compilo, ejecuto 19
hojas y fallo durante integracion por el output de test disputado documentado
por separado.

## Primera correccion equivocada

Se agregaron los `seamBindings` al mapa de adyacencia de
`validateGraphRevision`. Esto hizo que un artifact `A -> B` mas un seam `B -> A`
se reportara como `artifact_cycle`. Retry-8, retry-9 y retry-10 heredaron ese
falso positivo; retry-10 lo reprodujo en N=4, N=8 y N=16 antes de candidate.

La implementacion entro ademas en contradiccion interna: el readiness V2 ya
ignoraba seams y conflicts como metadata no ordenante, mientras el validador
los trataba como aristas dirigidas del DAG.

## Causa raiz

Se confundieron dos relaciones tipadas distintas:

- `ArtifactRequirement`: disponibilidad material; si impone readiness y forma
  parte del DAG ejecutable.
- `SeamBinding`: compatibilidad contractual; puede ser bidireccional y no
  impone orden.

La presencia de campos `producerNodeId` y `consumerNodeId` en ambas relaciones
no las vuelve equivalentes para scheduling o deteccion de ciclos.

## Correccion TDD

- RED: artifact `n2 -> n3` mas seam `n3 -> n2` devolvia dos errores
  `artifact_cycle`; un loop compuesto solo por seams tambien devolvia dos.
- GREEN: `validateGraphRevision` conserva la validacion de self-relations y de
  participantes de seams, pero excluye seams de la adyacencia del DAG.
- Controles: ciclos de artifacts, legacy ordering y mezclas con hierarchy
  siguen rechazados; readiness continua dependiendo solo de artifacts.
- El prompt del planner ahora define explicitamente producer/consumer y ordena
  omitir un seam command/API sin consumidor interno, para reducir direcciones
  semanticas espurias sin convertirlas en falsas dependencias.

Verificacion focalizada: 69/69 tests PASS en task graph, compiler, critics y
WorkBreakdown; typecheck de `@manyhands/task-graph` y
`@manyhands/decomposer` PASS.

## Que no se concluye

No se concluye que cualquier direccion de seam sea semanticamente correcta.
Una direccion incoherente debe ser cuestionada por grounding/contract critics o
reparada por el planner, no modelada como orden de ejecucion. Tampoco se
concluye que quitar el falso ciclo baste para entregar la serie ancha: retry-10
no llego a ejecucion y el sucesor debe volver a correr desde N=4.

No se reinterpretan los resultados historicos: los journals y fallos
`artifact_cycle` permanecen inmutables como evidencia de la implementacion que
los produjo.
