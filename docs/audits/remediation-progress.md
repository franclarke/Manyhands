# Remediation progress

Registro de implementación de las remediation units surgidas de las auditorías
de Fase 2 ([2A](phase-2a-configuration-capability-integrity.md),
[2B](phase-2b-durability-lifecycle-recovery.md)).

## U2A-2 — StageSelection independiente por etapa con effort y resolver único

- **Estado:** complete (2026-07-13).
- **Resuelve F4** (effort único run-level) de la Fase 2A. Base de U2A-3.
- **Baseline:** `main` @ `deb370a1` con RU1, RU2 y U2A-1 presentes y respetados
  (U2A-2 no revierte ninguno). Depende de U2A-1 (registry enriquecido + `EffortLevel`).

### Schema canónico

Nuevo tipo en `@manyhands/shared` (client-safe, superset de `ExecutorSelection`):

```ts
export interface StageSelection { executorId: ExecutorId; model: string; effort?: EffortLevel; }
```

`RunRecord` y `RunCreateRequest` ganan tres campos canónicos **autoritativos**:
`planningSelection`, `executionSelection`, `repairSelection`
(`StageSelectionSchema = { executorId, model, effort? }`, effort vía
`ReasoningEffortSchema` de U2A-1). Los campos legacy
(`model`, `planningModel`, `planningExecutorId`, `defaultExecutionSelection`,
`defaultRepairSelection`, `executionConfig.reasoningEffort`) se conservan como
**mirror (dual-write)**: runs nuevos persisten ambos; runs viejos se leen sin
reescritura. Ningún campo legacy fue eliminado.

### Precedencia (única, en `executor-selection.ts`)

Por etapa, el resolver único aplica:

```text
1. StageSelection canónica persistida (run.{planning,execution,repair}Selection)
2. campos legacy por etapa (planningExecutorId/planningModel; defaultExecutionSelection; defaultRepairSelection)
3. fallback de etapa (execution → planning; repair → execution)
4. string legacy `model` → su executor registrado
5. string desconocido → executor DEFAULT documentado, model preservado verbatim
6. contradicción canónico ↔ legacy → RunConfigurationError (→ 400)
```

Effort, por etapa: se aplica **solo** a modelos que declaran effort (nunca a
Claude); toma `StageSelection.effort` canónico, si no el `reasoningEffort` legacy
global, y solo si el valor pertenece a los `efforts` del modelo (un effort legacy
incompatible se descarta, nunca se coacciona). Ya no existe un effort conceptual
compartido: planning/execution/repair resuelven el suyo.

### Compatibilidad legacy — matriz de migración

| Caso histórico | Resolución |
|---|---|
| Claude/Claude sin effort | ambas sin effort |
| Codex/Codex, `reasoningEffort` global | el global se pliega a planning+execution+repair (todas Codex) |
| Codex planning / Claude execution | planning con effort; execution sin effort (nunca copiado a Claude) |
| Claude planning / Codex execution | execution con el global; planning sin effort |
| string legacy conocido (`gpt-5.5`) | → codex/gpt-5.5 |
| string legacy desconocido/retirado (`claude-opus-4.7`, `gemini-2.5-pro`) | → executor DEFAULT + string preservado (legible/ejecutable); **runs nuevos** con ese string se rechazan en el create (400) |
| modelo eliminado del registry con executor explícito | executor preservado, model preservado |
| canónico + legacy contradictorios | `RunConfigurationError` → 400 |

**Regla del `reasoningEffort` único legacy:** se interpreta como el effort global
histórico y se aplica por etapa **solo** donde el modelo lo soporta (semántica
histórica idéntica: Codex lo usaba, Claude lo ignoraba). No se copia a modelos
sin effort ni se inventan efforts. Sin cambios silenciosos en runs históricos.

**Lectura display-safe:** proyección y event-log usan variantes
`*ForDisplay` (mismo módulo) que degradan con gracia si un run histórico ya no
resuelve (executor/model retirado), preservando el hint persistido — así los
históricos siguen siendo **legibles** mientras los caminos de ejecución usan los
resolvers estrictos (que fallan explícito ante contradicción).

