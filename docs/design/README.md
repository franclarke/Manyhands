# Rediseño Agent-First De ManyHands

Esta carpeta documenta la dirección vigente de UI y orquestación: una sala de
control continua para runs de agentes de software.

La documentación de esta carpeta no define una estrategia de benchmarks ni de
tesis. Los golden fixtures mencionados aquí son fixtures de eventos para validar
el reducer, selectores y UI; no son benchmarks de calidad.

## Orden De Lectura

| # | Documento | Rol |
|---|-----------|-----|
| 1 | [`agent-first-redesign.md`](agent-first-redesign.md) | Visión de experiencia y producto |
| 2 | [`run-operative-model.md`](run-operative-model.md) | Event log, entidades, reducer, selectores e invariantes |
| 3 | [`interaction-model.md`](interaction-model.md) | Cómo se vive un run de punta a punta |
| 4 | [`system-components.md`](system-components.md) | Piezas conceptuales y colaboración entre capas |
| 5 | [`golden-fixtures.md`](golden-fixtures.md) | Fixtures de eventos para regresión de UI/modelo |
| 6 | [`evolution-and-rationale.md`](evolution-and-rationale.md) | Registro histórico del cambio de DAG viewer a sala de control |
| 7 | [`decomposer-composer-redesign.md`](decomposer-composer-redesign.md) | Diseño técnico de decomposer/composer, sin metodología de evaluación activa |
| 8 | [`langgraph-orchestrator-design.md`](langgraph-orchestrator-design.md) | Diseño del orquestador con LangGraph |
| 9 | [`future-frontier-tasks.md`](future-frontier-tasks.md) | Backlog técnico exploratorio |

## Conceptos Clave

- **Sala de control continua** — un run que madura por fases.
- **Event log append-only** — fuente de verdad dinámica.
- **Reducer + selectors** — todo estado visible es derivado.
- **Seam** — contrato entre nodos que habilita paralelismo seguro.
- **Verify-loop** — un leaf no está bien porque produjo diff, sino porque valida.
- **Freshness** — vigencia derivada frente a cambios de seams.
- **Decision** — recurso unificado para intervención humana.

## Estado De Las Decisiones

El modelo operativo A-P está congelado como dirección de producto. La
implementación puede cambiar detalles, pero no debe volver a:

- estados visuales imperativos por nodo;
- tres vistas primarias equivalentes;
- consola CLI cruda como superficie principal;
- Lab Mode o replay determinístico como experiencia de producto.

Relación con decisiones del sistema: [`../DECISIONS.md`](../DECISIONS.md).

