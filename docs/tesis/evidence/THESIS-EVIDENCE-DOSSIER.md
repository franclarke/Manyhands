# Dossier de evidencia de ManyHands

Fecha de cierre de la evidencia: 2026-08-02.

Este documento compila evidencia ya preservada y derivada para responder las
preguntas de investigación. No es el manuscrito de la tesis y no modifica
`main.tex` ni `presentacion.tex`. Cada afirmación cuantitativa apunta a un
artefacto concreto; los resultados adversos se conservan con su resultado
original.

## PI-1 — ¿El sistema entrega un resultado integrado y verificable?

### Lo que sí está entregado

- Existe un caso canónico con dos ejecuciones consecutivas de punta a punta,
  commit final, manifiesto y comprobante; el caso está resumido en el baseline
  y sus artefactos canónicos están indexados en la [evidencia de ejecución
  canónica](canonical-run/).
- La línea Warehouse tiene una única entrega verificada por el oráculo externo:
  W1, commit `71f61c9efa222103ca2fb2f67692434ab493d75c`. La afirmación y su
  límite están registrados en [EVIDENCE-BASELINE.md](../EVIDENCE-BASELINE.md).

### Lo que no está entregado

Ninguna de las nueve celdas del grafo ancho `retry-8`, `retry-10` y
`retry-11` produjo una entrega. La cadena longitudinal de Warehouse queda, por
tanto, en 1/8, tal como registra [EVIDENCE-BASELINE.md](../EVIDENCE-BASELINE.md)
y el resumen de continuidad de [HANDOFF.md](../HANDOFF.md). Las tres celdas de
`retry-11` conservan como causa terminal registrada
`executor_stuck_after_process_exit_without_terminal_transition` en su
[series-ledger](warehouse/wide-graph/retry-11/runs/series-ledger.json).

Las causas no autorizan a convertir un fallo de entrega en una decisión de
granularidad: el [informe de cierre](../CLOSURE-REPORT.md) distingue muerte del
proceso, abort de libuv, fallo de planificación y otros problemas operativos.
La conclusión de PI-1 es de capacidad observada y trazabilidad, no de entrega
amplia sostenida.

## PI-2 — ¿La política decide si y cómo dividir?

### Evidencia de decisión y de refutación

La política determinista selecciona cortes cuando las hojas resultan
infactibles; no inventa un corte válido por sí misma. Una versión que
particionaba rutas mecánicamente generó tres candidatos que violaban sus
propios contratos de alcance, y esa capacidad fue retirada. El hecho negativo
está documentado en [EVIDENCE-BASELINE.md](../EVIDENCE-BASELINE.md).

El caso motivador `warehouse-projections` tuvo 19 hijos y
`validationDuplication = 0.8947`; los intents compartidos eran criterios del
objetivo completo y no podían satisfacerse como criterios propios de cada hoja.
La auditoría, la fórmula y el contrafactual están en [policy-c-refuses-a-clean-wide-cut](warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md).

La medición planning-only de `retry-12` conservó el estímulo, la fórmula y el
umbral: N=4 obtuvo `validationDuplication = 0.3750` y
`splitAdvantage = +0.1710`, con razón registrada `utility`; N=8 obtuvo
`0.4828` y `+0.3275`, pero con razón `infeasibility`. La tabla completa y
sus límites están en [retry-12-measure](warehouse/wide-graph/retry-12-measure/README.md).
Esto sostiene que el término mide lo que declara medir, pero no demuestra que
el planner siempre elija la descomposición correcta.

### G6 — comparación de condiciones de granularidad

La métrica primaria es la cobertura de criterios externos satisfechos. Las seis
filas canónicas fueron atribuibles y las cifras se derivan del [resultado
canónico G6](g6/results.md), no de una lectura manual de logs.