### Call sites migrados

1. **run creation** (`api/runs/route.ts`): acepta canónico o legacy, valida
   capability + effort por etapa (rechazo 400: effort en modelo sin soporte,
   effort no permitido, contradicción, modelo no registrado), inyecta el default
   de effort del registry, persiste canónico + mirror.
2. **persistence/schema** (`schema.ts`): campos canónicos + `StageSelectionSchema`.
3. **presenter/API** (`presenter.ts`, `api-types.ts`): expone las 3 selecciones canónicas.
4. **planning pipeline** (`planning-host.ts`): usa `planningSelection(run)` (executor+model+effort).
5. **execution pipeline** (`execution-host.ts`): `configForStage` inyecta el effort de la etapa por-llamada (leaf, repair, integración).
6. **repair/grounding/titler**: `repairSelection`/`groundingSelection`/`titlerSelection` retornan `StageSelection` completa.
7. **fork** (`fork/route.ts`): copia las 3 selecciones canónicas.
8. **serialize/export**: serializan el RunRecord completo → los campos canónicos viajan solos.
9. **resume/restart**: releen el mismo RunRecord → resolver estable (persisted == effective).
10. **UI** (`command-center-shell`, `effort-control`, `models.ts`): controles de
    effort independientes para planning y execution; envía `StageSelection` por
    etapa; `stageSelectionForSubmit` adjunta effort solo si el modelo lo declara
    (limpia efforts stale/incompatibles al cambiar de modelo).

`regen`/`replan` no se rediseñan (U2A-3): siguen resolviendo por campos, pero el
resolver único es ahora la autoridad para los caminos migrados.

### Tests (TDD rojo→verde)

- `tests/stage-selection-resolver.test.ts` (8): canónico verbatim + effort por
  etapa; plegado del global legacy; nunca copia effort a Claude; legibilidad de
  modelo retirado (string preservado); contradicción → throw.
- `tests/run-create-stage-selection.test.ts` (8): efforts independientes
  (Codex xhigh planning + Codex medium execution); Codex→Claude, Claude→Codex;
  effort en Claude → 400; effort no permitido → 400; planning sin capability → 400;
  modelo desconocido → 400; contradicción → 400.
- `tests/stage-selection-ui.test.ts` (4): `stageSelectionForSubmit` adjunta/omite
  effort correctamente; planning y execution independientes; descarta stale.
- `tests/stage-selection-lifecycle.test.ts` (2): persisted == effective; fork
  preserva las selecciones canónicas.
- Regresión (item 14): `executor-selection` (7), `run-create-route` (5),
  `run-restart-target` (6), `effort-*`/`model-registry`/`executor-registry`,
  proyección/event-log/resume/world-reconcile/repository ⇒ verdes.
- **Suite completa: 1530/1536 pass** (3 skip preexistentes; los 3 fallos
  restantes — `checkpointer` 500-writes, `repo-lock-atomic` N-contenders,
  `run-runner-provisioning` wall-clock — son **flakiness de concurrencia/timing
  pre-existente**: pasan aislados, no tocan selección/effort).
- Typecheck: shared / execution-core / web ⇒ exit 0; build de shared ⇒ exit 0.

### Compatibilidad residual / deuda para U2A-3

- Campos legacy siguen persistidos como mirror (dual-write); su retiro es una
  release futura, no U2A-2.
- `regen`/`replan` aún no usan el `PlanningInvocationService` (U2A-3); F1/F5/F6
  siguen abiertos.
- `execution-config-defaults.withDefaultReasoningEffort` se conserva para la
  inyección legacy en planning-host; su reemplazo total por
  `defaultEffortForSelection` es parte de U2A-3.
- Discovery/availability runtime del modelo sigue fuera de alcance (unidad posterior).

## U2A-1 — Registry enriquecido con efforts por modelo y `EffortLevel` único

