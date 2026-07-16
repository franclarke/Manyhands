# Fase 2A — Configuration and Capability Integrity Audit (ManyHands)

> Estado: **complete** (criterios de finalización en §25; incertidumbre residual explícita).
> Ledger: [`phase-2a-configuration-ledger.json`](phase-2a-configuration-ledger.json).
> Baseline: `main` @ `deb370a14d6dca2bf63a50c4564d8d2fa8fa160a` — idéntico al de Fase 1; sin cambios productivos.

## 1. Executive summary

La configuración de agentes/modelos/effort es **declarativa y estática**: la única
"detección" real es binario (+`--version`) y credenciales. Los modelos y efforts
nunca se descubren ni se validan contra el CLI; cualquier string de modelo
registrado (o inyectado por caminos legacy) llega al CLI sin verificación.

El modelo de selección por etapa (planning/execution/repair) existe y funciona en
el camino principal (create → planning → leaves → repair), con validación por
capability al crear y re-validación de CLI+credenciales en el preflight de
ejecución. Pero la resolución de selección está **fragmentada**: `executor-selection.ts`
es el resolver canónico y solo lo usan los pipelines; regen no lo usa (F1
confirmado y ampliado), replan lo usa a medias (pierde effort y supervisión de
procesos), y el guard anti-mock está triplicado con semánticas distintas (F5
confirmado y ampliado).

La causa raíz común de F1/F5 y de las divergencias de replan no son bugs
puntuales: **no existe un servicio único de invocación de planning**; hay tres
entrypoints que re-implementan (selección → guard → harness) por copia. La causa
raíz de F4 y R5 es que **el registry no modela effort ni defaults por modelo**,
así que ese conocimiento vive duplicado en la UI, en `execution-config-defaults`
y en el enum de `types.ts`.

Hallazgos nuevos: la UI solo ofrece 3 niveles de effort (`low|medium|high`)
mientras el backend persiste 4 (`xhigh` inalcanzable desde la UI); la
normalización legacy puede asignar silenciosamente un modelo desconocido a
`claude-code-cli`; y R4 queda **parcialmente corregido**: el preflight de
ejecución sí re-valida CLI y auth en start/resume/restart/manual-node (falla
temprano y accionable), pero planning no tiene preflight equivalente y la
disponibilidad de *modelo* no se valida nunca.

## 2. Baseline y cambios desde Fase 1

- 2026-07-13T00:40:22-03:00 · `main` @ `deb370a1` · `git diff --stat HEAD -- apps packages` vacío.
- Mismos cambios locales de docs que en Fase 1 + `docs/audits/` (entregables de Fase 1).
- Ninguna conclusión de Fase 1 queda obsoleta por cambios de código; las correcciones de §19 provienen de evidencia nueva, no de drift.

## 3. Canonical product intent

(Según el encargo.) Detección de CLIs al iniciar; modelos y capabilities por CLI;
efforts por modelo; UI solo con combinaciones utilizables; selecciones
independientes por etapa incluyendo effort; identidad presentado=validado=persistido=ejecutado;
fallo temprano accionable ante configuraciones inválidas o no disponibles;
regen/replan/resume/restart/recovery conservan la semántica original; cero
fallbacks silenciosos.

## 4. Current configuration model

- **Selección** = `{executorId, model}` (`ExecutorSelection`, shared). El effort NO
  forma parte de la selección: vive aparte en `executionConfig.reasoningEffort`.
- **Etapas persistidas** en `RunRecord` (schema.ts:308-312): `model` (execution,
  legacy-canónico), `planningModel?`, `planningExecutorId?`,
  `defaultExecutionSelection?`, `defaultRepairSelection?`.
- **Resolver canónico**: `executor-selection.ts` — `planningSelection`,
  `executionSelection` (= default ?? planning), `repairSelection` (= default ??
  execution), `groundingSelection` (= execution), `titlerSelection` (= planning).
- **Overrides por nodo**: `node.metadata.executorSelection|executorOverride`
  (PATCH `/nodes/[taskId]`, validado contra el registry con enabled, route.ts:170-178),
  resueltos en runtime por `resolveExecutorSelection` (executor.ts:144-162) con
  jerarquía explícito → router → default, y bloqueados por preflight cuando
  `routing === "fixed"` (preflight.ts:231-237).

