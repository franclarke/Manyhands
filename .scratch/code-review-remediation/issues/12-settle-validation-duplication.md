# 12 — Veredicto sobre la duplicacion de validacion

**What to build:** la pregunta abierta mas importante de la tesis queda cerrada con evidencia: si el termino mide mal, o si el planner asigna criterios de objetivo completo a las hojas.

**Blocked by:** 11 — necesita la medicion con intents efectivamente particionados por hoja.

**Status:** closed

- [x] Se compara la evaluacion nueva contra la registrada y se declara cual lectura sostiene la evidencia.
- [x] Si el termino cambia, va con regresion roja primero y version nueva de politica.
- [x] Si no se resuelve, queda declarado como limitacion en vez de ajustar el umbral.

## Resolution — 2026-07-30

The journals show that `validationDuplication` is mechanically measured from
repeated `acceptanceIntentIds` among sibling units. Values are present in the
historical C/C2 assessments (including non-zero values), so absence of
measurement is not the finding. The available evidence does not validate that
this normalized proxy represents semantic validation cost or establishes a
threshold for “good” duplication. The verdict is therefore: measurable
implementation, semantically unvalidated limitation. Formula, threshold and
stimulus were not changed, and no PASS claim is added.