- **Estado:** complete (2026-07-13).
- **Resuelve la causa raíz RC-B de la Fase 2A** (el registry no modelaba efforts,
  así que el conocimiento vivía duplicado). Base de U2A-2 y U2A-3.
- **Baseline:** `main` @ `deb370a1` con los diffs de RU1 y RU2 presentes y
  respetados. U2A-1 no toca ningún archivo de RU1/RU2 (sin solape).

### Revalidación de fuentes (S1-S8) y findings

Working tree = fuente de verdad. Confirmadas antes de tocar nada, y su estado
tras U2A-1:

| Fuente | Antes | Después |
|---|---|---|
| S1 `packages/shared/src/executor-registry.ts` | registry sin efforts | **fuente canónica** de `EffortLevel`, `EFFORT_LEVELS` y `efforts`/`defaultEffort` por modelo |
| S2 `models.ts` `EFFORT_CAPABLE_MODEL_IDS` | set hardcodeado por familia | **eliminado**; `supportsEffort`/`efforts`/`defaultEffort` derivados del descriptor |
| S3 `execution-core/types.ts` (x2 `z.enum`) | dos enums literales | **`ReasoningEffortSchema` compartido** (derivado de `EFFORT_LEVELS`) |
| S4 `execution-core/routing/policy.ts` lanes | `gpt-5-codex` no registrado | **sin cambios** (legacy routing, U2A-6) + **test tripwire** que fija la divergencia conocida |
| S5 `decomposer-policy.ts` | union inline | **`EffortLevel`** importado de shared |
| S6 `execution-config-defaults.ts` regla "codex soporta effort" | `executorId !== "codex-cli"` | sin cambios de comportamiento (fuera del alcance de tipos; su conocimiento ahora es verificable contra el registry — deuda menor para U2A-2) |
| S7 `effort-control.client.tsx` (`low\|medium\|high`, 3 niveles) | union propia divergente | **eliminada**; importa `EffortLevel` de shared; slider dinámico según `levels` del modelo |
| S8 `api-types.ts` union inline | `low\|medium\|high\|xhigh` | **`EffortLevel`** de shared |
| (extra) `decomposer/.../codex-recursive-decomposer.ts` `CodexReasoningEffort` | union propia | alias fino `= EffortLevel` (mismo tipo canónico) |
| (extra) `execution-core/integration/agent.ts:62` | union inline | **`EffortLevel`** |

- **F7 (dominio de efforts fracturado en 5+ copias)**: resuelto. Grep final abajo.
- **F9 base (effort no validable contra el modelo)**: habilitado —
  `efforts`/`defaultEffort` por modelo ya viven en el registry; la *validación*
  del request contra el modelo es U2A-2 (no incluida aquí).
- **`xhigh` inalcanzable (UI)**: resuelto — el UI deriva los niveles del modelo,
  y los modelos Codex declaran `["low","medium","high","xhigh"]`.

### Fuente canónica final

`@manyhands/shared` (client-safe, sin deps de runtime salvo zod en `index.ts`):

```ts
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export interface ExecutorModelDescriptor {
  id; label; capabilities; usageSource;
  efforts: readonly EffortLevel[] | null;   // null (nunca []) = sin control
  defaultEffort?: EffortLevel;              // ⊂ efforts; ausente si efforts=null
}
// helpers: isEffortLevel, effortsForSelection, supportsEffortForSelection,
//          defaultEffortForSelection, collectExecutorRegistryErrors,
//          assertValidExecutorRegistry (self-check al importar)
// index.ts: ReasoningEffortSchema = z.enum(EFFORT_LEVELS)
```

`executor-registry.ts` se mantiene libre de dependencias (lo consume la UI); el
único zod vive en `index.ts`.

### Matriz modelo → efforts

| Executor | Modelo | `efforts` | `defaultEffort` |
|---|---|---|---|
| claude-code-cli | haiku, sonnet, opus | `null` | — |
| codex-cli | gpt-5.5, gpt-5.4, gpt-5.4-mini | `["low","medium","high","xhigh"]` | `medium` |
| opencode-cli (disabled) | opencode-default | `null` | — |

