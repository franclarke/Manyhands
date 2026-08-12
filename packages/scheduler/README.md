# @manyhands/scheduler

Scheduler puro de readiness y selección de trabajo ejecutable.

El target selecciona un frontier continuo usando artifacts fresh, decisiones,
executor/sandbox capacity, budget y `ResourceClaim`. No maximiza cantidad de
nodos ni construye una matriz pairwise global. Toda decisión explica por qué
cada candidato fue seleccionado o bloqueado.

Fuente normativa: [Scheduler](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#96-scheduler).