## 5. Capability sources of truth

| # | Fuente | Contenido | Rol |
|---|---|---|---|
| S1 | `packages/shared/src/executor-registry.ts` | executors, modelos, capabilities, defaults, binaryEnvVar | fuente de verdad declarada |
| S2 | `apps/web/src/lib/models.ts:42` | `EFFORT_CAPABLE_MODEL_IDS` = familia GPT-5 | duplicación (supportsEffort no vive en S1) |
| S3 | `packages/execution-core/src/types.ts:304` y `:349` | enum efforts `low\|medium\|high\|xhigh` (dos veces) | duplicación del dominio de efforts |
| S4 | `packages/execution-core/src/routing/policy.ts:48-68` | `DEFAULT_TIER_ROUTES` con selecciones hardcodeadas | copia divergente (`gpt-5-codex` no existe en S1) |
| S5 | `apps/web/src/lib/decomposer-policy.ts:62,232-237` | `DEFAULT_ANTHROPIC_MODEL="claude-sonnet-4-5"` + prefijo `claude-` | espacio paralelo de model ids para modo API |
| S6 | `apps/web/src/lib/server/runs/execution-config-defaults.ts:8` | "codex-cli soporta effort" hardcodeado | duplicación a nivel executor |
| S7 | `apps/web/src/app/(command-center)/_components/effort-control.client.tsx:5-7` | `EffortLevel = low\|medium\|high` (3 niveles) | **cuarta copia del dominio de efforts, más chica que el backend** |
| S8 | `apps/web/src/lib/api-types.ts:137` | union inline `low\|medium\|high\|xhigh` | quinta copia textual del dominio de efforts (verificada) |

**Fuente de verdad real:** S1 para executors/modelos/capabilities; para efforts
no hay ninguna — S2+S3+S6+S7 se solapan sin dueño. Divergencias posibles y
observadas: S4 ya divergió (`gpt-5-codex`); S7 ya divergió (`xhigh` inalcanzable);
S2/S6 divergen ante cualquier rename de modelos.

**Valores que llegan al CLI sin validación:** el `--model` (claude-code.ts:23-24,
codex.ts:16-17) y el effort interpolado (codex.ts:21) se pasan tal cual; ninguna
capa comprueba que el CLI/cuenta los acepte. **Modelos no registrados pueden llegar
al runtime** por: (a) lanes S4 en runs legacy con routing complexity; (b)
normalización legacy de strings desconocidos (§17). **Modelos registrados pueden
no existir realmente** para la cuenta/CLI del usuario: nunca se comprueba.

## 6. CLI discovery and readiness

```
startup            → no hay detección al iniciar el server: todo es on-demand
binary resolution  → env override (MANYHANDS_CLAUDE_BIN / MANYHANDS_CODEX_BIN) ?? defaultBinary; resolveCliBinaryPath para shims Windows
version check      → readiness.ts:241-253 `--version` timeout 10s (por request del endpoint; SIN cache)
auth               → credentials.ts: Claude valida expiry+refresh del OAuth en disco o ANTHROPIC_API_KEY;
                     Codex presencia (auth.json u OPENAI_API_KEY). Compartido por readiness y preflight (única fuente).
model/capability   → NO EXISTE: registry estático S1
API                → GET /api/providers/readiness (por workspace); las opciones de modelo no viajan por API
UI                 → fetch en useEffect por workspaceId (command-center-shell:113-146); sin polling ni refresh
```

Mecanismos **distintos** por contexto (verificado):

| Contexto | Mecanismo | Qué valida |
|---|---|---|
| UI readiness | `defaultCheckCli` `--version` + credenciales + repo | CLI installed+version, auth, workspace |
| Routing complexity | `probeExecutorAvailability` `where/which` (availability.ts:41-68, timeout 5s, cache por proceso en execution-host:355 `availableExecutors ??=`) | solo existencia del binario; ni versión ni auth |
| Execution preflight | `--version` + credenciales (preflight.ts:203-216 + credentials compartidas) | CLI + auth de execution/repair/grounding/overrides |
| Planning | **ninguno** | — |