Los efforts de Codex reflejan lo YA declarado en el código (enum de
`ExecutionConfigSchema`, `CodexReasoningEffort` del decomposer, y el flag
`model_reasoning_effort` del perfil), no una suposición nueva. El default
`medium` refleja `withDefaultReasoningEffort`.

### Compatibilidad

- **Schema persistido de RunRecord**: sin cambios. `executionConfig.reasoningEffort`
  sigue siendo el mismo enum de 4 valores; solo cambia su *fuente* (ahora
  `ReasoningEffortSchema` derivado de `EFFORT_LEVELS`). Runs persistidos cargan
  sin migración.
- **`StageSelection`**: no introducido (U2A-2).
- **Capability probing runtime**: no introducido. El registry sigue siendo la
  fuente *declarativa*; disponibilidad de CLI/modelo son conceptos separados y
  no simulados aquí.
- **Distinción declared vs available**: preservada — U2A-1 solo endurece lo
  declarado; `assertValidExecutorRegistry` valida consistencia interna, nunca
  presencia de CLI ni disponibilidad de modelo para la cuenta.

### Tests

- **`tests/effort-registry.test.ts`** (14, TDD rojo→verde): `EFFORT_LEVELS`
  canónico; `isEffortLevel`; Codex declara los 4 efforts + default `medium`;
  Claude/opencode `efforts: null` sin default; helpers de selección; validador
  estático rechaza default fuera de efforts, default sobre `efforts:null`,
  `efforts:[]`, ids duplicados, `defaultModel` ausente, capability desconocida,
  effort fuera del set canónico; registry canónico → `[]` errores; **lanes
  legacy** divergen solo por `codex-cli/gpt-5-codex` (tripwire).
- **`tests/effort-consumers.test.ts`** (5, TDD): `MODEL_OPTIONS` deriva
  `supportsEffort`/`efforts`/`defaultEffort` del registry; `xhigh` alcanzable
  para la UI vía `effortLevelsForSelection`; Claude sin control; **tripwire de
  definición única**: ningún `.ts/.tsx` fuera de `executor-registry.ts` declara
  la union de 4 niveles ni `type EffortLevel = …`.
- Regresión verde: `model-registry` (4), `execution-core-executor-registry` (4),
  `run-create-route` (5), `decomposer-codex-recursive` (5),
  `execution-core-types` (43), `execution-core-codex-cli` (7),
  `execution-core-run-executor` (32). **Total corrido: 119/119 pass.**
- Verificación: `pnpm -F @manyhands/shared typecheck` exit 0; build de shared
  exit 0; `pnpm -F @manyhands/execution-core typecheck` exit 0;
  `pnpm web:typecheck` (build de packages + tsc) exit 0.

### Grep final documentado (copias restantes del dominio de effort)

```
A) union de 4 niveles en src (excl. dist)  → 1: executor-registry.ts:17 (canónica)
B) 'type EffortLevel ='                     → 1: executor-registry.ts:18 (canónica)
C) EFFORT_CAPABLE_MODEL_IDS                  → 0 (eliminado)
```

Definición canónica: **exactamente una**. Condición de finalización cumplida.

### Duplicaciones residuales justificadas

- `type CodexReasoningEffort = EffortLevel` (decomposer): **alias fino** al tipo
  canónico, no una definición paralela (no re-lista literales). Se conserva como
  vocabulario local del adaptador Codex; se puede inlinar en una limpieza futura.
- `execution-config-defaults.ts` sigue infiriendo soporte de effort por
  `executorId === "codex-cli"` (comportamiento, no tipo). No es una copia del
  *dominio de niveles*; su reemplazo por `supportsEffortForSelection` es parte
  de la validación de request de **U2A-2**.

### Deuda restante para U2A-2 / U2A-3