| Condición | Repetición 1 | Repetición 2 | Media derivada | Observación preservada |
|---|---:|---:|---:|---|
| A | 0.9 | 0.9 | 0.90 | Falló `backorder-recorded` en ambas filas. |
| B | 0.9 | 0.8 | 0.85 | En la segunda fila también fallaron typecheck y build. |
| C | 0.7 | 0.9 | 0.80 | La primera fila falló typecheck, build y `backorder-recorded`. |

El veredicto formal es inconcluso: A supera a C en la primera repetición y
empata en la segunda. Con dos repeticiones por condición no se hace inferencia
estadística ni se confirma o falsa H-G6; ver [verdict.md](g6/verdict.md).
Los resultados no se comparan con G5 porque cambian ejecutor, diseño y base,
limitación registrada junto al veredicto y al [registro de etapas G6](g6/STAGE-LEDGER.md).

### Implementabilidad de hoja

El análisis reproducible de 37 journals contiene 84 intentos: 70 candidatos, 10
fallos y 4 sin hecho terminal. Sobre los terminales, la tasa de candidato es
87,5 %; excluidos los seis fallos no atribuibles a la unidad, el baseline
registra 94,6 %. El detalle de conteos, distribuciones y razones está en
[leaf-outcomes/README.md](leaf-outcomes/README.md) y
[leaf-outcomes/summary.json](leaf-outcomes/summary.json).

No aparece un proxy de tamaño que separe entrega de fallo: seis de los diez
fallos habrían podido ocurrir en hojas de cualquier tamaño, y la única
violación de alcance atribuible ocurrió en la hoja más pequeña del corpus. Esto
es una conclusión negativa sobre el proxy, no una regla nueva de granularidad.

## PI-3 — ¿Qué fallos observables aparecen?

La clasificación siguiente es la clasificación preservada por el derivador de
hojas; no reinterpreta fallos pre-candidate como candidatos ni los elimina.

| Clase | Casos | Evidencia operacional |
|---|---:|---|
| Infraestructura / pool de worktrees | 3 | `worktree_pool_unavailable` y fallos de creación/limpieza en [summary.json](leaf-outcomes/summary.json). |
| Timeout | 3 | Timeouts del ejecutor en [summary.json](leaf-outcomes/summary.json). |
| Ejecutor sin causa reconocible | 2 | `executor_error` en [summary.json](leaf-outcomes/summary.json). |
| Defecto de producto | 1 | `empty_diff` en [summary.json](leaf-outcomes/summary.json). |
| Violación de alcance después de reparación | 1 | `scope_violation` en [summary.json](leaf-outcomes/summary.json). |

Las frecuencias anteriores suman los 10 fallos clasificados; los 4 intentos sin
hecho terminal permanecen como `none`. La distribución por paths y la
separación entre causas atribuibles y no atribuibles están preservadas en
[leaf-outcomes/README.md](leaf-outcomes/README.md).

En G6, los fallos de los candidatos no se corrigieron después de medirlos:
`backorder-recorded`, typecheck y build permanecen en las filas canónicas. La
evidencia por celda está indexada en [results.md](g6/results.md) y el último
resultado operacional, B-r2, en [stage-7-cell-g6-06-T1-B-r2.md](g6/stage-7-cell-g6-06-T1-B-r2.md).

## Parámetros provisionales

`minimumAdvantage = 0.15` y `maxLeafPlannedPaths = 12` siguen siendo
provisionales. El primer valor aparece en la auditoría de la política y el
segundo en la medición planning-only de `retry-12`; ambos documentos declaran
que no están anclados por una serie amplia entregada:
[policy-c-refuses-a-clean-wide-cut](warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md)
y [retry-12-measure](warehouse/wide-graph/retry-12-measure/README.md).

No se modificaron durante G6 el mínimo, la fórmula, el estímulo, los criterios
externos ni el oráculo. La congelación y la semántica de hashes están en
[freeze.json](g6/freeze.json); la derivación se puede repetir desde el snapshot
comprometido en [canonical-runs/manifest.json](g6/canonical-runs/manifest.json).

## Limitaciones declaradas

