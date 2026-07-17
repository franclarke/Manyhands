# ADR 0008 — Decisiones humanas locales y grafo centrado

## Estado

Aceptado.

## Contexto

Los gates dispersos y bloqueantes eliminan el valor del paralelismo. Un panel
global separado obliga a buscar contexto; un popup modal automático interrumpe
la observación y mueve atención fuera del grafo.

## Decisión

`Decision` es una entidad versionada con affected nodes, evidence e impact. Solo
bloquea readiness dependiente. La UI muestra tarjeta horizontal contextual y
abre un dialog al accionar `Responder`; una cola global permite recorrer
pendientes.

El canvas no recentra ni enfoca automáticamente. La evidencia se vuelve central
al final del run.

## Alternativas

- **Gate global por decisión:** seguro en apariencia, costoso e innecesario.
- **Notification center independiente:** escalable, pero pierde causalidad.
- **Decisión anclada + cola:** elegida.

## Consecuencias

- Backend debe calcular alcance bloqueado de forma real.
- `waiting_for_input` solo aplica cuando no queda trabajo ready.
- UI necesita foco, teclado, CAS conflict y expired states.
- Se eliminan superficies primarias separadas de Tasks/Planning/Integration/
  Interfaces.