- **U2A-2**: validar `reasoningEffort` del request contra `efforts` del modelo
  (cierra F9); reemplazar `withDefaultReasoningEffort` (S6) por
  `defaultEffortForSelection`; introducir `StageSelection {executorId, model,
  effort}` con effort por etapa (cierra F4); effort de planning en la UI.
- **U2A-3**: `PlanningInvocationService` único (regen/replan/planning) que
  consuma la selección canónica (cierra F1/F5/F6).
- **U2A-6**: decisión sobre complexity routing y limpieza de las lanes
  `DEFAULT_TIER_ROUTES` (hoy fijadas por el tripwire).

## RU2 — El sweep de un run stale invalida su operation lease

- **Estado:** complete (2026-07-13).
- **Resuelve:** F2B-2 y la violación parcial del invariante I3 de la Fase 2B.
- **Baseline:** `main` @ `deb370a1` con el diff de RU1 presente y respetado
  (RU2 no lo toca: solo [interrupted.ts](../../apps/web/src/lib/server/runs/interrupted.ts)
  y su test nuevo).

### Protocolo anterior

`sweepRunIfStale` juzgaba staleness sobre el **snapshot del caller**, construía
`next = { ...run, status: "interrupted", ... }` (spread que **preservaba**
`activeOperation` y `mutationFence`) y lo persistía vía
`saveRunWithRequiredStatusEvent` (CAS solo por `version` del snapshot).
Consecuencias: (a) un worker congelado que despertaba tras el sweep seguía
pasando el fence (`updateRunForOperation(oldLease)` escribía sobre un run ya
`interrupted` hasta el takeover de un restart); (b) un heartbeat concurrente
hacía fallar el CAS con `RunMutationConflictError` **sin catch**, propagando el
error al camino de lectura (GET /api/runs); (c) dos sweeps concurrentes: uno
lanzaba en vez de resolver al estado del ganador.

### Protocolo nuevo

Una única mutación CAS (`claimRunMutation` con expectativa
`status ∈ {generating,running,paused}`) cuyo mutator, **dentro del mutex de
filesystem por run**: (1) re-juzga staleness contra el record FRESCO
(heartbeat/resume que ganó el lock ⇒ sentinel `SweepNotApplicable` ⇒ el sweep
devuelve el record fresco sin transición); (2) aplica `invalidateRunOperation`
(revoca `activeOperation` y avanza `mutationFence = max(fence, token)+1`,
monotónico también en el store); (3) transiciona a `interrupted` en el mismo
write. Después, `appendStatusEventOrRollback` emite el `run.status.changed`
requerido con rollback compensatorio — exactamente una vez por transición
efectiva. Un sweep competidor pierde la expectativa de status y devuelve el
record del ganador (conflicto atrapado ⇒ `get()` fresco).

### Ventana de carrera eliminada

`read-stale → invalidate → otro writer → set interrupted` es imposible: juicio
de staleness, revocación de lease y cambio de status son **un solo write
atómico** bajo el lock cross-process. No existe ningún instante en que
`status === "interrupted"` con la lease anterior habilitada. El heartbeat
(`renewRunOperation`, fenced) que llega antes del claim veta el sweep; el que
llega después falla el fence y se apaga solo (comportamiento preexistente de
`startHeartbeat`).

### Pruebas

- Nuevo [tests/sweep-lease-invalidation.test.ts](../../tests/sweep-lease-invalidation.test.ts)
  (6, TDD: 4 rojos primero reproduciendo F2B-2 y los conflictos sin catch):
  write con lease pre-sweep ⇒ `RunMutationConflictError`; record barrido sin
  `activeOperation` y fence estrictamente mayor; heartbeat concurrente
  (snapshot stale, disco fresco) ⇒ no se barre y la lease sigue válida; dos
  sweeps concurrentes ⇒ una sola transición y un solo evento `interrupted`;
  sweep repetido idempotente (misma version, un evento); takeover posterior
  adquiere lease válida con fence mayor y la vieja sigue fenced.