Aparición/desaparición de un CLI: readiness lo refleja al re-consultar; el probe
de routing queda cacheado por proceso (stale hasta reiniciar); preflight lo
detecta en el próximo start/resume de ejecución; planning solo al fallar el spawn.

## 7. Model and effort support matrix

| Executor | Modelo | Enabled | Planning | Execution | Repair | Efforts (efectivos) | Fuente | Verificación runtime |
|---|---|---|---|---|---|---|---|---|
| claude-code-cli | haiku | sí | no | sí | sí | — (CLI sin flag) | S1 | ninguna |
| claude-code-cli | sonnet | sí | sí | sí | sí | — | S1 | ninguna |
| claude-code-cli | opus | sí | no | sí | sí | — | S1 | ninguna |
| codex-cli | gpt-5.5 | sí | sí | sí | sí | low/med/high (UI); +xhigh (schema) | S1+S2 | ninguna |
| codex-cli | gpt-5.4 | sí | no | sí | sí | ídem | S1+S2 | ninguna |
| codex-cli | gpt-5.4-mini | sí | no | sí | sí | ídem | S1+S2 | ninguna |
| codex-cli | gpt-5-codex | — | — | — | — | — | **solo S4** | llegaría al CLI sin validación |
| opencode-cli | opencode-default | no | no | (decl.) | (decl.) | — | S1 | rechazado por `selectable` en rutas |

Declared vs discovered: **todo es declared**. Ningún modelo es discoverable desde
el CLI en la implementación actual, y no se comprobó que los CLIs ofrezcan
comando de listado (ver §22 para la estrategia recomendada).

## 8. The Goal UI trace

`command-center-shell.client.tsx`:

- Defaults: ambos pickers arrancan en `claude-code-cli/<initialModelId>` (línea 79-81); effort `medium` (82); autonomía `supervised`.
- Planning picker: `selectableModelOptions("planning")` → solo sonnet y gpt-5.5. Execution picker: capability `execution` → los 6 modelos. Independientes de verdad.
- Los modelos sin planning se muestran en el picker de planning **no**: el filtro los excluye; en el de execution se anota "solo ejecución" cuando no planifican (model-picker:91-95).
- Effort: `EffortControl` solo si `selectedExecutionModel.supportsEffort` (466-468); es un slider de 3 niveles (S7). **No hay effort de planning en la UI.**
- Envío (199-222): `model = executionSelection.model`; `defaultRepairSelection := executionSelection` (siempre; repair no es configurable en la UI); `executionConfig.reasoningEffort` solo si supportsEffort.
- Stale selections: al cambiar el modelo de execution de codex→claude, el effort local queda en estado pero no se envía (gate en 219). No hay reset explícito; benigno hoy.
- Readiness: `requiredReadiness` = solo los providers de las selecciones elegidas (162); `canStart` exige status ready/warning para ambos; error de CLI ausente bloquea el submit con callout. Sin refresh periódico ni invalidación tras cambiar PATH.
- UI vs backend: la UI no puede construir combinaciones que el backend rechace por capability (los filtros usan la misma `runtimeCapabilitiesForSelection`). La UI **sí oculta** una combinación que el backend acepta: `executionConfig.reasoningEffort` con planning=codex y execution=claude (el backend lo aceptaría y planning lo usaría; la UI lo omite y planning-host inyecta `medium`). Y oculta `xhigh`, que el schema acepta.

## 9. API validation trace

`POST /api/runs` (runs/route.ts:88-168):

1. `RunCreateRequestSchema` (schema.ts:477-491): `model` string libre;
   `planningExecutorId` ∈ `z.enum(EXECUTOR_IDS)` (**incluye opencode-cli**);
   selecciones `ExecutorSelectionSchema` con model string libre.
2. Derivación: `planningSelection = {planningExecutorId ?? legacy.executorId ?? claude, planningModel ?? legacy.model}`;
   `executionSelection = defaultExecutionSelection ?? planningSelection`;
   `repairSelection = defaultRepairSelection ?? executionSelection` (105-111).
