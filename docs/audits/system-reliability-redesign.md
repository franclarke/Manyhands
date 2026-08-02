# Auditoría de fiabilidad y rediseño del sistema

Fecha: 2026-08-02. Alcance: ruta V2 productiva. Esta auditoría no reinterpreta
G6 ni modifica sus freezes, resultados, umbrales u oráculos.

## Estado observado

La arquitectura objetivo separa Planner, política, compilador, scheduler y
ejecución. La ruta que hoy se invoca desde la aplicación implementa parte de
esa separación, pero la política llega tarde: recibe un único
`WorkBreakdown`, poda o colapsa su árbol y sólo pide como máximo un replan del
modelo. Por eso no compara alternativas semánticas equivalentes y no puede
corregir un árbol cuya semántica sea pobre.

La condición adaptativa no es un predictor empírico de entrega. Es una
heurística determinista sobre un candidato de planning; los resultados G6
preservados son inconclusos y no autorizan a afirmar superioridad de A, B o C.

## Mapa de arquitectura actual

```text
goal + target
  -> apps/web/.../v2/run-coordinator-host.ts
  -> planning-host.runPlanningV2
  -> repository inspector (RepositorySnapshot)
  -> WorkBreakdownPlanner (LLM, un WorkBreakdown)
  -> selectGranularityStrategy (A/B/C, poda un árbol)
  -> compileGraphRevision + compileContractBundles
  -> graph/contract review + approval
  -> execution driver / scheduler (waves)
  -> isolated node execution + candidate validation
  -> artifact adoption / bottom-up integration
  -> exact final-candidate validation -> delivery receipt
  -> JSONL events -> reducer/snapshots -> web projection
```

El run journal es la historia canónica. `RunRecord`, snapshots y UI son
proyecciones; stdout del executor es diagnóstico, mientras que Git, contratos,
manifests y Evidence Matrix son la autoridad de adopción.

## Fronteras y pérdida de información

| Frontera | Entrada -> salida / responsable | Determinismo y validación | Riesgo y evidencia |
| --- | --- | --- | --- |
| Goal -> grounding | goal/target -> `RepositorySnapshot`; host/inspector | inspección determinista sobre commit; snapshot id/disposición | índice parcial puede degradar señales; queda `repository.inspected` |
| Grounding -> planning | brief/evidence -> `WorkBreakdown`; Planner/LLM | LLM; schema, grounding y fidelity checks | una sola muestra semántica, señales declaradas no prueban corrección; intentos/nodos del planner |
| Planning -> política | breakdown -> `selectedBreakdown`; `strategy-selector.ts` | selección determinista para el árbol dado | poda no crea alternativa; features ignoran ownership/seam completo; strategy event |
| Política -> compiler | breakdown elegido -> graph, bundles, review | compilación mecánica y critics | al colapsar se remapean relaciones, se puede ocultar qué frontera se descartó; graph/contract events |
| Compiler -> scheduler | graph/contracts -> readiness/wave | readiness/wave deterministas con configuración persistida | scheduler agenda, no puede recuperar intención semántica omitida; readiness/wave events |
| Scheduler -> execution | node contract/base -> candidate/failure | procesos/LLM no deterministas; scope/fingerprint/candidate guardados | repair debe mantener inputs; attempt/failure/evidence events |
| Execution -> integration | artifacts/contracts -> composite candidate | materialización y validación deterministas sobre inputs | seam descubierto tarde llega como failure/enmienda; manifests y events |
| Candidate -> delivery | final manifest -> receipt | validación sobre commit exacto | delivery sólo debe publicar tree validado; final and delivery events |
| Journal -> UI | events -> projection | reducer determinista/versionado | schema incompleto puede impedir explicar decisión; journal/snapshot |

## Causas raíz priorizadas

### SRR-01 — selección tardía sobre una única propuesta (crítica)

- Código: `apps/web/src/lib/server/runs/v2/planning-host.ts:123-147`,
  `packages/decomposer/src/granularity/strategy-selector.ts:58-106`.
