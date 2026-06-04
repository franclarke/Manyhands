# Resolución de conflictos consciente del contexto

> Fecha: 2026-06-03 · Autor: Francisco (+ Claude) · Estado: aprobado para implementar

## Problema

Tras la planificación, el grafo suele exponer **muchos conflictos predichos** (riskMatrix, badge "Resolve conflicts (N)"). Hoy resolverlos es **manual**: el usuario abre el bottom sheet y serializa/acknowledge cada par. El objetivo es: `approve → auto-resolver → ejecutar`, **sin resolución manual**, y que la mejora sea **real**, no cosmética.

## Hallazgo arquitectónico que define el alcance

Cada hoja se ejecuta en un worktree aislado creado **siempre desde `graph.baseCommit`** ([executor.ts:240](../../../packages/execution-core/src/run/executor.ts), [:329](../../../packages/execution-core/src/run/executor.ts)), nunca desde el commit de su dependencia. Como cada hoja corre en su propio directorio, **no hay conflictos en tiempo de ejecución**: todos aparecen en **integración** (cherry-pick, D8).

Consecuencia: **serializar (agregar dependencias) cambia el orden de los batches pero NO evita el conflicto real**, porque la hoja dependiente sigue partiendo de base y no ve los cambios de su predecesora. Quien resuelve el merge real es el composer (`IntegrationAgent`, D8).

## Decisión de alcance

**Mix de dos piezas. Se descarta la "ejecución apilada".**

- **Descartado — ejecución apilada (hojas que parten del commit de su dependencia):** rompe el modelo bottom-up. Una hoja apilada sobre una dependencia de otro subárbol arrastra ese diff, que se re-aplica en el ancestro común → vuelve a conflictuar. Hojas con varias dependencias necesitarían un base sintético (= integrar antes de ejecutar). Es un rediseño tamaño-tesis y de alto riesgo de regresión.
- **Elegido — Pieza 1 (plan-time) + Pieza 2 (composer):** ataca el conflicto donde realmente ocurre (integración) y resuelve el dolor de UX (toil manual), sin tocar el modelo de ejecución ni renegociar D1–D10.

## Pieza 1 — Auto-resolver en tiempo de plan (UX: un clic)

**Qué hace:** un botón "Auto-resolver conflictos (N)" que, en `needs_review`/`approved`, **acknowledge en batch** todos los conflictos accionables (level `medium`/`high`/`blocking`) aún no reconocidos, usando su `explanation`/evidencia como rationale. El badge va a 0 → se ejecuta sin clics manuales.

**Qué NO hace:** no agrega dependencias. Como serializar es cosmético (ver hallazgo), agregar edges solo sacrificaría paralelismo sin beneficio. Se registra el conflicto (vía el patch `RISK_ACKNOWLEDGED`, que ya persiste `taskIds` + `reason`) y se delega el merge al composer.

**Componentes:**
- `apps/web/src/lib/conflict-resolution.ts` (nuevo, **puro y testeable**):
  `planConflictResolution(snapshot, patches) → { acknowledgements: Array<{ taskIds: [string,string]; reason: string }> }`.
  Reusa `deriveConflictList` (misma fuente que la UI), filtra a accionables no-acknowledged, produce una acknowledgement por par con rationale derivado de la evidencia. Determinístico e idempotente (correrlo dos veces no duplica).
- `apps/web/src/app/api/runs/[id]/auto-resolve/route.ts` (nuevo): `loadEditableRunContext` → `planConflictResolution` → `buildPatch("RISK_ACKNOWLEDGED", ...)` por par → `persistRunPatches`. Actor `system` (no invalida la aprobación). Responde el run actualizado.
- UI: botón en `run-action-bar.client.tsx` ("Auto-resolve conflicts (N)") visible en `needs_review`/`approved` cuando `activeConflictCount > 0`.

## Pieza 2 — Composer consciente de conflictos (robustez real)

**Qué hace:** las predicciones de conflicto (ya calculadas en planning, `run.planning.riskMatrix`) se threadean hasta el `IntegrationAgent`. Cuando un cherry-pick falla, el prompt de repair inyecta la evidencia de las predicciones **cuyos `sharedFiles` se solapan con los archivos en conflicto** del cherry-pick: archivos/símbolos compartidos + la explicación. El único intento (D8 intacto) se vuelve mucho más certero.

**Por qué filtrar por solapamiento de archivos:** evita mapear leaf↔composite. Si predijimos colisión en `foo.ts` y el cherry-pick conflictúa en `foo.ts`, inyectamos ese "por qué". Limpio y robusto.

**Componentes:**
- `execution-core/src/types.ts`: nuevo tipo `PredictedConflictHint = { taskAId, taskBId, level, sharedFiles, sharedSymbols, explanation }`.
- `IntegrationParams.predictedConflicts?: PredictedConflictHint[]`; `buildRepairPrompt` agrega una sección "Predicted conflicts on these files" filtrada por overlap con `conflict.conflictFiles`.
- Threading: `runExecutionPipeline` mapea `run.planning.riskMatrix` (accionables) → `PredictedConflictHint[]` → `ExecutionEngineInput.predictedConflicts` → `RunExecutionParams.predictedConflicts` → `RunExecutor` → `integrateBottomUp` → `integrationAgent.integrate({ predictedConflicts })`. Lista completa; el prompt filtra.

## Flujo resultante

`approve → "Auto-resolver" (acknowledge masivo + registro) → "Run" → en integración, el composer usa la evidencia predicha para reparar mejor.`

## Decisiones cerradas respetadas

- **D8 (1 intento de repair):** no se cambia el conteo; se mejora el contenido del único intento.
- **D1 (dependencies canónico):** la Pieza 1 no toca dependencias; usa `RISK_ACKNOWLEDGED`.
- **D4/D5/D7:** sin cambios al executor ni al modelo de aislamiento.

## Testing

- **Pieza 1 (puro):** snapshot con N conflictos accionables → N acknowledgements; idempotente (no duplica los ya reconocidos); ignora `low`.
- **Pieza 2 (composer):** el prompt de repair incluye la evidencia predicha cuando un `sharedFiles` solapa con el archivo en conflicto; no la incluye cuando no hay overlap; ausencia de `predictedConflicts` ⇒ prompt sin la sección (back-compat).
- **Suite completa** verde antes/después.

## Fuera de alcance (YAGNI)

- Resolución con Gemini en tiempo de plan (reordenar/reestructurar): diferido; el composer es el lugar correcto.
- Ejecución apilada / cambio del base de las hojas.
- Subir el número de intentos de repair (tocaría D8).