3. `validateSelectionForCapability` por etapa (69-86): membership en MODEL_OPTIONS
   (rechaza opencode y modelos desconocidos con 400) + capability de la etapa.
4. `withDefaultReasoningEffort` (codex execution sin effort → `medium`) + `routing:"fixed"`.

El effort del request **no se valida contra el modelo**: `reasoningEffort` es
aceptado aunque la selección sea claude (quedará persistido e ignorado por el
perfil claude, y **usado** si repair/planning fueran codex). Valor fuera del enum
→ 400 por schema.

## 10. Persistence schema

| Campo conceptual | Request | Schema | Persistido | Default | Normalizado | Efectivo |
|---|---|---|---|---|---|---|
| execution model | `model` + `defaultExecutionSelection` | string libre + selection | `model` (string) + `defaultExecutionSelection` | selection de planning si se omite | `resolveLegacyModelSelection(model)` si falta selection | `executionSelection(run)` |
| planning executor | `planningExecutorId` | enum EXECUTOR_IDS | `planningExecutorId` | claude-code-cli (vía legacy) | `resolveLegacyModelSelection` si falta | `planningSelection(run)` |
| planning model | `planningModel` | string | `planningModel` | `model` | ídem | `planningSelection(run).model` |
| repair | `defaultRepairSelection` | selection | `defaultRepairSelection` | execution | — | `repairSelection(run)` |
| effort | `executionConfig.reasoningEffort` | enum 4 valores | `executionConfig.reasoningEffort` | `medium` si codex (create y planning-host) | `effectiveExecutionConfig` re-parsea | único knob para planning+execution+repair+integración |
| routing | `executionConfig.routing` | enum | siempre `fixed` al crear | schema default **`complexity`** | `effectiveExecutionConfig` aplica el default a legacy | `routerFor` (execution-host:351-357) |
| grounding/titler | — (no configurables) | — | derivados | execution / planning | — | `groundingSelection`/`titlerSelection` |

## 11. Selected vs persisted vs effective configuration

Coinciden en el camino principal (verificado con tests create 5/5 y
executor-selection 7/7). Divergencias: regen (§15), replan effort (§15), effort
UI de 3 niveles vs schema de 4, y normalización legacy (§17).

## 12. Planning trace

`runPlanningPipeline` → planning-host: `planningSelection(run)` →
`pickDecomposer({executorId, model, reasoningEffort: run.executionConfig?.reasoningEffort, spawn: supervisedSpawnFn, budgets…})`
(planning-host.ts:211-267) → decomposer CLI recursivo. Guard D3 anti-mock
(planning-host.ts:628-641) rechaza `deterministic` con mensaje accionable para
las 3 razones. Claude ignora el effort (sin flag CLI); codex lo aplica.
Clarification continuation y plan approval: interrupts nativos del StateGraph,
reutilizan el mismo host/selección (sin re-resolución divergente).

## 13. Execution trace

`executeLeaf` (execution-host.ts:379-458): `executionSelection(run)` →
`RunExecutor.runNode({defaultExecutionSelection, config})` → `resolveExecutorSelection`
(nodo → router → default) → `executorFactory.create(selection)` → perfil CLI con
`--model` y (codex) effort. Leaf retry/repair: `repairSelection(run)` →
`repairLeaf` (466-500) con el mismo `config.reasoningEffort`. Preflight previo
valida CLI+auth de todas las selecciones implicadas (§16).

## 14. Repair / grounding / titler trace

| Consumidor | Selector | Effort | Configurable | Racional aparente | Consistencia |
|---|---|---|---|---|---|
| Repair (leaf y de integración) | `repairSelection` = default ?? execution; override por nodo aplica (executor.ts:528-531) | `config.reasoningEffort` (mismo knob) | request/API sí (`defaultRepairSelection`); UI no (siempre = execution) | retry con posible modelo más fuerte | consistente |
| Integración (IntegrationAgent) | `resolveRepairSelection(params.repair)` = selection ?? legacy (agent.ts:562,1126) | `params.repair.reasoningEffort` ← `config.reasoningEffort` (executor.ts:557,1114) | ídem repair | ídem | consistente |
| Grounding | `groundingSelection` = execution (execution-pipeline:555,613,1189) | no aplica effort explícito | no | el grounding corre en la fase de ejecución | consistente; CLI validado por preflight (preflight.ts:223) |
| Titler | `titlerSelection` = planning (planning-pipeline:173) | no | no | mismo agente que planifica resume el objetivo | consistente; **sin preflight** (falla tardía posible, impacto menor) |