- Mecanismo: el host llama una vez al planner, luego `selectGranularityStrategy`
  recorre ese mismo árbol. Ante inviabilidad sólo re-llama al planner una vez
  con feedback. No existe un conjunto tipado y congelado de alternativas antes
  de la selección.
- Pruebas existentes: `tests/planning-candidate-replay.test.ts`,
  `tests/planning-v2-adaptive.test.ts`, `tests/granularity-utility-policy.test.ts`.
- Clasificación: defecto de producto y error de diseño. No es una limitación que
  se resuelva agregando contexto al LLM.

### SRR-02 — la utilidad omite riesgos semánticos de integración (crítica)

- Código: `packages/decomposer/src/granularity/strategy-selector.ts:223-286`.
- Mecanismo: beneficio = promedio de `contextRelief`, paralelismo y aislamiento;
  costo = coordinación, overlap de paths, duplicación de intents e incertidumbre.
  No evalúa ownership verificable, compatibilidad/materialización de seams,
  impacto de contrato público, cobertura de criterios, superficie de validación
  o riesgo histórico de integración. Un corte puede puntuar alto aun perdiendo
  una obligación transversal.
- Pruebas existentes: `tests/granularity-utility-policy.test.ts`,
  `tests/contract-acceptance-allocation.test.ts`.
- Clasificación: defecto de producto. El límite del modelo sólo explica la
  calidad de un candidato, no la ausencia de guardrails deterministas.

### SRR-03 — ownership se deriva después de duplicar intención (alta)

- Código: `packages/decomposer/src/granularity/adaptive-planning.ts:238-248`,
  `packages/decomposer/src/compiler/acceptance-allocation.ts`,
  `packages/decomposer/src/compiler/contract-compiler.ts`.
- Mecanismo: `propagateAncestorAcceptance` replica intents ancestros en hojas;
  el compilador luego calcula un LCA. Esa representación intermedia infla
  `validationDuplication` y deja la propiedad como efecto implícito de un
  algoritmo, no como dato explícito revisable. El test local no commiteado que
  preserva los intents root-only en el composite expone la regresión.
- Pruebas existentes: `tests/contract-acceptance-allocation.test.ts`,
  `tests/granularity-utility-policy.test.ts`.
- Clasificación: defecto de producto. No se concluye que todos los planes
  históricos estén afectados; se concluye que el modelo actual no hace visible
  ni valida la matriz requerida antes de seleccionar.

### SRR-04 — seams y contratos tienen forma, no completitud semántica (alta)

- Código: `packages/decomposer/src/planner/schema.ts` (`CandidateSeamSchema`),
  `packages/decomposer/src/compiler/contract-compiler.ts`.
- Mecanismo: un seam requiere `kind` y `specification`, pero no expresa de forma
  tipada producer/consumer compatibility, implementación/materialización,
  validación de la frontera ni ownership de la obligación. `semanticFacts`
  convierten IDs de evidencia en pares genéricos; eso no impide seleccionar un
  cut con interfaz ambigua.
- Pruebas existentes: `tests/graph-compiler.test.ts`,
  `tests/contracts-interface-contract.test.ts`.
- Clasificación: defecto de producto y brecha de arquitectura.

### SRR-05 — comparabilidad parcial de condiciones (alta)

- Código: `planning-host.ts` acepta `experimentalCandidate`, pero el flujo normal
  llama al LLM para cada planning; la condición forma parte de la llamada de
  selección posterior.
- Mecanismo: el replay experimental puede fijar un breakdown y su hash, pero no
  existe una colección de candidatos con identidad/versiones que permita
  comparar políticas o estrategias futuras sobre el mismo conjunto validado.
- Pruebas existentes: `tests/planning-candidate-replay.test.ts`,
  `tests/run-granularity-strategy-selected.test.ts`.
- Clasificación: limitación experimental y brecha de producto.

### SRR-06 — recuperación conserva evidencia de attempts pero no decisión física (media)

- Código: `packages/execution-core/src/result/recorder.ts`,
  `packages/execution-core/src/run/amendments-engine.ts`,
  `packages/orchestrator-graph/src/v2/execution-driver.ts`.
