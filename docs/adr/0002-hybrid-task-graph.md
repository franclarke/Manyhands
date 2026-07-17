# ADR 0002 — Grafo híbrido optimizado para trabajo agéntico

## Estado

Aceptado.

## Contexto

Un grafo puramente funcional es fácil de narrar pero no ofrece buenos límites de
ejecución. Un grafo separado siempre por frontend/backend produce tareas
artificiales, dependencias y costuras innecesarias.

## Decisión

La raíz expresa el objetivo del usuario. Los composites siguen boundaries reales
de integración y las hojas son cambios cohesivos e independientemente
verificables. Se permiten incrementos verticales que atraviesen capas.

La profundidad y anchura son irregulares. No existe una plantilla fija ni una
cantidad objetivo de nodos.

## Alternativas

- **Feature tree:** excelente para presentación, débil para integración.
- **Layer tree:** fácil de generar, alto acoplamiento entre tareas.
- **Hybrid boundary/vertical-slice:** elegida; equilibra ejecución, integración y
  comprensión.

## Consecuencias

- El planner necesita repository grounding real.
- Los nombres de nodos deben traducir boundaries técnicos a resultados
  comprensibles.
- Una hoja puede tener scope multi-layer.
- La demo de tres hijos root es decisión de fixture, no regla del producto.
