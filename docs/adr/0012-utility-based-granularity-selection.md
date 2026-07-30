# ADR 0012 — Selección de granularidad basada en utilidad

## Estado

Aceptado para implementación piloto. La configuración numérica se congela sólo
después del caso piloto y antes de producir evidencia final.

## Contexto

La política C1 calcula un índice de complejidad intrínseca `C_task` con cuatro
señales y un umbral. G5 mostró dos límites diferentes:

1. el umbral puede decidir conservar o expandir un corte semántico, pero no
   puede crear un corte que el Planner no propuso; y
2. una tarea de 215 líneas no ejerció la presión de contexto bajo la cual una
   descomposición podría compensar su costo de coordinación.

Además, tres de las cuatro señales de C1 son estimaciones del modelo y los
criterios de aceptación se multiplicaron por unidad. Por eso una comparación de
topologías no estaba usando la misma vara de validación.

## Decisión

El Planner conserva la responsabilidad de producir un `WorkBreakdown`
semántico con composites, hojas y relaciones justificadas. C2 no inventa
unidades ni divide listas de paths: selecciona una frontera ejecutable del mismo
árbol mediante una evaluación determinista bottom-up.

Para cada composite se comparan tres resultados:

- ejecutarlo como hoja cohesiva;
- expandir una combinación de estrategias elegidas para sus hijos; o
- solicitar un replan semántico cuando la hoja es inviable y no hay un corte de
  al menos dos hijos válido.

La ventaja de dividir se define sobre rasgos normalizados y observables antes de
la ejecución:

```text
benefit = mean(contextRelief, parallelism, faultIsolation)
cost    = mean(coordination, pathOverlap, validationDuplication, uncertainty)
splitAdvantage = benefit - cost
```

Una hoja viable sólo se divide cuando `splitAdvantage` supera el margen
versionado de la política. Una hoja inviable no se ejecuta silenciosamente: se
elige un split válido o se pide un nuevo corte semántico.

La masa de contexto usa bytes UTF-8 del `RepositorySnapshot` con un estimator
versionado. Los archivos futuros o snapshots históricos sin tamaño aumentan
`uncertainty`; nunca se registran como contexto cero medido.

Las condiciones comparativas se definen sobre el mismo árbol candidato:

- A conserva la raíz como hoja;
- B selecciona la frontera semántica válida más fina;
- C2 selecciona la frontera con mejor utilidad esperada.

Los criterios de aceptación del usuario se asignan una sola vez a la frontera
seleccionada. Si varios siblings los requieren, su owner es el lowest common
ancestor. Las validaciones técnicas locales permanecen separadas.

## Alternativas descartadas

- **Mantener C1 sin cambios:** no corrige señales no medidas, cortes ausentes ni
  el costo explícito de coordinación.
- **Ajustar pesos o umbral de C1:** no puede crear una alternativa semántica y
  favorecería tuning sobre el resultado observado.
- **Forzar un mínimo de hojas:** confunde uso de múltiples agentes con calidad
  y empeora tareas cohesivas.
- **Particionar paths determinísticamente:** ya produjo unidades sin cohesión y
  violaciones de alcance en evidencia canónica.
- **Dejar que el LLM elija la frontera final:** pierde reproducibilidad y mezcla
  interpretación semántica con política experimental.

## Consecuencias

- El `WorkBreakdown` candidato y la frontera seleccionada son hechos diferentes
  del planning, pero sólo la segunda se compila a `GraphRevision`.
- Las decisiones C2 deben persistir versión, configuración efectiva, candidate
  hash, rasgos, alternativas y rationale.
- C1 se conserva para replay histórico; C2 se vuelve productiva sólo cuando
  cierre sus gates.
  **Corregido el 2026-07-30 (ticket 02):** C1 **no** quedó replayable. La
  política `C_task` que lo producía no está implementada en el build actual, y
  la reachability que fingía conservarla (`granularityPolicyFor`) era código
  muerto: ningún camino productivo la alcanzaba. Hoy
  `resolveGranularityCondition` **rechaza ruidosamente** `C1` y `C2` en vez de
  resolverlos en silencio a `C`. Los journals que llevan esas etiquetas siguen
  siendo legibles como evidencia inmutable; lo que se rechaza es planificar bajo
  ellas.
- Un piloto puede cambiar la configuración C2. Una serie final queda inválida
  si C2, prompts, seed, oráculos, modelo o drivers cambian después del freeze.
- La tesis reportará el G5 de C1 como resultado formativo negativo y separará su
  evidencia de la evaluación final de C2.

## Evidencia requerida antes de declarar la decisión implementada

- tests puros del selector y del estimator;
- prueba vertical Planner → C2 → Graph Compiler → event replay;
- criterios de aceptación no duplicados entre A/B/C2;
- dos runs de estabilidad sobre un único commit;
- construcción piloto completa de Warehouse Control Tower.