- Mecanismo: fingerprints, scope y candidates son fail-closed, pero la política
  de planning no tiene un snapshot inmutable de envelope/candidatos/selección
  que el repair deba conservar. Una nueva planificación sólo queda como nuevo
  output textual y eventos de planning, no como revisión explícita de intención.
- Clasificación: brecha de diseño; la preservación de attempts no equivale a
  preservación completa de la decisión de planning.

### SRR-07 — la falla de ejecución puede perder su hecho terminal durable (alta)

- Código: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:271-273`
  (`driveClaimedExecutionV2`) y `:385-398` (`recordExecutionFailure`).
- Mecanismo: ante un error productivo, el pipeline intenta escribir `run.failed`,
  pero descarta con `.catch(() => undefined)` cualquier fallo del journal o de la
  proyección `RunRecord`. El error externo se relanza, mientras el run puede
  quedar sin hecho terminal durable ni cache coherente. La captura no distingue
  fallo de la ejecución de fallo al registrar esa ejecución.
- Pruebas existentes: no existe una regresión que fuerce la falla de
  `recordExecutionFailure` ni una reconciliación posterior que repare el estado.
- Clasificación: defecto de producto y brecha de recuperación. No autoriza a
  sintetizar un resultado terminal: requiere receipt durable independiente y
  reconciliación verificable.

## Arquitectura objetivo y decisiones

```text
snapshot + goal
  -> deterministic PlanningEnvelope (policy versioned)
  -> bounded semantic CandidatePlanSet (Planner/LLM)
  -> compile and fail-closed validate each candidate
  -> CandidatePlanSet.valid
  -> deterministic policy selection + decision record
  -> immutable graph/contracts/obligations to scheduler and execution
```

1. El envelope fija presupuesto, restricciones de scope, paralelismo, criterios
   globales y requisitos de exploración; no crea tareas, paths ni seams.
2. El Planner produce alternativas semánticas con IDs y razones. La exploración
   es acotada por el envelope; no es retry abierto.
3. El compilador produce una matriz explícita de ownership para cada criterio y
   rechaza cero dueño, incompatibilidad o cobertura no verificable.
4. Los seams pasan a incluir participants, compatibilidad, validación y
   completitud; una frontera cross-layer sin seam/contrato necesario no es
   seleccionable.
5. La utilidad conserva señales históricas y agrega guardrails/riesgos
   explicables. Un candidato inválido no compite por score.
6. `PlanningSelection` persiste envelope, hashes de candidatos, diagnósticos de
   rechazo, evaluación y ganador; es reproducible sin LLM.

Alternativas descartadas: inventar particiones por rutas (contradice la evidencia
preservada); propagar todos los criterios a todas las hojas (duplica validación
incompatible); ajustar `minimumAdvantage` (parámetro experimental congelado y no
causa raíz); reintentos ilimitados del planner (destruye comparabilidad y costo).

## Criterios verificables de éxito

- Mismo envelope, snapshot, candidate set y versión de política produce la
  misma selección y el mismo registro serializado.
- La política rechaza intentos de inventar unidades, paths o seams.
- Ningún plan con criterio sin owner, ownership incompatible, seam incompleto o
  contrato cross-layer insuficiente llega al compilador ejecutable.
- Los criterios globales se asignan al owner de integración o a dueños locales
  explícitos, sin clonarse como validaciones locales incompatibles.
- El journal puede reconstruir exactamente envelope, set, validaciones,
  diagnósticos y selección.
- Un replan contiene razón estructurada y conserva la revisión/candidatos que lo
  motivaron; una reparación no elimina intención ni evidencia previa.
- Si falla el journal terminal de ejecución, queda un receipt durable de la
  falla y la reconciliación posterior termina o expone el run sin falsearlo.

## Qué no se concluye

- No se concluye que la política actual sea inútil ni que el LLM no pueda
  proponer una buena descomposición: se concluye que el flujo actual no permite
  evaluarlo de forma suficientemente aislada y segura.
- No se concluye que cambiar pesos, umbrales o prompts resolvería estas causas.
- No se concluye superioridad estadística de ninguna condición G6, ni se alteran
  sus resultados históricos.
