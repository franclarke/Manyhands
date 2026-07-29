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

## Corrección acotada

Rojo primero: la regresión `granularity-utility-policy.test.ts` construyó una
raíz con `intent-root-only`, seleccionó el split C y falló porque ninguna hoja
la cubría. Verde: `selectGranularityStrategy` propaga la cobertura heredada al
árbol seleccionado antes de compilarlo. No cambia umbrales ni métricas de la
política C.

También se agregó una regresión de pipeline: si la revisión del compilador
rechaza el plan, el evento `planning.granularity_strategy_selected` se persiste
antes del compilador y conserva el árbol candidato y sus relaciones. Así el
próximo rechazo de ciclos tendrá la entrada exacta en el journal, sin inferirla
desde los nodos descubiertos.

Los dos casos quedaron verdes en las pruebas focalizadas de estrategia y
pipeline. La corrección aún requiere un nuevo run real para determinar si el
modelo vuelve a producir ciclos o si aparece otro defecto del plan.

## Qué no se concluye

No se concluye que N=16 sea inviable, que los ciclos sean responsabilidad de
una relación específica, que la política C requiera recalibración ni que
fallen ejecución, integración u oráculo: ninguna de esas etapas comenzó.
Tampoco este intento cuenta como evidencia de escalamiento; sólo demuestra que
la ruta productiva del selector no preservó la cobertura de aceptación exigida
por la revisión.

## Correccion posterior del diagnostico de ciclos

Los rechazos `artifact_cycle` posteriores se atribuyeron a seams que cerraban
el DAG. Esa atribucion era incorrecta respecto del contrato objetivo: un seam
no impone readiness. La correccion TDD posterior saco `SeamBinding` de la
adyacencia ejecutable y dejo artifacts/legacy/hierarchy como relaciones
ordenantes. Los journals historicos conservan el falso positivo original.
