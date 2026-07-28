# 09 — Refactor de aceptación heredada retirado del mínimo

**What to build:** preservar el comportamiento productivo ya caracterizado y no
introducir un refactor sin efecto observable inmediatamente antes del freeze
experimental.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] No cambia ninguna decisión de granularidad ni asignación de intents antes
  del barrido N=4/N=8/N=16.
- [x] La duplicación queda registrada como deuda técnica, no como resultado ni
  limitación científica.
- [x] El veredicto de `validationDuplication` se deriva de los journals reales,
  no de este refactor.

## Scope disposition

El refactor original no producía evidencia para H1 o H2 y añadía riesgo de
cambiar el instrumento antes del freeze. Francisco autorizó retirar ese trabajo
del mínimo el 2026-07-28. Las dos implementaciones existentes se preservan sin
edición; ticket 12 medirá el comportamiento efectivo y declarará cualquier
limitación observada.
