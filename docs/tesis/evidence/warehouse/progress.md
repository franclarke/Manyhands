# Progreso — C2 + Warehouse

> **Plan rector:** [`../../../plans/2026-07-24-c2-warehouse-thesis-program.md`](../../../plans/2026-07-24-c2-warehouse-thesis-program.md)
> · **Inicio:** 2026-07-24 · **Estado general:** en ejecución.

## Reglas del ledger

- Un checkpoint requiere documentación, tests/comandos registrados y commit.
- Los cambios conductuales siguen TDD rojo → verde → refactor.
- `pilot` y `final` nunca comparten runs de versiones diferentes.
- Ningún resultado C2 se incorpora a la tesis antes del freeze y los gates.
- No se hace push.

## Checkpoints

| Checkpoint | Tasks | Estado | Commit | Verificación |
|---|---:|---|---|---|
| 1 — C2 core | 1–4 | **completed** | `74f001f`, `950dd18`, `e94b4b8`, `d9e5b41` | 45 tests PASS + 2 package typechecks |
| 2 — Productive integration | 5–8 | **completed** | `bf0ee82`, `d96cc24`, `a424ade`, `7f7d9b4`, `18e6aab` | 50 tests PASS + 3 typechecks + 2 builds |
| 3 — Metrics and stability | 9–10 | pending | — | — |
| 4 — Warehouse assets and drivers | 11–12 | pending | — | — |
| 5 — Pilot construction | 13 | pending | — | — |
| 6 — Freeze | 14 | pending | — | — |
| 7 — Final construction and comparison | 15–16 | pending | — | — |
| 8 — Results and thesis | 17–18 | pending | — | — |

## Registro cronológico

### 2026-07-24 — Inicio del checkpoint 1

- Se aceptó ADR 0012 como target de implementación piloto.
- Se preservó C1 como ruta histórica y G5 como resultado formativo negativo.
- Se fijó que Tasks 1–4 cierran juntas antes de integrar C2 al planning
  productivo.
- Siguiente evidencia: regresión roja para métricas de tamaño del índice.

### 2026-07-24 — Cierre del checkpoint 1

- Task 1: ADR 0012, separación C1/C2 y estructura de evidencia creadas.
- Task 2: `RepositoryFileIndex` incorpora `byteSize` y `lineCount`; el perfil de
  caché rápida se elevó a `exports-only-v2-size-metrics` para no reutilizar
  silenciosamente índices viejos sin medición.
- Task 3: estimator `utf8-bytes-div-4/1.0.0` implementado como función pura; los
  paths nuevos y snapshots históricos sin tamaño quedan explícitamente
  inciertos.
- Task 4: selector C2 bottom-up implementado con condiciones A/B/C2, selección
  parcial de subtrees, hash determinista y prohibición de units sintéticas.
- Verificación combinada: 45 tests PASS, 1 performance test omitido por su gate
  de entorno, typecheck de `repository-index` y `decomposer` PASS.
- Evidencia detallada: [`checkpoints/checkpoint-1.md`](checkpoints/checkpoint-1.md).
- Siguiente bloque: Tasks 5–8; C2 aún no gobierna la ruta productiva.

### 2026-07-24 — Cierre del checkpoint 2

- Task 5: el Planner acepta feedback estructurado y la ruta productiva permite
  un único replan semántico cuando la hoja medida es inviable.
- Task 6: cada criterio del usuario tiene un único owner; las obligaciones
  técnicas locales preservan validabilidad sin inflar la vara entre condiciones.
- Task 7: la selección C2 es un evento durable, replayable y visible con
  beneficio, costo, features, límites, evidencia y rationale.
- Task 8: A/B/C1/C2 son configuración explícita; C2 es el default y el replay
  bloqueado valida hash, snapshot, goal y aceptación.
- Verificación combinada: 50 tests, tres typechecks y dos builds PASS.
- Evidencia detallada: [`checkpoints/checkpoint-2.md`](checkpoints/checkpoint-2.md).
- Siguiente bloque: Tasks 9–10; métricas no censuradas y estabilidad real.
