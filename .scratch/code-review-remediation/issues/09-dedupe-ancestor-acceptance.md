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

## Closure record

- Fixed point: `eeb2f89b0657c160720e7212bc517075cab3ccaf`.
- Scope decision commit: `0cb3fc33f08c6d91b17f1f64a37236ce201b918f`.
- Review remediation commit: `f8e615eb9b822d5c98f4a58de96f8e08261dd3ab`.
- Files changed: este ticket, `docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md` y
  `docs/tesis/HANDOFF.md`; no cambió ninguna ruta productiva de aceptación.
- Verification:
  - no cambió ninguna decisión de granularidad ni asignación de intents;
  - ticket 12 conserva la obligación de derivar `validationDuplication` de
    journals reales;
  - `git diff --check` PASS para el recorte documental.
- Independent review at the scope decision:
  - Spec: PASS.
  - Standards: FAIL por trazabilidad transversal incompleta; sus hallazgos se
    corrigen antes del cierre final de revisión.
- Next unlocked frontier: tickets 02 y 10; se prioriza 10 porque produce la
  evidencia discriminante y 02 sólo bloquea la síntesis histórica de ticket 14.
