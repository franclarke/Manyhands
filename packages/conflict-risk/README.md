# @manyhands/conflict-risk

Predicción actual de riesgo pairwise a partir de contratos, scopes y señales del
repository index.

## Dirección objetivo

El package produce evidencia para `ConflictConstraint` y decisiones de
scheduling. No debe:

- crear dependencies funcionales;
- recomendar `add_dependency` sin pasar por Graph Compiler;
- tratar un SeamBinding compatible como conflicto;
- convertir falta de información en riesgo bajo;
- afirmar corrección semántica.

Las señales conservan source, freshness, confidence y rationale. El scheduler
decide cómo actuar según política y presupuesto.

API actual destacada: `buildTaskPairRiskMatrix`, `predictConflict`,
`buildStaticConflictSignals`, `findRiskPrediction`.

Contrato objetivo: [`docs/system/13-conflict-risk.md`](../../docs/system/13-conflict-risk.md).
