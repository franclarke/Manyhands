# Walkthrough — Sesión UltraCode 2026-06-10 (frontera end-to-end)

Reporte de cambios de la sesión. Detalle completo del diseño y el mapa
instruir/evaluar/corregir: ver [`implementacion-frontera.md`](implementacion-frontera.md).

## Commits de checkpoint

1. `b3b798d` — **execution-core multi-executor**: capa por perfiles
   (`CliAgentExecutor` + `CliExecutorProfile`), rediseño Gemini (`-o json` con token
   stats), Claude Code con `--output-format json` (usage/costo reportados), Codex CLI
   habilitado (`codex exec` headless), clasificador de fallos (`failureKind`/`failureHint`),
   canal send-to-user (`MH_STATUS` → trazas `agent_status`), upgrade automático de
   `usageSource` en el recorder.
2. `411adc5` — **enrutamiento por complejidad**: scorer determinista explicable,
   política por tiers con fallback por disponibilidad real de binarios, escalación de
   tier en repairs, traza `executor_routed`, `executionConfig.routing`.
3. `5a5f2f2` — **planning sobre LangGraph**: StateGraph v2 con gates baratos
   (`questionGate`/`approvalGate` con `interrupt()` nativo), critics in-loop,
   `planning-host.ts`, resume nativo con `Command({ resume })` en
   resume/answer/decisions/approve-plan, thread `${runId}__planning`,
   `DecomposerQuestionError` eliminado del flujo de orquestación.
4. `9cf6439` — **re-decomposición selectiva**: `graftSubtree` (task-graph),
   `AmendmentsEngine.invalidateTask` (cierre subárbol+dependientes+ancestros),
   `replan-service.ts` (re-plan scoped con seams congelados), gate option
   `replan_subtree` en el leafGate.

## Verificación

- `pnpm -F @manyhands/execution-core typecheck` ✅
- `pnpm -F @manyhands/orchestrator-graph typecheck` ✅
- `pnpm -F @manyhands/task-graph typecheck` ✅
- `pnpm web:typecheck` ✅
- `pnpm build` ✅
- `pnpm typecheck` (raíz) ✅ — exit 0. Nota: el typecheck raíz estaba roto desde antes
  (sin mapping `@/*` y ~40 errores latentes en fixtures de tests que vitest nunca
  typecheckeó); se agregó el alias a `tsconfig.base.json`, lib DOM al programa raíz,
  y se repararon los 21 archivos de test afectados.
- `pnpm test` ✅ — 925 tests passed / 3 skipped (96 archivos; baseline previo: 868 / 88)

## Archivos clave nuevos

- `packages/execution-core/src/executor/{cli-executor,failure,status-channel}.ts`
- `packages/execution-core/src/executor/profiles/{gemini,claude-code,codex}.ts`
- `packages/execution-core/src/routing/{complexity,policy,availability}.ts`
- `packages/orchestrator-graph/src/graphs/planning-graph.ts` (v2) + test
- `apps/web/src/lib/server/runs/{planning-host,replan-service}.ts`

## Eliminado (cero legacy)

- `packages/execution-core/src/executor/{gemini-cli,claude-code-cli}.ts`
  (reemplazados por perfiles + executor genérico)
- Planning nodes v1 (cola por superstep con interrupt dentro del nodo caro) y su test
- Flujo exception-driven de preguntas en `planning-pipeline.ts` (653 → driver fino)
