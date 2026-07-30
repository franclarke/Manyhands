# Ticket 26 - Inventario de policy y configuracion efectiva

Estado verificado: 2026-07-29.

| Senal o modulo | Ruta productiva | Evidencia durable | Estado |
|---|---|---|---|
| `maxLeafContextTokens` | `PILOT_UTILITY_POLICY` -> `selectGranularityStrategy` | `planning.granularity_strategy_selected.payload.config` | conectado |
| `maxLeafScopePaths` | `PILOT_UTILITY_POLICY` -> selector | mismo evento y `RunProjection.granularityStrategy.config` | conectado |
| `maxLeafPlannedPaths` | `PILOT_UTILITY_POLICY` -> `isLeafFeasible` -> approved execution input | strategy event and optional `FinalArtifactManifest.granularityPolicy`; omitted for incomplete historical journals | conectado desde ticket 26 |
| `validationDuplication` | `cutFeatures` cuenta asignaciones de aceptacion repetidas entre hijos | `features.validationDuplication` dentro de cada assessment | conectado; no se modifico formula ni umbral |
| condiciones A/B/C | `resolveGranularityCondition` -> selector | `condition` y `policyVersion` en el evento de estrategia | conectado; C1/C2 históricos se rechazan explícitamente |
| `applyAdaptiveGranularity` legacy | tests y compatibilidad de condiciones historicas | no es el selector productivo V2 | transicion explicita |

La configuracion efectiva se valida antes de seleccionar la estrategia, se incluye
en el evento durable, se reconstruye en el reducer y viaja al manifest final
cuando el journal contiene el campo completo. Los eventos anteriores a la
incorporacion de `maxLeafPlannedPaths` siguen siendo legibles; esos runs no
fabrican un valor ausente. La duplicacion de validacion se mide desde
`acceptanceIntentIds` reales entre hijos, sin sustituirla por una constante ni
recalibrar el piloto.

Evidencia principal: `tests/run-granularity-strategy-selected.test.ts`,
`tests/granularity-utility-policy.test.ts` y
`tests/granularity-policy-conditions.test.ts`.
