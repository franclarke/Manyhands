# Handoff operativo — Stage 5 cerrado, Stage 6 elegible

## Estado de entrada

- **Branch:** `codex/correctness-first-full-implementation`
- **Stage 5 / GP0+GP1:** `pass`
- **Accepted code candidate:** `94a3f27d959225643e4e0bdb6f3981c61ef0a7b5`
- **Accepted tree:** `6fc75ab60e3f8739e0ad9b9b7c55c040cc8f2eae`
- **Audit:** [`../audits/stage-5/README.md`](../audits/stage-5/README.md)
- **Stage 6:** `not_started`

Este handoff no inicia Stage 6. Sólo registra su frontera de entrada después de
aprobar offline una representación semántica, verifier y compiler directos.

## Qué ya existe

- `PlanningEngine.plan/expand/amend/continue` con outcomes tipados, presupuesto
  inmutable y continuations ligadas a revisions, drafts, opciones y decisiones;
- un único `SemanticPlan` canónico para outputs `ready`;
- verifier determinista de hierarchy/granularity, criteria/proof lineage,
  resources/version chains, evidence exacta, generated policy, seams,
  artifacts y cycles;
- compiler directo `SemanticPlan -> GraphRevision` y contracts derivados;
- evaluator diferencial y preview standalone/read-only;
- dos outputs reales GP1 atribuibles con topology/browser oracles pass.

## Qué Stage 6 debe hacer

Stage 6 realiza el cutover productivo de planning y scheduling:

1. componer el `PlanningEngine` en el daemon como único producer productivo de
   `SemanticPlan`;
2. verificar y compilar directamente a `GraphRevision` antes de persistir una
   revisión aceptada;
3. retirar de la ruta productiva `RecursivePlanner`, `WorkBreakdown`, la
   proyección legacy y el compiler legacy, manteniendo sólo readers históricos
   con consumer/retiro explícitos;
4. implementar `ReadinessEvaluator` sobre prerequisites, exact input versions,
   decisions, resource ownership y runtime leases;
5. retirar pairwise conflict-risk/scheduling heurístico sólo cuando los nuevos
   invariantes productivos estén verdes;
6. preservar ownership del lifecycle en daemon, query purity, command
   idempotency, cancellation/recovery y RepositoryView exacta.

## Límites

Stage 6 no debe:

- rediseñar artifacts/attempts, sandbox, validation, integration o delivery de
  Stages 7–10;
- convertir findings advisory del modelo en autoridad;
- derivar scopes/contracts fuera del `SemanticPlan`;
- usar outputs GP1 como implementación o prueba estadística;
- iniciar el experimento post-GProd ni modificar la tesis.

## Entrada recomendada

Antes de editar, releer `PRODUCT.md`, `AGENTS.md`, el plan canónico completo,
[`../audits/stage-5/README.md`](../audits/stage-5/README.md), este handoff y la
ruta productiva actual en `apps/daemon`. Trazar primero planning, graph
compilation y scheduling productivos; escribir REDs de reachability/dual
representation antes del cutover.
