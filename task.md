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
- [ ] 2.1 scoreNodeComplexity (features deterministas del DAG/contrato)
- [ ] 2.2 ExecutorRoutingPolicy (tiers → ranked selections, fallback por disponibilidad)
- [ ] 2.3 Disponibilidad de binarios (probe) + wiring en RunExecutor/host
- [ ] 2.4 Escalación de tier en repair

## Fase 3 — Planning sobre LangGraph (HITL nativo)
- [ ] 3.1 Planning StateGraph v2 (gates baratos: questionGate/approvalGate, critics in-loop)
- [ ] 3.2 planning-host.ts en apps/web (deps + eventos vivos + checkpointer)
- [ ] 3.3 Rewire planning-pipeline/resume/approve-plan; eliminar DecomposerQuestionError flow

## Fase 4 — Re-decomposición selectiva
- [ ] 4.1 replanSubtree: invalidación + splice del subárbol + re-plan scoped
- [ ] 4.2 Gate option "replan_subtree" en leafGate + ruta de decisión

## Fase 5 — Calidad
- [ ] 5.1 pnpm typecheck + pnpm test verdes en todo el monorepo
- [ ] 5.2 Docs: implementacion-frontera.md + future-frontier-tasks.md + docs/system
- [ ] 5.3 Commits de checkpoint
