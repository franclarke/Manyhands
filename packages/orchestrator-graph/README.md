# @manyhands/orchestrator-graph

> Los StateGraphs de [LangGraph](https://langchain-ai.github.io/langgraphjs/) que orquestan planning y ejecución, con checkpoints durables para resume/fork.

## Rol en el pipeline

Orquestación. Es el motor que conecta `decomposer`, `scheduler` y `execution-core` en dos grafos de estado.

## Conceptos clave

- **`planningGraph`.** Flujo de planificación: `decompose` → *question gate* (aclaraciones) → *degraded gate* → *critic review* → *approval gate*.
- **`executionGraph`.** Flujo de ejecución: `prepare` → *route frontier* → `execute leaf` → *leaf gate* → *budget gate* → `integrate composite` → *conflict gate* → `run validation`.
- **Estado reducible.** `RunStateAnnotation` modela el run como canales que se reducen (append-only), no como estado mutable.
- **Checkpoints durables.** `JsonFileCheckpointSaver` persiste el estado del grafo en JSON, habilitando `resume` y `fork`.
- **Gates = interrupts humanos.** Los gates (question / approval / leaf / budget / conflict) pausan el grafo esperando una decisión.

## API pública

`buildPlanningGraph` · `buildExecutionGraph` · `RunStateAnnotation` · `JsonFileCheckpointSaver` · factories de nodos (`makeDecomposePlanNode`, `approvalGateNode`, `makeExecuteLeafNode`, `conflictGateNode`, …)

## Dependencias

`@manyhands/decomposer`, `@manyhands/execution-core`, `@manyhands/task-graph`, `@langchain/langgraph`. **Más:** [`docs/system/04-run-executor.md`](../../docs/system/04-run-executor.md).
