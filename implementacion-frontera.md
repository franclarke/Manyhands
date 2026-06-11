# Implementación Frontera — Sistemas que instruyen, evalúan y corrigen agentes

> Sesión UltraCode 2026-06-10. Este documento mapea cada pieza nueva del sistema al
> paradigma "diseñar sistemas que instruyen, evalúan y corrigen agentes automáticamente",
> con sus archivos, tests y commits de checkpoint.

## Resumen ejecutivo

ManyHands ya no es un orquestador que "le pasa prompts a Gemini y espera". Tras esta
sesión, el sistema:

1. **Instruye** — genera contratos y directrices dinámicas por nodo (seams, scope,
   protocolo de progreso) y selecciona qué agente recibe cada instrucción según la
   complejidad medida del nodo.
2. **Evalúa** — clasifica fallos de executor por causa raíz, valida sintaxis/AST tras
   cada repair, corre critics deterministas sobre el plan dentro del StateGraph, y
   verifica scope y diffs de git como única fuente de verdad.
3. **Corrige** — reinyecta errores exactos al agente en ciclos cerrados (repair con
   feedback de compilador), escala automáticamente a un modelo más potente en el
   segundo intento, y puede re-planificar quirúrgicamente un subárbol fallido sin
   desechar el DAG.

Las cuatro fases quedaron en verde: `pnpm typecheck`, `pnpm build`, `pnpm test`
(96 archivos de test / ~900 tests) y `pnpm web:typecheck` sin errores.

---

## Fase 1 — Capa multi-executor (instruir a cualquier agente CLI)

**Commit:** `b3b798d`

| Pieza | Archivo | Rol en el paradigma |
|---|---|---|
| `CliAgentExecutor` + `CliExecutorProfile` | `packages/execution-core/src/executor/cli-executor.ts` | Un solo motor de procesos; cada CLI es **dato** (perfil), no una clase. Agregar un CLI = perfil + descriptor, cero cambios en el factory. |
| Perfil Gemini (rediseñado) | `executor/profiles/gemini.ts` | `-o json`: el sistema ya no lee texto plano — extrae `response` + token stats reales (usage `reported`) y errores estructurados del proveedor. |
| Perfil Claude Code (nuevo, funcional) | `executor/profiles/claude-code.ts` | `--output-format json`: usage y costo exactos (`total_cost_usd`), texto de error visible en stderr. |
| Perfil Codex (nuevo, funcional) | `executor/profiles/codex.ts` | `codex exec` headless con sandbox `workspace-write`, prompt por stdin (`-`), `--skip-git-repo-check` para worktrees anidados. Habilitado en el registry. |
| Clasificador de fallos | `executor/failure.ts` | **Evaluación automática**: todo exit≠0 se clasifica (timeout/aborted/binary_missing/auth/quota/model_not_found) con hint accionable y flag `retryableOnOtherExecutor`. El `ResultRecorder` persiste `failureKind`/`failureHint` en cada resultado. |
| Canal send-to-user | `executor/status-channel.ts` | Protocolo `MH_STATUS {json}` por stdout: el agente de larga duración reporta progreso **sin terminar su turno**. El executor lo parsea (tolerante a chunks partidos y JSON malformado) y `RunExecutor` lo proyecta como evento de traza `agent_status` que la UI streamea en vivo. Las instrucciones de hoja enseñan el protocolo automáticamente (`AGENT_STATUS_PROTOCOL_INSTRUCTIONS`). |

**Tests:** `tests/execution-core-{executor-failure,status-channel,codex-cli,executor-factory,gemini-cli,claude-code-cli,executor-registry,recorder,leaf-instructions}.test.ts`.

## Fase 2 — Enrutamiento inteligente por complejidad

**Commit:** `411adc5`

| Pieza | Archivo | Rol |
|---|---|---|
| `scoreNodeComplexity` | `packages/execution-core/src/routing/complexity.ts` | Scoring determinista y **explicable** (cada punto tiene una señal legible que va a la traza): seams producidos/consumidos, archivos esperados, criterios de aceptación, tamaño del goal, fan-in/fan-out, amplitud de scope, nodos integrator. Tiers: trivial / standard / complex / critical. |
| `ComplexityRoutingPolicy` | `routing/policy.ts` | Carriles por tier (flash/haiku → pro/sonnet → sonnet/codex → opus). **Corrección automática**: los repairs rutean con `attempt ≥ 1` y escalan un tier — si el modelo barato falló la validación, el reintento recibe un cerebro más potente. |
| `probeExecutorAvailability` | `routing/availability.ts` | Solo se rutea sobre CLIs realmente instalados; una máquina solo-gemini degrada con gracia (nunca ENOENT en medio de un run). |
| Wiring | `run/executor.ts`, `apps/web/.../execution-host.ts` | Precedencia: override por metadata del nodo → router → default del run. `executionConfig.routing: "complexity" | "fixed"`. Cada decisión queda auditada como traza `executor_routed` (tier, score, señales, degradación). |

**Tests:** `tests/execution-core-{routing,availability}.test.ts`.

## Fase 3 — Planning sobre LangGraph (HITL nativo)

**Commit:** `5a5f2f2`