- No existe una serie amplia entregada: PI-1 sólo tiene 1/8 de la cadena
  longitudinal y las nueve celdas anchas citadas no entregaron
  ([EVIDENCE-BASELINE.md](../EVIDENCE-BASELINE.md)).
- El motivador de 19 hijos nunca fue re-medido a su propia anchura
  ([policy-c-refuses-a-clean-wide-cut](warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md)).
- `retry-12` fue planning-only: no prueba ejecución, candidato, entrega ni
  oráculo externo ([retry-12-measure](warehouse/wide-graph/retry-12-measure/README.md)).
- G6 tiene dos repeticiones por condición, no tiene p-values y su veredicto es
  inconcluso ([verdict.md](g6/verdict.md)).
- G6 no es comparable con G5 por diseño y base de ejecución
  ([verdict.md](g6/verdict.md)).
- Las seis filas canónicas G6 son atribuibles; eso no convierte los demás runs
  preservados en evidencia atribuible. El snapshot canónico sólo fija las seis
  entradas utilizadas para derivar resultados y deja los pools, worktrees,
  journals y runs originales intactos ([canonical-runs/README.md](g6/canonical-runs/README.md)).
- Los parámetros permanecen provisionales y no se generalizan a repositorios,
  ejecutores o tamaños no observados ([retry-12-measure](warehouse/wide-graph/retry-12-measure/README.md)).

## Índice de evidencia

| Archivo | Contiene | Reclamo que permite sostener |
|---|---|---|
| [EVIDENCE-BASELINE.md](../EVIDENCE-BASELINE.md) | Resultados previos, PI-1/PI-2, 1/8, 94,6 % y límites | No confundir evidencia ya medida con nueva evidencia. |
| [CLOSURE-REPORT.md](../CLOSURE-REPORT.md) | Causas raíz y cierre operativo histórico | Distinguir fallos de infraestructura, proceso y planner. |
| [HANDOFF.md](../HANDOFF.md) | Continuidad y análisis de implementabilidad | Contexto de los 84 intentos y del límite longitudinal. |
| [leaf-outcomes/README.md](leaf-outcomes/README.md) y [summary.json](leaf-outcomes/summary.json) | Derivación de hojas, conteos, clases y distribuciones | Ningún proxy de tamaño separa entrega de fallo. |
| [policy-c-refuses-a-clean-wide-cut](warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md) | Auditoría del caso motivador y fórmula | `validationDuplication` y el rechazo del corte ancho. |
| [retry-12-measure](warehouse/wide-graph/retry-12-measure/README.md) | Medición N=4/N=8 y límites planning-only | El término puede medir utilidad sin probar entrega. |
| [g6/results.md](g6/results.md), [results.csv](g6/results.csv), [results.json](g6/results.json) | Salidas derivadas de las seis celdas | Coberturas por celda y medias por condición. |
| [g6/verdict.md](g6/verdict.md) | Veredicto estadístico y comparabilidad | G6 inconcluso; no hay confirmación ni falsación. |
| [g6/canonical-runs/manifest.json](g6/canonical-runs/manifest.json) | Hashes y procedencia del snapshot mínimo | La agregación canónica es reproducible. |
| [g6/stage-10-reviews.md](g6/stage-10-reviews.md) | Reviews independientes y fixes fail-closed | La auditoría física no acepta diffs no materializables. |
| [g6/STAGE-LEDGER.md](g6/STAGE-LEDGER.md) | Etapas, commits y archivos de evidencia | Cadena de custodia documental de G6. |

## Qué no se concluye

- No se concluye que ManyHands entregue de forma confiable una serie amplia ni
  que la cadena Warehouse esté completa.
- No se concluye que A, B o C sea superior de manera estadísticamente
  significativa; el veredicto G6 es inconcluso.
- No se concluye que el tamaño de una hoja sea un predictor suficiente de éxito.
- No se concluye que `minimumAdvantage` o `maxLeafPlannedPaths` sean valores
  óptimos o generalizables.
- No se convierten fallos pre-candidate, runs sin hecho terminal ni resultados
  adversos en éxitos o ceros.