## 15. Replan and regen comparison

| Dimensión | Initial planning | Replan (replan-service.ts) | Subtree regen (regen/route.ts) | Amendments |
|---|---|---|---|---|
| Entrypoint | create/restart → planning-pipeline | decisión/acción → replan-service | POST /nodes/[taskId]/regen | amendments-engine (execution-core) — no re-invoca decomposer; recorta/reseeda el grafo (sin selección de modelo) |
| Resolver | `planningSelection(run)` | campos crudos `run.planningModel ?? run.model` + `run.planningExecutorId` (119-124) | **ninguno**: `model: run.model`, sin executorId (regen:110-114) | n/a |
| Executor efectivo | el elegido | el elegido (legacy: default claude sin resolución de registry) | **siempre ClaudeCode default** | n/a |
| Modelo efectivo | planningModel | planningModel | **run.model (execution)** | n/a |
| Effort | `executionConfig.reasoningEffort` | **omitido** (pickDecomposer sin reasoningEffort) | **omitido** | n/a |
| Spawn supervisado | sí (`supervisedSpawnFn`) | **no** (sin `spawn` → subprocesos fuera del ProcessSupervisor) | **no** | n/a |
| Guard anti-mock | rechaza 3 razones (D3) | rechaza toda `deterministic` (125-129, mensaje propio) | rechaza salvo `forced_by_env` (regen:115-117) | n/a |
| Harness | runMockPlanningFlow (mal nombrado; productivo) | ídem | ídem | n/a |
| Tests | run-create-route, decomposer-* | replan-question-gate | **ninguno sobre selección** | execution-core-replan-invalidation |

Hay **tres implementaciones del mismo concepto** (resolver selección de planning
+ guard + harness). Causa arquitectónica: el "planning invocation" nunca se
extrajo a un servicio; cada feature posterior (replan U2, regen) copió el patrón
del momento y las copias drifted.

## 16. Resume / restart / recovery behavior

| Escenario | Detección | Momento | Evento/status | ¿Accionable? | ¿Fallback silencioso? |
|---|---|---|---|---|---|
| CLI desinstalado, resume/restart de **ejecución** | preflight `--version` (execution-pipeline:549, y 1183 por nodo manual) | antes de tocar el grafo | `PreflightError("cli")` → run failed con mensaje | sí | no |
| Auth expirada (Claude) | preflight credenciales compartidas (credentials.ts:84-98) | ídem | fail accionable (mensaje 401 explicado) | sí | no |
| CLI desinstalado, restart de **planning** | sin preflight; error al spawn del decomposer | tardío (primer step) | failed con error de spawn | parcial (mensaje de bajo nivel, no curado) | no |
| Modelo eliminado del registry pero persistido en el run | **nunca se re-valida** (preflight solo mira executorId) | fallo del CLI si el modelo no existe para la cuenta; si existe, corre con un modelo "no soportado" por ManyHands | depende del CLI | no | **sí** (declared-support bypass) |
| Modelo no disponible para la cuenta | nunca | error del CLI mid-run | attempt failed | mensaje del CLI crudo | no |
| Effort persistido incompatible | nunca (enum estable; claude lo ignora) | — | — | — | ignorado silenciosamente por claude |
| Run histórico con opencode-cli | `EXECUTOR_ID_SET` en resolver lo acepta como id; preflight probaría el binario `opencode` → fail | preflight | fail cli | sí | no |
| Legacy string model desconocido | `normalizeExecutorSelection` → `{claude-code-cli, <string>}` (executor-registry.ts:34) | ejecuta con claude + model desconocido → error del CLI | tardío | no curado | **sí: asignación silenciosa de executor** |
| Restart | claim atómico INV-4 (restart route) → re-entra pipeline correspondiente; ejecución re-pasa preflight; recovery además `reconcileExecutionWorld` | — | — | — | — |

