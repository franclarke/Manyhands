# @manyhands/decomposer

> Convierte una feature en lenguaje natural en un DAG de tareas con contratos e interfaces compartidas. Es uno de los **aportes centrales** del proyecto.

## Rol en el pipeline

Planning. Es el primer paso: del prompt al plan.

## Conceptos clave

- **Descomposición recursiva *interface-aware*.** Cada nodo se evalúa por separado y decide si es **atómico** o si debe **dividirse**. Cuando se divide, define las **interfaces compartidas** que sus hijos deben consumir y producir — esas costuras son lo que después permite ejecutar las hojas en paralelo y recomponerlas con contexto.
- **Camino de producto.** `RecursiveDecomposer` / `GeminiRecursiveDecomposer` (LLM vía Gemini). La granularidad `low` / `medium` / `high` describe la **agresividad** de la descomposición, no una cantidad fija de nodos ni de profundidad.
- **Sin fallback silencioso.** Una falla del LLM durante planning produce un error accionable; no se degrada a una descomposición determinística (D3).

## API pública

`RecursiveDecomposer` · `GeminiRecursiveDecomposer` · `buildStepPrompt` · `DecomposeStepOutputSchema` · `StepInterfaceSchema` · `normalizeLlmDecomposition` · `runDecomposerGuards` · `GRANULARITY_PROFILES`

> [!NOTE]
> `MockDecomposer`, `MetadataDrivenMockDecomposer` y `SingleTaskDecomposer` son descomponedores determinísticos remanentes de fixtures/tests, **no** el camino de producto.

## Dependencias

`@manyhands/contracts`, `@manyhands/task-graph`, `@manyhands/shared`. **Más:** [`docs/system/03-decomposer.md`](../../docs/system/03-decomposer.md).
