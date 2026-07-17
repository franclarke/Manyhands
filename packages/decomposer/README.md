# @manyhands/decomposer

Implementación actual de descomposición recursiva y schemas LLM. El camino
productivo actual debe verificarse en código; no asumir providers desde docs
históricos.

## Dirección objetivo

Separar dos responsabilidades dentro del boundary de planning:

- `Planner`: produce un `WorkBreakdown` semántico grounded.
- `GraphCompiler`: materializa GraphRevision, relaciones, contracts, scopes y
  validation obligations.

Los critics validan completitud, atomicidad, graph, contracts, scope, validation
y riesgo. La falla de modelo se reporta; no hay fallback silencioso a un plan de
otra calidad.

La granularidad deja de ser un selector central de producto. La atomicidad se
decide por cohesión, contexto, outputs y verificabilidad.

Los decomposers deterministas actuales pueden seguir como test fixtures, nunca
como reemplazo silencioso del camino real.

Contrato objetivo: [`docs/system/03-decomposer.md`](../../docs/system/03-decomposer.md).
