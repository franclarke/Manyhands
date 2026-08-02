# Handoff — System reliability redesign

Fecha: 2026-08-02. Rama local: `codex/system-reliability-redesign`.

## Entregado en esta sesión

- `b9884bc` — auditoría técnica de la ruta productiva y causas raíz.
- `8e17d9e`, `1536ef0` — tipos y gates deterministas de `PlanningEnvelope` y `CandidatePlan`.
- `7390b6e` — trabajo paralelo ya integrado: `GranularityPlanningBrief` y generación acotada de candidatos en el planner. No modificar sus archivos de política sin revisar el contrato conjunto.
- `53c3e40`, `30ca18f` — ADR 0013 y formato.
- `ba58caf` — receipt durable de fallas de ejecución y reconciliación segura.
- `a7d89e4` — el host entrega el brief al planner y persiste el envelope en los eventos/snapshots antes del planning.
- `3634200` — auditoría actualizada con el estado real de migración.

No hubo push ni se ejecutaron runs pagos o experimentos LLM.

## Regresiones ejecutadas

- Roja: `tests/execution-failure-receipt.test.ts` falló porque faltaba el módulo. Verde luego de implementar receipt/reconciliación: 2/2.
- Roja: `tests/planning-v2-pipeline.test.ts` mostró que el host no pasaba el brief ni registraba el envelope. Verde luego del cableado: 11 pruebas focalizadas entre pipeline/adaptive/reducer.
- Todas las pruebas focalizadas se ejecutaron después de `pnpm build`.

## Verificación pendiente

Se inició la secuencia global requerida (`pnpm build`, `pnpm test`, typechecks de paquetes y web, `pnpm web:build`, `git diff --check`). Se interrumpió por solicitud del usuario mientras la suite global aún estaba corriendo, para conservar créditos. No debe declararse aprobada. Reanudar desde `pnpm build`, con el árbol limpio, y corregir únicamente regresiones atribuibles a esta rama.

## Brecha crítica aún abierta

El host productivo continúa llamando `plan()` una sola vez, aunque el planner ya expone `planCandidates()` y el envelope exige 2–3 candidatos. No conectar esta parte mediante una inferencia de ownership desde `acceptanceIntentIds`: eso recrearía exactamente el defecto SRR-03.

La continuación correcta es:

1. Definir un artefacto de salida tipado por candidato con matriz explícita `local`/`seam`/`global` y compatibilidad + validación de cada seam.
2. Hacer que el adaptador del planner produzca ese artefacto junto con el `WorkBreakdown`; conservar lectura compatible de runs históricos.
3. En `planning-host.ts`, invocar `planCandidates()` sólo para el flujo productivo, validar cada candidato fail-closed, y recién entonces evaluar la política. Los experimentos con candidato congelado siguen por su ruta de replay, sin reformular G6.
4. Persistir en eventos/snapshots el conjunto completo, hashes, diagnósticos, scores, ganador y diagnóstico de replan. Actualizar reducer y UI de diagnóstico sin destinos UI prohibidos.
5. Repetir TDD: mismo conjunto => mismo ganador; seams/ownership incompletos no llegan a compile/ejecución; replan conserva candidatos y causa.

## Límites preservados

- No tocar `docs/tesis/main.tex`, `docs/tesis/presentacion.tex`, ni evidencia histórica G6/Warehouse.
- No alterar fórmula, estímulos, umbrales, oráculos ni resultados de G6.
- No editar `strategy-selector.ts`, `adaptive-planning.ts`, `planning-brief.ts`, `prompt.ts` o `work-breakdown.ts` sin reconciliarse con el trabajo paralelo ya integrado.
- Evitar reset, clean, stash global y push.
