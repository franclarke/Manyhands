# ManyHands — Handoff Walkthrough

Este documento apunta a las fuentes vigentes para continuar el desarrollo sin
revivir documentación vieja de Lab/benchmarks/tesis.

## Mapa De Lectura

| Documento | Rol |
|-----------|-----|
| [`../DECISIONS.md`](../DECISIONS.md) | Decisiones vigentes y notas superseded |
| [`../system/README.md`](../system/README.md) | Flujo completo del sistema actual |
| [`langgraph-orchestrator-design.md`](langgraph-orchestrator-design.md) | Diseño del orquestador con LangGraph |
| [`run-operative-model.md`](run-operative-model.md) | Event model, reducer, selectors e invariantes |
| [`system-components.md`](system-components.md) | Componentes conceptuales de la sala de control |
| [`golden-fixtures.md`](golden-fixtures.md) | Fixtures de eventos para regresión UI/modelo |
| [`../../apps/web/README.md`](../../apps/web/README.md) | Rutas y APIs actuales |

## Consistencia Que Debe Mantenerse

1. El event log es la fuente de verdad dinámica de la UI.
2. Checkpoints y `RunRecord` son la fuente durable para resume/fork.
3. La ejecución de hojas sigue pasando por worktrees y `AgentExecutor`.
4. `git diff HEAD` determina qué cambió.
5. Los agentes no commitean; el orquestador commitea.
6. Lab Mode, replay determinístico y benchmarks viejos no se reintroducen.

## Arranque Seguro

1. Revisar `git status --short`.
2. Leer el archivo de sistema o diseño que toca la tarea.
3. Hacer cambios pequeños.
4. Correr el test o typecheck más estrecho.
5. Actualizar docs afectadas si el comportamiento cambia.

