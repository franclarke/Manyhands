# N=16 vuelve a fallar la revisión del plan antes de ejecutar

Clasificación: **defecto de compilación del plan**, observado antes de crear
una hoja, worktree o candidato de entrega.

## Observación

El run real `44c7c60c-7474-4987-b4bc-23783f372771` partió del W1 verificado en
`71f61c9e`, con `codex-cli` / `gpt-5.5` / `high` en planificación, ejecución y
reparación. El journal llegó a descubrir el compuesto raíz, dieciséis hojas de
proyección, el registry y el script determinista, pero terminó en
`planning.failed` antes de materializar un grafo:

```text
Compiled plan review failed: unowned_acceptance: Required acceptance intent
intent-constraints has no leaf owner.; artifact_cycle: Cycle detected including
node-projection-registry-e95d910b98.; artifact_cycle: Cycle detected including
node-study-wide-graph-script-f534020c6f.
```

Los artefactos brutos se preservan en
`../../../wide-graph/retry-4/runs/warehouse-wide-n16/`. No hubo worktree,
ejecución, SHA candidato ni veredicto del oráculo.

La regresión de ownership ya corregida en el paso anterior sólo cubría el
adaptador `applyAdaptiveGranularity`. Este run siguió la ruta productiva del
selector de estrategia C, que conserva el árbol elegido sin propagar a las
hojas los intents requeridos que el planner dejó en el compuesto. Es una ruta
distinta y explica por qué el mismo invariante reapareció.

Los ciclos no se atribuyen todavía a una regla concreta: la ruta actual sólo
persiste el árbol candidato después de que el compilador lo acepte, por lo que
el journal conserva nodos y el diagnóstico, pero no las relaciones candidatas
rechazadas. Se debe capturar ese input rechazado antes de proponer una
corrección de ciclos.

## Próximo paso

Rojo primero: una regresión para la ruta `selectGranularityStrategy` debe
reproducir un intent requerido asignado sólo al compuesto raíz y exigir que la
salida seleccionada lo cubra en hojas. Luego se aplicará la mínima propagación
de cobertura heredada, sin cambiar umbrales ni métricas de la política C. La
persistencia del candidato rechazado se evaluará por separado para que el
diagnóstico de ciclos no dependa de una reconstrucción inferida.

## Qué no se concluye

No se concluye que N=16 sea inviable, que los ciclos sean responsabilidad de
una relación específica, que la política C requiera recalibración ni que
fallen ejecución, integración u oráculo: ninguna de esas etapas comenzó.
Tampoco este intento cuenta como evidencia de escalamiento; sólo demuestra que
la ruta productiva del selector no preservó la cobertura de aceptación exigida
por la revisión.