**Corrección de R4 (Fase 1):** la mitad de ejecución estaba equivocada — sí hay
revalidación temprana de CLI+auth en todo start/resume/restart/manual-node de
ejecución. Lo que falta: preflight de planning, revalidación de *modelo*, y
mensajes curados en el camino de planning.

## 17. Legacy configuration behavior

- `resolveLegacyModelSelection(model)` (registry:35): string legacy → selección.
  Match único de model id en el registry → ese executor (p.ej. `"gpt-5.5"` →
  codex). **String desconocido → `{claude-code-cli, string}`** — el executor se
  decide silenciosamente y el model id viaja al CLI sin validación.
- `normalizeExecutorOverride` en models.ts:115-132 tiene la misma rama string→claude.
- Runs sin `executionConfig` persistido: `effectiveExecutionConfig` les aplica el
  default de schema `routing:"complexity"` → lanes S4 (con `gpt-5-codex`) si no
  hay selección explícita (execution-host:352 mitiga cuando `hasExplicitRunSelection`).
- Records sin `planningExecutorId`: resolución legacy en cada lectura (consistente
  entre pipelines; replan usa el campo crudo — diferencia menor solo para strings codex legacy).

## 18. Confirmed findings

1. **F1 (confirmado y ampliado)** — Regen ignora executor, modelo **y effort** de
   planning, y además corre sin spawn supervisado. Evidencia: regen/route.ts:70-77,110-128.
2. **F4 (confirmado y precisado)** — Effort único run-level compartido por
   planning/execution/repair/integración (types.ts:349; planning-host:216-263;
   executor.ts:557,652,815,1114). UI solo lo expone para el modelo de execution.
3. **F5 (confirmado y ampliado)** — Tres guards anti-mock con criterios distintos:
   planning-host (rechaza 3 razones), replan-service:125-129 (rechaza todas,
   mensaje distinto), regen:115-117 (permite `forced_by_env`).
4. **F6 (nuevo)** — Replan pierde el reasoningEffort de planning y no pasa
   `spawn` supervisado: subprocesos de replan quedan fuera del ProcessSupervisor
   (cancel puede no matarlos). Evidencia: replan-service.ts:119-141 (sin
   `reasoningEffort` ni `spawn`) vs planning-host.ts:253-263.
5. **F7 (nuevo)** — Dominio de effort fracturado: UI 3 niveles (effort-control:5-7)
   vs backend 4 (`xhigh` inalcanzable desde la UI); el tipo `EffortLevel` está
   definido 2 veces (client + api-types) además del enum zod duplicado (types.ts:304,349).
6. **F8 (nuevo)** — Normalización legacy silenciosa: un model string desconocido
   se convierte en `{claude-code-cli, <string>}` sin validación ni evento
   (executor-registry.ts:34; models.ts:115-118). Viola "no fallbacks silenciosos".
7. **F9 (nuevo)** — El effort del request no se valida contra la selección: se
   acepta y persiste `reasoningEffort` con modelos que no lo soportan; el perfil
   claude lo ignora en silencio (claude-code.ts no lo referencia).
8. **R5 (confirmado y ampliado)** — 7 fuentes de capabilities, 5 duplicaciones
   (§5), dos ya divergidas (S4, S7).

## 19. Rejected or downgraded Phase 1 findings

- **R4 → downgraded/split**: "sin revalidación al resume" es falso para
  ejecución (preflight de CLI+auth en execution-pipeline:549,1183 con
  `collectExecutorIds` cubriendo execution/repair/grounding/overrides). Queda
  vigente solo para: planning restart (sin preflight), disponibilidad de modelo
  (nunca), y probe de routing cacheado por proceso.
- **R1 (ya degradado en Fase 1)**: se reconfirma el guard D3; el residuo es F5.
- Resto de findings de Fase 1 (F1-F5): confirmados, ver §18.

## 20. Root-cause graph

