# @manyhands/orchestrator-graph

Package transicional que actualmente exporta `V2ExecutionDriver` y helpers de
ejecución. El nombre histórico ya no describe su implementación actual.

Las semánticas útiles del driver migran a `packages/run-engine`; este package se
retira después de mover todos sus callers y pasar las pruebas de reachability de
Stage 13. No define lifecycle, grafo, artifacts ni evidencia.

Fuente normativa: [Run Engine y disposición de módulos](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#912-run-engine-and-daemon).
