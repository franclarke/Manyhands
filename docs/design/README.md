# Diseño de producto de ManyHands

Esta carpeta define cómo una persona comprende y controla el sistema. La
semántica técnica del backend vive en [`../system/`](../system/); esta capa no
inventa estados ni capacidades que el backend no pueda demostrar.

## Orden de lectura

1. [`agent-first-redesign.md`](agent-first-redesign.md): experiencia implementada.
2. [`run-operative-model.md`](run-operative-model.md): entidades, eventos y
   estados derivados.
3. [`interaction-model.md`](interaction-model.md): comportamiento del workspace.
4. [`system-components.md`](system-components.md): responsabilidades de producto
   y backend.
5. [`decomposer-composer-redesign.md`](decomposer-composer-redesign.md): ida y
   vuelta del grafo.
6. [`design-system.md`](design-system.md): lenguaje visual, accesibilidad y
   movimiento.
7. [`golden-fixtures.md`](golden-fixtures.md): demostraciones y regresiones.

El contexto histórico y las decisiones ya retiradas se conservan aparte en
[`evolution-and-rationale.md`](evolution-and-rationale.md); no es necesario para
comprender la experiencia actual.

El comportamiento productivo actual se verifica además en
[`../development/architecture.md`](../development/architecture.md) y en los
tests del reducer, layout, relaciones y viewport bajo `tests/run-model-*` y
`tests/run-canvas-*`.

## Principios

- Un solo workspace por run.
- Grafo como centro durante planning y ejecución.
- Evidencia como centro cuando existe un resultado.
- Decisiones humanas locales y no bloqueantes para trabajo independiente.
- Progressive disclosure en lugar de superficies técnicas separadas.
- Estado derivado de eventos, nunca sobrescrito por componentes.
- Movimiento para explicar causalidad, nunca para mover el viewport.
- Jerarquía persistente y relaciones secundarias reveladas mediante lentes.
- Decisiones resueltas en el inspector contextual, con una franja global para
  recorrer pendientes.

## Superficies que dejan de ser primarias

`Tareas`, `Planificación`, `Integración`, `Interfaces`, board, timeline, logs y
diagnóstico avanzado no son destinos de navegación equivalentes. Siguen
existiendo como detalles del nodo, relación o resultado cuando aportan contexto.

## Relación con `/proto`

Los fixtures usan el mismo reducer, selectores y componentes que el producto.
Su sidebar enumera fixtures, no workspaces reales. Son herramientas de diseño y
regresión visual; no certifican comportamiento backend.