```
RC-A  No existe un servicio único de invocación de planning
      (selección → guard → budgets → spawn → harness)
      ├── F1  regen re-implementa y omite selección/effort/spawn
      ├── F5  guards anti-mock triplicados divergen
      └── F6  replan omite effort y spawn supervisado

RC-B  El registry (S1) no modela effort ni defaults por modelo/etapa
      ├── R5/S2  supportsEffort duplicado en la UI
      ├── S6     "codex soporta effort" duplicado en defaults del server
      ├── F7     dominios de effort distintos entre UI y backend
      └── F9     imposible validar effort contra el modelo en el request

RC-C  El effort no forma parte de la selección de etapa
      └── F4  un solo knob para planning/execution/repair/integración

RC-D  "Declared support" sin capa de "runtime availability" para modelos
      ├── F8  normalización legacy silenciosa (string → claude)
      ├── F3(F1ase1)  lanes S4 con model id muerto
      └── §16 modelos nunca revalidados en resume; errores del CLI crudos

RC-E  Detección de entorno fragmentada (readiness ≠ availability ≠ preflight; planning sin preflight)
      └── R4-residual  fallos tardíos y cache stale del probe
```

Por qué los tests actuales no lo detectaron: los tests de create/selection
cubren el camino principal (route + resolver), pero **no existe ningún test que
afirme qué selección usa regen**, ninguno que verifique el effort en replan, y
ninguno que compare los tres guards; los tests de decomposer inyectan spawn
propio, ocultando la ausencia de supervisión en replan.

## 21. Missing tests

1. Regen usa `planningSelection(run)` (executor+model+effort) — hoy fallaría (rojo deseado).
2. Replan propaga `reasoningEffort` y registra subprocesos en el ProcessSupervisor.
3. Paridad de guards anti-mock (una única política, tres entrypoints).
4. `xhigh` seleccionable end-to-end o eliminado del schema.
5. Legacy string desconocido → error accionable (no claude silencioso).
6. Node override con modelo sin capability de la etapa (hoy solo membership+enabled).
7. Planning restart con CLI ausente → error curado temprano.
8. Effort en request con modelo que no lo soporta → 400 o strip explícito documentado.
9. Lanes de routing referencian solo modelos del registry (test de consistencia estática).

## 22. Remediation architecture

**Modelo canónico** (evita parches aislados para F1/F4/F5 — ataca RC-A/B/C/D):

1. **Registry único enriquecido (RC-B)** — en `@manyhands/shared`:
   `ExecutorModelDescriptor` gana `efforts: readonly EffortLevel[] | null` y
   `defaultEffort?`; `EffortLevel` se define UNA vez en shared y se re-exporta.
   `models.ts` deriva `supportsEffort = efforts !== null`; se eliminan S2/S6/S7
   (la UI importa los niveles del registry). Lanes S4 se validan contra el
   registry en un test estático o se eliminan junto con complexity routing
   (decisión de producto pendiente, ver Fase 1 §19).
2. **Selección por etapa con effort (RC-C)** — `StageSelection = {executorId,
   model, effort?}`. `RunRecord` gana `planningSelection?`, `executionSelection?`,
   `repairSelection?` (objetos completos). `executor-selection.ts` se convierte
   en el ÚNICO resolver: lee los campos nuevos y, si faltan, deriva de los
   legacy exactamente como hoy (la migración es lazy, sin re-escritura masiva).
   `executionConfig.reasoningEffort` queda como legacy input que el resolver
   proyecta a `executionSelection.effort`/`repairSelection.effort`.
3. **PlanningInvocationService (RC-A)** — un módulo server-side
   `invokePlanning({run, feature, mode, resume?})` que: resuelve
   `planningSelection(run)` (con effort), aplica UN guard anti-mock, inyecta
   `supervisedSpawnFn`, budgets persistidos y grounding, y llama al harness
   (renombrado `runPlanningFlow`, movido fuera de `@manyhands/core`). Initial
   planning, replan, regen y cualquier regeneración futura lo consumen. Elimina
   F1/F5/F6 por construcción.
