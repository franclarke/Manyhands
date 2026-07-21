# ADR 0008 — Decisiones humanas locales y grafo centrado

## Estado

Aceptado.

## Contexto

Los gates dispersos y bloqueantes eliminan el valor del paralelismo. Un panel
global separado obliga a buscar contexto; un popup modal automático interrumpe
la observación y mueve atención fuera del grafo.

## Decisión

`Decision` es una entidad versionada con affected nodes, evidence e impact. Solo
bloquea readiness dependiente. La UI muestra una tarjeta horizontal en la cola
global; al accionar `Revisar` selecciona el nodo afectado y usa el inspector
contextual como superficie resolutiva.

El canvas no recentra ni enfoca automáticamente. La evidencia se vuelve central
al final del run.

## Alternativas

- **Gate global por decisión:** seguro en apariencia, costoso e innecesario.
- **Notification center independiente:** escalable, pero pierde causalidad.
- **Decisión anclada + cola:** elegida.

## Consecuencias

- Backend debe calcular alcance bloqueado de forma real.
- `waiting_for_input` solo aplica cuando no queda trabajo ready.
- UI necesita foco, teclado, CAS conflict y expired states en inspector/sheet.
- Se eliminan superficies primarias separadas de Tasks/Planning/Integration/
  Interfaces.

El cambio de dialog a inspector y el uso de lentes del grafo se detalla en
[`0010`](0010-graph-lenses-and-decision-inspector.md).