Topología (espejo del patrón maduro del execution graph: nodos caros nunca
interrumpen; los gates son puros y baratos):

```
START → decomposePlan ─→ questionGate (interrupt) ⟲ decomposePlan
              └─(sin preguntas)→ criticReview → approvalGate (interrupt) → END
```

| Pieza | Archivo | Rol |
|---|---|---|
| Planning StateGraph v2 | `packages/orchestrator-graph/src/graphs/planning-graph.ts` + `nodes/planning-nodes.ts` | Las preguntas aclaratorias del decomposer y la aprobación del plan son `interrupt()` nativos resumidos con `Command({ resume })`. El decomposer recursivo continúa desde su `stepCache` checkpointeado — resumir un gate no re-ejecuta el LLM. |
| Critics in-loop | `criticReview` node | **Evaluación dentro del grafo**: plan critic + seam critic corren como nodo del StateGraph y su veredicto viaja en el payload del interrupt de aprobación. |
| Planning host | `apps/web/src/lib/server/runs/planning-host.ts` | Deps inyectadas (decomposer con streaming de eventos vivos `plan.node.proposed`, critics con persistencia), checkpoints en `JsonFileCheckpointSaver` bajo thread `${runId}__planning` (resume cross-proceso). La excepción `DecomposerQuestionError` **muere en este seam**: se convierte a dato. |
| Pipeline/rutas | `planning-pipeline.ts` (reescrito como driver fino), `resume`, `answer`, `decisions`, `approve-plan`, `restart` | `resumePlanningPipeline(runId, decision)` reanuda nativamente; restart borra el thread de planning; runs legacy sin checkpoint caen al camino anterior. |

**Tests:** `packages/orchestrator-graph/src/graphs/planning-graph.test.ts` (aprobación,
pregunta+answer con stepCache, rechazo, resume cross-proceso desde disco).

## Fase 4 — Re-decomposición selectiva (corregir sin desechar)

**Commit:** `9cf6439`

| Pieza | Archivo | Rol |
|---|---|---|
| `graftSubtree` | `packages/task-graph/src/index.ts` | Cirugía validada del DAG: el nodo fallido conserva su identidad (id/parent/título/goal), sus descendientes viejos se descartan, los bordes de frontera se re-apuntan al nodo, y el subárbol nuevo se adopta bajo ids `${taskId}-r${rev}-…`. Un graft inválido lanza error en vez de corromper el plan. |
| `invalidateTask` + `computeTaskInvalidationClosure` | `packages/execution-core/src/run/amendments-engine.ts` | Cierre de invalidación = subárbol + dependientes transitivos + integraciones ancestras. Limpia worktrees/branches y filtra resultados para que el frontier re-entre sembrado solo con el trabajo superviviente. |
| `replanSubtree` | `apps/web/src/lib/server/runs/replan-service.ts` | Re-decomposición **scoped**: el decomposer recibe el goal del nodo + contexto del padre + la razón del fallo + los **seams congelados** como restricciones duras ("FROZEN INTERFACE — never change it"). Luego graft → invalidación → `resetExecutionThread` → re-ejecución. |
| Gate option | `execution-host.ts` (`replan_subtree`), rutas `resume` y `decisions` | El humano (o un evaluador futuro) elige "Re-planificar subárbol" en el leafGate; se maneja out-of-band del Command resume porque reconstruye el plan y resetea el thread. |

**Tests:** `tests/task-graph-graft.test.ts`, `tests/execution-core-replan-invalidation.test.ts`.

---

## Ciclos cerrados de instrucción → evaluación → corrección (mapa completo)

1. **Hoja**: instrucciones dinámicas (contrato + seams + scope + protocolo MH_STATUS)
   → ejecución aislada en worktree → `git diff` como verdad (D5) → scope check →
   validación de comandos → si falla: repair con el output exacto del fallo, ruteado
   un tier arriba → si persiste: leafGate humano con opción de re-planificar el subárbol.
2. **Integración**: cherry-pick → conflicto → repair contract-aware con predicción de
   conflictos del planning → gate AST/sintaxis con feedback de compilador (2 pasadas)
   → conflictGate humano como último recurso.
3. **Planning**: decomposer recursivo con grounding del repo → pregunta = interrupt
   nativo → critics deterministas in-loop → approval gate con veredicto adjunto →
   re-decomposición selectiva post-fallo con seams congelados.
4. **Observabilidad**: cada decisión del sistema queda en trazas tipadas
   (`executor_routed`, `agent_status`, `executor_completed` con usage real,
   `failureKind`/`failureHint` en resultados) — el usuario ve qué agente, por qué,
   cuánto costó y qué está haciendo ahora.

## Deudas conocidas (intencionales, no bugs)

- Codex CLI reporta usage como `unavailable` (su modo texto no emite stats estables);
  la clasificación de errores sí aplica.
- Las preguntas aclaratorias del decomposer durante un **replan** abortan el replan con
  mensaje accionable (el HITL de replan-questions es una iteración futura).
- El evento `agent_status` se persiste/streamea por la vía de trazas existente; un
  widget dedicado en el panel de foco es trabajo de UI futuro.
