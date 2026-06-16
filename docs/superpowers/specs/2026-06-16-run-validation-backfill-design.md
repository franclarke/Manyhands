# Diseño: backfill determinista de validación run-level

- **Fecha:** 2026-06-16
- **Estado:** Propuesto (pendiente de revisión)
- **Alcance elegido:** A — backfill run-level + honestidad de estado
- **Origen:** hallazgo de la pasada E2E `dicey` (run `68a14702`), donde el run
  llegó a `completed` sin que el pipeline corriera un solo test.

---

## 1. Problema

El decomposer puede dejar las tareas sin comandos de validación. Cuando eso
pasa, el run llega a `completed` **sin validar nada**, aunque el repo tenga un
comando de test detectable.

Evidencia (run `dicey`): el `planningCritic` marcó `missing_validation_commands`
en las 5 hojas y **sugirió `npm run test`**, pero esa sugerencia nunca se
inyectó en el contrato. Los `runValidationCommands` del root quedaron vacíos, así
que el nodo `runValidation` no corrió ningún comando y el run completó sin
verificar. El código resultó correcto, pero `completed` no lo garantizaba.

### Causa raíz (dos huecos)

1. **No hay backfill.** El comando del proyecto se *detecta*
   ([`detectWorkspaceCommands`](../../../apps/web/src/lib/server/providers/command-detection.ts))
   y se *sugiere* ([`plan-critic.ts:110`](../../../apps/web/src/lib/plan-critic.ts)),
   pero nunca se *inyecta* en `root.contract.runValidationCommands`.
2. **El cero es silencioso.** En
   [`execution-host.ts:346`](../../../apps/web/src/lib/server/runs/execution-host.ts),
   `validateRun` devuelve `{ passed: true }` cuando no hay comandos. Cero
   validación ⇒ `passed: true` ⇒ `completed`, indistinguible de "tests verdes".

---

## 2. Objetivo y no-objetivos

**Objetivo:** que `completed` implique "el comando de test del proyecto pasó
sobre el deliverable integrado", de forma determinista y sin LLM; y cuando no
haya comando detectable, que el estado lo diga explícitamente
(`completed (unverified)`), nunca en silencio.

**No-objetivos (fuera de alcance, ver §7):**

- Backfill a nivel **leaf** (rompe por aislamiento: el worktree del leaf no tiene
  los hermanos integrados; el suite completo importaría stubs del skeleton).
- Convertir la falla run-level en **gate recuperable** (queda como `failed`, el
  comportamiento del ADR 0024). Es una extensión futura alineada con INV-5.
- Ronda de **repair con LLM** para que el decomposer agregue comandos.
- Instalar dependencias (`npm install`) en el worktree de validación.

---

## 3. Arquitectura existente que se reutiliza

La maquinaria de validación run-level ya está completa y wired:

- Contrato: `runValidationCommands: ExecutionValidationCommand[]`
  ([`contracts/src/index.ts:182`](../../../packages/contracts/src/index.ts)).
- Lectura: `collectRunValidationCommands(graph)` lee `root.contract.runValidationCommands`
  ([`execution-state.ts:60`](../../../apps/web/src/lib/server/runs/execution-state.ts),
  [`executor.ts:1170`](../../../packages/execution-core/src/run/executor.ts)).
- Ejecución: nodo terminal `runValidation`
  ([`execution-nodes.ts:649`](../../../packages/orchestrator-graph/src/nodes/execution-nodes.ts))
  → `validateRun` ([`execution-host.ts:332`](../../../apps/web/src/lib/server/runs/execution-host.ts))
  corre los comandos con `ChildProcessValidationRunner` sobre el worktree del root
  integrado; falla ⇒ run `failed` ([`execution-nodes.ts:666`](../../../packages/orchestrator-graph/src/nodes/execution-nodes.ts)).

**Nada de esto necesita cambiar.** Solo hay que (a) poblar el campo y (b) marcar
honestamente el caso sin comando.

---

## 4. Diseño

### Componente 1 — Backfill determinista (planning)

**Helper puro nuevo** (en `execution-state.ts`, junto a `collectRunValidationCommands`):

```ts
// Convierte un comando detectado ("npm run test") a ExecutionValidationCommand.
// Reusa el whitelist de seguridad de @manyhands/contracts antes de aceptarlo.
export function backfillRunValidationCommands(
  graph: TaskGraph,
  detected: DetectedCommands | undefined
): { graph: TaskGraph; backfilled?: ExecutionValidationCommand };
```

Reglas:

- Solo actúa si `root.contract.runValidationCommands` está **vacío/ausente**
  (nunca pisa comandos autoreados por el LLM).
- Toma el comando con prioridad `test → build → typecheck → lint` (misma que
  `suggestedValidationCommand`).
- Convierte el string `"<runner> run <script>"` a `{ command, args }` por split de
  whitespace; descarta si `validationCommandSafetyIssues` reporta problemas.
