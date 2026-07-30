# 02 — El replay de C1 es honesto

**What to build:** replayar un journal historico con condicion C1 o funciona fielmente, o falla ruidosamente; nunca se reinterpreta en silencio bajo la semantica de la politica C actual.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Regresion roja primero, que falle por la razon correcta: hoy un journal C1 se resuelve a C sin aviso.
- [x] Se elige y se documenta una de las dos salidas: replay fiel, o rechazo explicito.
- [x] Si se elige rechazo, la reachability muerta de la politica legacy se retira.
- [x] Los documentos que afirman que C1 sigue replayable quedan alineados con el codigo.

## Resolution — 2026-07-30

The explicit rejection path was selected. `resolveGranularityCondition` now
throws for historical `C1` and `C2` instead of silently mapping them to current
`C`; the unused legacy policy resolver was removed. RED was reproduced by the
updated policy regression before the implementation, then GREEN passed with
the policy, candidate-replay and adaptive-planning suites (11 tests) plus the
decomposer typecheck. Checkpoint-2 documentation now states the limitation.
