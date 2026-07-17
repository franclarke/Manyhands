# @manyhands/orchestrator-graph

Implementación actual de planning/execution StateGraphs con LangGraph y
checkpoints JSON.

## Estado actual

El package conecta decomposer, scheduler y execution-core. Modela gates,
fan-out/fan-in, resume y fork mediante APIs de LangGraph.

## Boundary objetivo

LangGraph es un adapter del control plane. No define TaskGraph, lifecycle,
Decision, Artifact ni RunEvent. Los nodos del StateGraph deben invocar casos de
uso del `RunCoordinator` y respetar leases/fencing.

El plan de transición debe identificar:

- semántica de dominio hoy embebida en state/channels;
- checkpoints usados como segunda verdad;
- interrupts que deben convertirse en `Decision` durable;
- tombstones o reducers específicos del framework;
- funcionalidades de fan-out/resume que conviene conservar.

Ver [`docs/design/langgraph-orchestrator-design.md`](../../docs/design/langgraph-orchestrator-design.md)
y [`docs/system/04-run-executor.md`](../../docs/system/04-run-executor.md).
