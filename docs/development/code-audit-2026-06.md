# Auditoría de defectos latentes — junio 2026

> Auditoría de bugs latentes sobre el sistema de orquestación. Foco: defectos
> reales que se manifiestan en producción (no estilo ni riesgos hipotéticos),
> en las categorías invariantes/LLM/state-machine/checkpoint/interfaces/
> scheduling/aislamiento/integración.

---

## 1. Defectos encontrados y corregidos

### P1 · Propagación de obligación de interfaz en descomposiciones anidadas

**Categoría:** invariante no enforced + propagación de interfaces.
**Commit:** `8e397b1`.

El chequeo semántico a nivel de step del decomposer garantizaba que toda
`sharedInterface` definida en ese step figurara en el `produces` de algún hijo
**directo**. Pero la obligación se perdía cuando el hijo productor decidía
**descomponerse** en vez de ser atómico: el `produces` de un composite no se
empujaba a sus hijos ni se reflejaba en su contrato, y solo las hojas cuentan
como productoras en `validateExecutableTaskGraph`. Resultado: una costura
consumida por una hoja pero producida por ninguna hoja del subárbol.

El orphan era invisible al chequeo de step (que solo mira costuras definidas
localmente), así que `decompose()` devolvía `validation.contractValid = true` y
el plan roto recién explotaba como `orphan_consumed_interface` al proyectar el
planning — la clase "pasa la validación semántica, falla después de construido
el plan completo".

**Fix:** `validateStepSemantics` ahora exige que toda obligación heredada
(`ctx.produces`) la cargue algún hijo, reusando el mismo mecanismo recoverable
(`graph_invalid` + retry con feedback). La obligación se propaga step a step
hasta una hoja real. Tests en
[`decomposer-recursive-nested-interface.test.ts`](../../tests/decomposer-recursive-nested-interface.test.ts).

### P3 · Referencias obsoletas a Gemini en el doc del decomposer

**Categoría:** doc engañoso (sin impacto funcional).
**Commit:** `4ef7f1c`.

[`03-decomposer.md`](../system/03-decomposer.md) describía un
"GeminiRecursiveDecomposer" que "invoca Gemini CLI", contradiciendo
`DECISIONS.md` (Gemini removido el 2026-06-16) y el código real: no existe
decomposer Gemini. La familia recursiva es `ClaudeCodeRecursiveDecomposer`
(default de planning), `RecursiveDecomposer` (SDK Anthropic) y
`CodexRecursiveDecomposer` (Codex CLI).

---

## 2. Candidatos secundarios analizados → NO eran defectos

- **Scheduler confía en `candidates` para readiness (cat. scheduling):** el
  frontier productivo es `executionFrontier`/`dependencySatisfied` en
  `orchestrator-graph`, que solo emite nodos sin resultado con dependencias
  satisfechas (incluye composites vía `integrationResults`). `routeFrontier`
  filtra la wave de vuelta contra `candidates`, así que `selectScopeAwareWave`
  solo puede estrechar, nunca agregar una tarea no-lista. Invariante cumplida.

- **`getTaskReadiness` con status almacenado obsoleto en composites (cat.
  state-machine):** confirmado por grep que `getTaskReadiness`/`getReadyLeaves`/
  `getLeafReadiness` no se usan en ningún path productivo (solo en
  `tests/domain.test.ts`). Trampa de API latente, no defecto vivo.

- **Reducer de `leafResults`/`integrationResults`:** `mergeById` reemplaza por
  `taskId` y `mergeIntegrationResults` usa tombstone-delete; un `retry_repair`
  exitoso reemplaza el resultado fallido (el `.find()` no ve duplicados
  obsoletos). Sin bug de gate-loop.

---

## 3. Pasada final — módulos revisados y veredicto

Revisados con intención de encontrar bugs; resultaron correctos y defensivos:

- **`scope/checker.ts` + `scope/glob.ts` (aislamiento):** deny-wins sobre
  `forbiddenPaths`, normalización de `\`, allow-list advisory. Correcto.
- **`worktree/manager.ts` (aislamiento):** paths derivados de `taskId`/`runId`
  validados (regex del decomposer + UUID), sin escape alcanzable; unlink de
  symlinks antes del `rm -rf` evita borrar el `node_modules` base en Windows.
- **`conflict-risk/src/index.ts` + `shared.pairKey` (scheduling):** `pairKey`
  ordena el par (`left <= right`), así que `findRiskPrediction` es simétrico —
  pares high/blocking no se pierden por orden.
- **`scheduling-audit-events.ts`:** la wave se persiste como evento required
  antes de despachar; razones de bloqueo consistentes con la matriz usada.
- **`world-reconcile.ts` (checkpoint/resume):** salud del checkpoint, base
  commit reachability, invalidaciones que filtran artefacto + resetean thread.
- **`result/recorder.ts` (D5/D6):** `git diff` como verdad, deny-wins,
  `empty_diff`, política reject/accept de commit inesperado.
- **`validation/runner.ts`:** síntesis de exit 124/126/127, normalización
  "binario no encontrado", guard `settled` contra doble-resolución.
- **`final-apply.ts` (integración):** degradación a patch export / `failed`
  sin crash; `resolveFinalCommit` prioriza el commit de integración raíz.
- **`mutation-guard.ts` / `audited-mutation.ts` (state-machine/concurrencia):**
  claim CAS dentro del lock de escritura por run; rollback explícito ante fallo
  de append del evento de status.

---

## 4. Observaciones latentes (no bloqueantes, sin corregir)

- **`ChildProcessValidationRunner` no protege `command.timeoutMs`:**
  `setTimeout(fn, command.timeoutMs)` mataría el proceso en el primer tick si
  `timeoutMs` fuera `undefined`/`0`. No es alcanzable en el path productivo
  (`ExecutionValidationCommandSchema.timeoutMs` tiene `.default(60_000)` y el
  decomposer lo setea explícito), por eso no se corrigió; quedaría como
  hardening defensivo si la clase se expusiera a contratos sin parsear.

- **Doble cómputo de `buildSchedulingSafetyContext`:** `selectAndPersistSchedulingWave`
  lo computa y `selectScopeAwareWave` lo recomputa internamente con el resultado
  ya mergeado. Es redundancia de performance, no incorrección (el merge es
  idempotente y conserva la severidad máxima).

---

## 5. Método

Lectura dirigida del código fuente productivo por categoría de riesgo, contra
las invariantes declaradas en `DECISIONS.md` y `docs/system/`. Las correcciones
siguieron TDD (rojo → verde → suite completa). No se modificó el changeset
PR-S1..S9 en curso, ajeno a esta auditoría.
