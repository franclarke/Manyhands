# Ticket 26 — Inventario de policy y configuración efectiva

Estado verificado: 2026-07-29.

| Señal o módulo | Ruta productiva | Evidencia durable | Estado |
|---|---|---|---|
| `maxLeafContextTokens` | `PILOT_UTILITY_POLICY` → `selectGranularityStrategy` | `planning.granularity_strategy_selected.payload.config` | conectado |
| `maxLeafScopePaths` | `PILOT_UTILITY_POLICY` → `RepositoryContextProfile`/selector | mismo evento y `RunProjection.granularityStrategy.config` | conectado |
| `maxLeafPlannedPaths` | `PILOT_UTILITY_POLICY` → `isLeafFeasible` | mismo evento; opcional al leer journals históricos | conectado desde ticket 26 |
| `validationDuplication` | `cutFeatures` cuenta asignaciones de aceptación repetidas entre hijos | `features.validationDuplication` dentro de cada assessment | conectado; no se modificó fórmula ni umbral |
| condiciones A/B/C | `resolveGranularityCondition` → `granularityPolicyFor` → selector | `condition` y `policyVersion` en el evento de estrategia | conectado |
| `applyAdaptiveGranularity` legacy | tests y compatibilidad de condiciones históricas | no es el selector productivo V2 | transición explícita; no se usa para sobreafirmar resultados V2 |

La configuración efectiva se valida antes de seleccionar la estrategia, se incluye
en el evento durable y se reconstruye en el reducer. Los eventos anteriores a la
incorporación de `maxLeafPlannedPaths` siguen siendo legibles; los nuevos eventos
lo persisten. La duplicación de validación se mide desde `acceptanceIntentIds`
reales entre hijos, sin sustituirla por una constante ni recalibrar el piloto.

Evidencia principal: `tests/run-granularity-strategy-selected.test.ts`,
`tests/granularity-utility-policy.test.ts` y
`tests/granularity-policy-conditions.test.ts`.