- `cwd: "worktree"` (el árbol integrado vive en el worktree del root, no en
  repo-root — coincide con `execution-core-run-executor.test.ts:37`).
- `timeoutMs: 120_000` (los suites run-level pueden ser más lentos que un leaf).

**Wiring:** en [`planning-host.ts runCriticsForRun`](../../../apps/web/src/lib/server/runs/planning-host.ts)
(línea ~408), donde ya se resuelve `detectedCommands`. Tras computar los critics,
aplicar el backfill y **persistir el grafo mutado en `run.planning.decomposition.graph`**
(que es lo que `resolveExecutionGraph` lee en ejecución). Emitir un finding
informativo `run_validation_backfilled` para que el plan-review muestre que la
validación va a correr.

### Componente 2 — Honestidad de estado (execution)

Cerrar el hueco silencioso de [`execution-host.ts:346`](../../../apps/web/src/lib/server/runs/execution-host.ts):

- Cuando `commands.length === 0`: seguir devolviendo `{ passed: true }` (no
  queremos fallar el run), **pero** persistir un marcador explícito
  `validationResult: { unverified: true }` en `record.execution`.
- Nuevo campo en `RunRecord`: `validation?: { status: "passed" | "failed" | "unverified"; command?: string; ranAt?: string }`,
  derivado en `settleExecutionOutcome`
  ([`execution-pipeline.ts:562`](../../../apps/web/src/lib/server/runs/execution-pipeline.ts)) a partir del `validationResult`.
- El presenter ([`presenter.ts`](../../../apps/web/src/lib/server/runs/presenter.ts))
  expone `validation`; la UI muestra `completed · verificado` vs
  `completed · sin verificar` (un pill, sin estado nuevo de lifecycle).

### Matriz de comportamiento

| Comando detectable | runValidation | Status final | Marca |
|---|---|---|---|
| Sí (test/build/...) | corre y pasa | `completed` | `verified` |
| Sí | corre y **falla** | `failed` | `failed` (output del runner) |
| No | no corre | `completed` | `unverified` |
| LLM ya autoreó comandos | corre los del LLM | según resultado | según resultado |

---

## 5. Archivos afectados

- `apps/web/src/lib/server/runs/execution-state.ts` — helper `backfillRunValidationCommands` + conversión string→comando.
- `apps/web/src/lib/server/runs/planning-host.ts` — invocar backfill y persistir el grafo en `run.planning`.
- `apps/web/src/lib/plan-critic.ts` — finding informativo `run_validation_backfilled` (opcional, recomendado).
- `apps/web/src/lib/server/runs/execution-host.ts` — marcar `validationResult.unverified` cuando no hay comandos.
- `apps/web/src/lib/server/runs/schema.ts` — campo `validation` en `RunRecordSchema`.
- `apps/web/src/lib/server/runs/execution-pipeline.ts` — derivar `validation` en `settleExecutionOutcome`.
- `apps/web/src/lib/server/runs/presenter.ts` (+ UI) — exponer/mostrar la marca.

---

## 6. Plan de tests (TDD)

Se implementa **test-first**: para cada unidad se escribe primero un test que
falla (rojo), se hace pasar con el cambio mínimo (verde) y se refactoriza. El
orden de implementación sigue el orden de esta lista; ninguna línea de
implementación se escribe antes de su test en rojo.

- **Unit (backfill):** grafo con root sin comandos + `detected.test` ⇒ inyecta
  `{command:"npm",args:["run","test"],cwd:"worktree"}`; no pisa comandos
  existentes; descarta comandos que violan el whitelist; sin `detected` ⇒ no-op.
- **Unit (honestidad):** `validateRun` con cero comandos ⇒ `passed:true` +
  `validationResult.unverified`; con comando que pasa ⇒ `verified`; con comando
  que falla ⇒ `failed`.
- **Integración (web):** crear run sobre repo con `test` script, decomposer sin
  comandos ⇒ tras planning el root tiene `runValidationCommands`; ⇒ tras
  ejecución el run es `completed` solo si el suite pasa.
- **Regresión E2E (manual):** re-correr `dicey` y confirmar que ahora el pipeline
  corre `npm run test` y el `completed` lo refleja.

---

## 7. Futuro / extensiones (no en este spec)

- **Gate recuperable** en falla run-level (retry/accept/abort, INV-5) en vez de
  `failed` duro — alcance B.
- **Backfill parent-level** para composites intermedios.
- **leafValidationCommands scope-aware** vía repair LLM — alcance C.
- **`npm install`** en el worktree de validación para repos con dependencias.

---

## 8. Riesgos

- **Repos con dependencias no instaladas:** `npm run test` fallaría por falta de
  `node_modules`. Mitigación: fuera de alcance; documentar que hoy aplica a
  proyectos sin install o con deps ya provisionadas. Considerar detección futura.
- **Comando detectado no apto como validación** (ej. un `test` que es watch):
  poco común; el whitelist y el timeout acotan el daño (falla por timeout → run
  `failed` accionable, no cuelga).