4. **Capa declared vs available (RC-D/E)** — un `CapabilityService` con dos
   niveles: `declared(selection)` (registry, síncrono; valida create/PATCH) y
   `available(selection)` (binario+versión+auth, cache con TTL corto e
   invalidación explícita; usado por readiness, preflight de ejecución y un
   nuevo preflight de planning). Discovery de modelos: ni claude ni codex
   garantizan un comando de listado no-facturable, así que la estrategia es
   **registry declarado + clasificación del primer fallo**: los perfiles CLI
   detectan el patrón "unknown/unsupported model" en stderr y lo convierten en
   `ExecutorModelUnavailableError` accionable + `RunEvent` dedicado, en vez del
   error crudo. Nunca presentar declared como discovered en la UI (etiqueta
   "declarado" en tooltips si hace falta).
5. **Error model** — errores tipados: `InvalidSelectionError` (declared, 400),
   `ExecutorUnavailableError` (preflight, run failed accionable),
   `ExecutorModelUnavailableError` (runtime clasificado). La normalización
   legacy de strings desconocidos pasa de silencio a `InvalidSelectionError`
   con mensaje de migración (F8).
6. **UI** — endpoint `GET /api/capabilities` (registry + readiness fusionados)
   para que la UI no importe registries; controls de effort por etapa (planning
   y execution), rango tomado del registry (incluye xhigh si el modelo lo declara).

## 23. Migration strategy

- Los `RunRecord` existentes no se re-escriben: el resolver deriva
  `StageSelection` de los campos legacy en lectura (mismo patrón actual). Los
  writers nuevos persisten ambos formatos durante una release (dual-write) y
  luego solo el nuevo.
- Runs con `opencode-cli` o strings desconocidos: al resolver, se emite el error
  tipado accionable en vez de normalizar a claude; la UI ofrece corregir la
  selección (los estados reabribles ya existen: `failed → approved`).
- Runs con `routing:"complexity"` implícito legacy: `effectiveExecutionConfig`
  pasa a default `fixed` con anotación de migración (o se elimina complexity —
  decisión de producto; ambas opciones documentadas).
- `xhigh`: mantener en schema y exponerlo en la UI para modelos que lo declaren,
  o quitarlo del enum con migración de records (preferido: mantener + declarar).

## 24. Implementation units ordered by dependency

1. **U2A-1** Registry enriquecido + `EffortLevel` único en shared (RC-B). Tests: 9 de §21 (subset 4,9).
2. **U2A-2** `StageSelection` + resolver único + validación de effort en request (RC-C, F4, F9). Depende de 1.
3. **U2A-3** `PlanningInvocationService` + migración de planning-host/replan/regen + guard único (RC-A, F1, F5, F6). Depende de 2. Tests §21: 1,2,3.
4. **U2A-4** `CapabilityService` declared/available + planning preflight + clasificación de errores de modelo (RC-D/E, F8, R4-residual). Depende de 1. Tests §21: 5,6,7,8.
5. **U2A-5** `/api/capabilities` + UI por etapa + effort range dinámico (F7). Depende de 1-2.
6. **U2A-6** Decisión y limpieza de complexity routing / lanes (F3 Fase 1). Depende de 4.

## 25. Residual uncertainty

- Comportamiento exacto (mensaje/estado) del spawn fallido del decomposer en
  planning restart: inferido de la ausencia de preflight; no reproducido (requiere
  entorno sin CLI — barato de reproducir en Fase de fixes con test 7 de §21).
- Formato real del error "unknown model" de cada CLI (necesario para U2A-4):
  requiere una invocación real (fuera del presupuesto de esta fase).
- (Cerrada) `api-types.ts:137` confirmada como quinta copia textual del dominio
  de efforts (S8).
- Import/export de runs (`export`, `serialize` routes) no leídos: se asume que
  serializan el RunRecord tal cual (bajo riesgo de divergencia de config).

Criterios de finalización: fuentes identificadas (7, §5); combinaciones trazadas
(§8-§10, matriz §7 y ledger `configurationMatrix`); effort por etapa trazado
(§12-§14); regen/replan comparados (§15); resume/restart inspeccionados (§16);
selected/persisted/effective diferenciados (§10-§11); fallbacks identificados
(ledger `fallbacks`); F1/F4/F5/R4/R5 resueltos (§18-§19); root causes (§20);
remediación (§22); migración (§23). Ambos entregables consistentes.
