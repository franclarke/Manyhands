# UltraCode Session — Frontier Implementation (2026-06-10)

Objetivo: orquestador end-to-end funcional. Sistemas que instruyen, evalúan y corrigen agentes automáticamente.

## Fase 1 — execution-core: multi-executor + send-to-user + auto-corrección
- [x] 1.1 Registry/adaptadores data-driven (CliAgentExecutor + perfiles; factory sin switch)
- [x] 1.2 Clasificador de errores de executor (failure.ts) + failureKind/Hint en resultados
- [x] 1.3 Rediseño Gemini CLI executor (-o json: response + token stats, errores estructurados)
- [x] 1.4 Claude CLI executor: --output-format json (usage/cost reportados)
- [x] 1.5 Codex CLI executor funcional (codex exec headless) + habilitado en registry
- [x] 1.6 Canal send-to-user: MH_STATUS por stdout + onAgentStatus + trace agent_status

## Fase 2 — Enrutamiento inteligente por complejidad
- [x] 2.1 scoreNodeComplexity (features deterministas del DAG/contrato + señales auditables)
- [x] 2.2 ComplexityRoutingPolicy (tiers → ranked selections, fallback por disponibilidad)
- [x] 2.3 probeExecutorAvailability + wiring en RunExecutor/host (config.routing, traza executor_routed)
- [x] 2.4 Escalación de tier en repair (attempt ≥ 1)

## Fase 3 — Planning sobre LangGraph (HITL nativo)
- [x] 3.1 Planning StateGraph v2 (decomposePlan caro sin interrupt; questionGate/approvalGate baratos)
- [x] 3.2 planning-host.ts en apps/web (deps + eventos vivos + JsonFileCheckpointSaver `__planning`)
- [x] 3.3 Rewire planning-pipeline/resume/answer/decisions/approve-plan/restart; DecomposerQuestionError muere en el seam

## Fase 4 — Re-decomposición selectiva
- [x] 4.1 graftSubtree (task-graph) + invalidateTask/closure (AmendmentsEngine) + replan-service (web)
- [x] 4.2 Gate option "replan_subtree" en leafGate + resume/decisions routes (out-of-band del Command resume)

## Fase 5 — Calidad
- [x] 5.1 pnpm typecheck (raíz, exit 0 — incluía 40 errores latentes preexistentes en fixtures, reparados) + pnpm web:typecheck + pnpm build + pnpm test (925 passed / 3 skipped)
- [x] 5.2 Docs: implementacion-frontera.md + future-frontier-tasks.md + walkthrough.md
- [x] 5.3 Commits de checkpoint (b3b798d, 411adc5, 5a5f2f2, 9cf6439 + final)