- Regresión: `run-interrupted-sweep` (3), `run-operation-lease`,
  `mutation-concurrency`, `resume-route-concurrency`,
  `run-lifecycle-interrupted`, `cancel-terminal`, `cancel-route`,
  `run-restart-target`, `run-runner` + RU1 (`cancel-after-restart`,
  `durable-process-kill`, `process-evidence-journal`) ⇒ **77/77 pass**.
- `pnpm web:typecheck` exit 0.

### Riesgos residuales

- `isRunnerActive` sigue siendo process-local: un runner vivo en OTRO proceso
  Next no veta el sweep por esa vía, pero sus heartbeats en disco sí (y ahora,
  si igual fuera barrido, queda fenced al instante — que es exactamente lo que
  RU2 garantiza; antes seguía escribiendo).
- El sweep de runs `created` huérfanos (F2B-9) y el re-cancel de `cancelling`
  post-crash siguen fuera de alcance (RU3).
- Writes sin lease (`updateRunForOperation(undefined)`, `repo.update` directo)
  siguen siendo last-wins por diseño; RU2 no los endurece (I3 queda cerrado
  para el camino con lease, que era la violación documentada).

### Relación con F2B-2 e I3

F2B-2 ("el sweep no invalida la operation lease") queda eliminado en su causa
raíz: el spread que preservaba `activeOperation` fue reemplazado por
`invalidateRunOperation` dentro del mismo CAS. El invariante I3 ("un proceso
stale no puede sobrescribir estado más nuevo") pasa de *parcialmente violado*
a *confirmado para todos los writers con lease*: tras el sweep,
`updateRunForOperation(oldLease)` falla determinísticamente antes de cualquier
takeover (test 1), y el fence nunca retrocede (monotonía verificada en test 2/6).

## RU1 — Kill durable de procesos huérfanos post-restart

- **Estado:** complete (2026-07-13).
- **Resuelve:** F2B-1 (allDead vacuo con registry in-memory) y R2B-4
  (verificación de kill solo del PID raíz) de la Fase 2B.

### Baseline

- Branch `main`, HEAD `deb370a14d6dca2bf63a50c4564d8d2fa8fa160a`.
- Sin diff productivo preexistente (`git diff --stat HEAD -- apps packages` vacío
  al comenzar); cambios locales solo de docs (idénticos a Fases 1/2A/2B).
- F2B-1 revalidada contra el código: `liveProcesses` era un `Map` a nivel de
  módulo ([live-process-registry.ts:37](../../packages/execution-core/src/executor/live-process-registry.ts));
  `killOwnedProcessTrees` sobre registry vacío devolvía `verifications: []` y
  `allDead: true`; `TaskAttempt.process` existía en el schema pero nunca se
  escribía.

### Diseño elegido

**Sidecar durable por run + sink en el registry + kill combinado verificado:**

1. `JsonRunProcessJournal` (`.manyhands/runs/processes/<runId>.json`): un
   registro por proceso supervisado con `pid`, `label`, `command` (solo el
   ejecutable, nunca argv completo), `attemptId`/`operationId` cuando existen,
   `registeredAt`, y cierre por `exitedAt` (salida normal) o
   `closed{at,reason}` (killed / not_running / pid_recycled / no_pid).
   Mismo patrón de atomicidad que el resto de stores (tmp+rename, write chain
   in-memory, mutex fs `mkdir` con evicción stale).
2. `ProcessEvidenceSink` en execution-core: `registerLiveProcess` /
   `unregisterLiveProcess` (el choke point único de TODA la supervisión:
   executores, decomposers, git, validación, terminales) espejan cada evento al
   sink instalado por la web (`installProcessEvidenceSink()`, instalado al
   cargar `process-supervision.ts` y `terminal-sessions.ts`). Fire-and-forget:
   la evidencia nunca bloquea un spawn.
3. `killRunProcessesVerified(runId)` (nuevo default de `cancelRun`):
   - mata y verifica los handles del registry vivo (comportamiento previo);
   - carga la evidencia durable abierta y la deduplica contra lo ya matado;
   - toma UN snapshot de la tabla de procesos del OS **antes** de matar
     (`snapshotProcessTable`: PowerShell CIM en Windows — `wmic` ya no existe
     en Windows 11 actual —, `ps` en POSIX), que provee identidad (creation
     time) y árbol (pid/ppid);
   - **verificación de identidad**: un pid cuyo creation time es posterior a
     `registeredAt` (+5s de tolerancia) fue reciclado → se **rehúsa el kill**
     y se cierra como `pid_recycled` (el proceso original está probadamente
     muerto); un pid vivo cuya identidad no puede confirmarse (snapshot
     fallido o sin creation time) se reporta `unverified`, **no se mata** y
     **bloquea `allDead`**;
   - kill del árbol (`killPidTree`: taskkill /t en Windows, process-group en
     POSIX) con escalada única, y verificación de muerte de **raíz y
     descendientes** (también para las raíces del registry vivo — cierra R2B-4);
   - solo la evidencia verificada muerta se cierra; `allDead` = todas las
     verificaciones en `dead|escalated`.
4. Nuevo outcome `unverified` en `KillVerification`; `cancel-service` y la
   ruta de cancel lo cuentan como superviviente (el run queda en `cancelling`,
   202, reintentable) — sin certeza falsa y **sin nuevos estados de lifecycle**.

### Alternativas descartadas

- **Extender `TaskAttempt.process`**: los attempts solo cubren invocaciones de
  executor por nodo; cancel también debe matar decomposers de planning, git
  helpers, validación y terminales. El journal referencia `attemptId` cuando
  existe, así que la correlación no se pierde.
- **Identidad por captura activa al spawn** (consultar el OS en cada registro):
  más frágil (carrera spawn/consulta, costo por proceso git corto). La
  comparación creation-time ≤ registeredAt en el momento del kill da la misma
  garantía anti-recycling con una sola consulta por cancel.
- **Windows Job Objects**: más fuerte pero requiere addon nativo; fuera del
  alcance mínimo de RU1 (queda como endurecimiento futuro).

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `packages/execution-core/src/executor/live-process-registry.ts` | sink de evidencia (register/exit), `listLiveProcessMetas`, outcome `unverified` |
| `packages/execution-core/src/executor/process-inspector.ts` | **nuevo**: snapshot OS (win/posix), `descendantsOf`, `killPidTree` |
| `packages/execution-core/src/index.ts` | export del inspector |
| `apps/web/src/lib/server/runs/process-evidence.ts` | **nuevo**: journal + sink + `killRunProcessesVerified` |
| `apps/web/src/lib/server/runs/runs-directory.ts` | **nuevo**: `resolveRunsDirectory` extraído a módulo hoja (rompe el ciclo process-evidence→repository→schema→repo-provisioner→process-supervision) |
| `apps/web/src/lib/server/runs/repository.ts` | re-exporta `resolveRunsDirectory` (1+/8−; el resto del diff es churn CR/LF sin cambio semántico) |
| `apps/web/src/lib/server/runs/cancel-service.ts` | default kill → `killRunProcessesVerified`; `unverified` cuenta como superviviente en el payload |
| `apps/web/src/lib/server/runs/process-supervision.ts` | instala el sink al cargar |
| `apps/web/src/lib/server/runs/terminal-sessions.ts` | instala el sink al cargar |
| `apps/web/src/app/api/runs/[id]/cancel/route.ts` | `unverified` en survivors de la respuesta |

### Tests agregados (TDD: rojos primero, verdes después)

- `tests/process-evidence-journal.test.ts` (5): ciclo start/exit/close,
  idempotencia de close, compatibilidad histórica (sin journal ⇒ sin abiertos),
  exit de pid desconocido no-op, cableado registry→journal vía sink.
- `tests/durable-process-kill.test.ts` (6): registry vacío + evidencia durable
  viva ⇒ se mata (no allDead vacuo); pid reciclado ⇒ rehúsa kill y cierra
  `pid_recycled`; identidad no verificable ⇒ `unverified`, sin kill, sin
  allDead; pid ya muerto ⇒ idempotente entre cancels; salida normal ⇒ sin
  trabajo; **nieto superviviente bloquea allDead** (árbol verificado).
- `tests/cancel-after-restart.test.ts` (3, procesos Node REALES): reproducción
  end-to-end de F2B-1 (hijo real + journal, registry vacío simulando restart ⇒
  `cancelRun` lo encuentra, verifica y mata; `interrupted` solo tras
  verificación); segundo cancel ⇒ 409 determinístico sin re-kill; **kill del
  árbol real incluyendo el nieto**.

### Resultados

- RU1: 14/14 pass (los 3 archivos fallaron primero por la funcionalidad
  ausente — RED verificado — y pasaron tras la implementación).
- Regresión: `cancel-route`, `cancel-terminal`, `process-supervisor`,
  `execution-core-kill-verify`, `task-attempt-journal`,
  `run-lifecycle-interrupted`, `run-interrupted-sweep`,
  `resume-route-concurrency`, `run-operation-lease`, `mutation-concurrency`
  ⇒ 69 pass / 1 skip (preexistente).
- Dependientes de repository: `run-record-repository`,
  `durable-run-event-log`, `world-reconcile-web`, `archive-purge` ⇒ incluidos
  en la corrida final 47/47 pass.
- Typecheck: `pnpm -F @manyhands/execution-core typecheck` exit 0;
  `pnpm web:typecheck` (build de packages + tsc) exit 0. El `pnpm typecheck`
  de raíz ya estaba rojo en HEAD por fixtures de ~40 tests sin `planRevision`
  (preexistente, sin relación con RU1; verificado con diff vacío sobre esos
  tests); mi fixture nuevo sí incluye `planRevision`.

### Invariantes verificadas

1–11 del mandato: registry vacío ya no implica allDead (tests 1-2); evidencia
durable al conocer identidad y cerrada en salida normal (sink tests); cancel
considera vivo+durable con dedupe; identidad verificada antes de matar
(creation time, no solo pid); árbol verificado (raíz+descendientes, live y
durable); incertidumbre ⇒ `unverified` sin certeza falsa; muerto ⇒ idempotente;
cancel repetido no re-mata (409/evidencia cerrada); Windows productivo cubierto
(PowerShell CIM + taskkill /t; suite corrida en Windows 11). Invariante 12:
leases/journals/repo-locks intactos (regresión verde; RU1 no toca fencing).

### Riesgos residuales

- Procesos huérfanos de **replan/regen** siguen sin supervisar (F2B-10):
  no dejan evidencia porque nunca pasan por el registry — se resuelve en
  RU8/U2A-3, no aquí.
- El snapshot OS es best-effort: si PowerShell/ps fallan, el cancel degrada a
  `unverified` para pids vivos (correcto pero requiere reintento/intervención).
- Ventana mínima: un proceso que muere entre el snapshot y el kill se reporta
  `dead` por la verificación posterior (benigno).
- El sink es fire-and-forget: un crash inmediatamente después del spawn puede
  perder la evidencia de ese proceso (ventana de milisegundos; el executor
  también muere con el crash del padre solo si comparte job/grupo — mitigación
  futura: Job Objects).
- `pnpm typecheck` de raíz sigue rojo por el problema preexistente de
  `planRevision` en fixtures (candidato a fix mecánico separado).

### Relación con F2B-1 y R2B-4

- **F2B-1**: la causa raíz ("registry in-memory sin persistencia; allDead
  cuantifica solo lo registrado") queda eliminada: la cancelación consulta
  evidencia durable que sobrevive al restart y verifica identidad antes de
  actuar; el escenario de reproducción de la auditoría es ahora el test
  `cancel-after-restart` (verde).
- **R2B-4**: la verificación ya no es solo del PID raíz: el snapshot pid/ppid
  enumera descendientes antes del kill y todos se verifican muertos (test del
  nieto real + test de árbol con adapter).
