# @manyhands/execution-core

Package operativo actual para Git/workspaces, executors, scope, candidatos,
validación e integración.

El rediseño lo profundiza detrás de interfaces pequeñas para `AttemptRunner`,
artifact building/materialization, `ValidationEngine`, `CompositeIntegrator` y
`SandboxProvider`. Commits quedan como procedencia; los handoffs productivos
pasan a manifests acotados. Worktree y sandbox se reportan por separado.

Fuente normativa: [diseño de ejecución y Stages 7–10](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#97-artifact-builder-registry-and-execution-base).
