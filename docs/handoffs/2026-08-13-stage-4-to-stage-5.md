# Handoff operativo — Stage 4 cerrado, Stage 5 listo para iniciar

## Estado exacto

- **Repositorio:** `C:\Users\franc\Documents\Proyectos\Manyhands`
- **Branch:** `codex/correctness-first-full-implementation`
- **Stage 4 code candidate:** `292daaee3803404cdb473f929c1fbfa36a8b4964`
- **Candidate tree:** `8cd98afa812d3e7927985d6edf99c1744e4b5f5d`
- **Stage 4 documentation HEAD de entrada:**
  `2015f35d60f17bf3d7a53e144d1c48fe407f839a`
- **GRepo:** `pass`
- **Stage 5 / GP0+GP1:** `not_started`
- **Stages 6–11:** `not_started`

La evidencia que cierra GRepo está en
[`docs/audits/stage-4/README.md`](../audits/stage-4/README.md). Las decisiones
D5.1–D5.4 en el
[plan canónico](../plans/2026-08-12-correctness-first-system-redesign.md)
son normativas. Este handoff sólo las vuelve ejecutables: no inicia Stage 5 ni
autoriza el cutover de Stage 6.

## Configuración recomendada

- **conductor:** `gpt-5.6-sol`, razonamiento `ultra`;
- **workers:** `gpt-5.6-sol`, `high` salvo contratos/compilador compartidos;
- **concurrencia:** conductor más hasta dos agentes con ownership disjunto;
- **reviewer:** uno independiente, read-only, acotado a GP0+GP1;
- **modelos live:** cero durante implementación/GP0 y exactamente las dos
  sesiones offline pre-registradas de D5.4 para GP1;
- **reintentos de modelo:** ninguno sin cambio causal registrado.

`ultra` se justifica en el conductor porque Stage 5 cambia la frontera entre
semántica, autoridad determinista y mecánica de compilación. El paralelismo se
usa sólo después de congelar los contratos compartidos.

## Lectura obligatoria antes de editar

1. [`PRODUCT.md`](../../PRODUCT.md).
2. [`AGENTS.md`](../../AGENTS.md).
3. [Plan correctness-first canónico](../plans/2026-08-12-correctness-first-system-redesign.md),
   completo, con foco en §§ 7.1–7.2, 8.3–8.4, 9.2–9.4, D5.1–D5.4 y Stage 5.
4. [Runbook de ejecución](../agents/correctness-first-execution.md).
5. [Stage 0 baseline](../audits/stage-0/README.md),
   [productive route](../audits/stage-0/productive-route.md) y
   [transition ledger](../audits/stage-0/transition-ledger.md).
6. [Stage 1 / G1](../audits/stage-1/README.md).
7. [Stage 2 / GD0+GD1](../audits/stage-2/README.md).
8. [Stage 3 / GR](../audits/stage-3/README.md).
9. [Stage 4 / GRepo](../audits/stage-4/README.md).
10. Este handoff nuevamente después de recorrer source y tests actuales.

## Objetivo normativo

Probar offline una única representación semántica antes del cutover:

```text
GoalContract + exact RepositoryView + bounded query port
  -> PlanningEngine.plan / expand / amend
  -> explicit PlanningResult
  -> ready SemanticPlan
  -> deterministic verifyPlan
  -> pure compilePlan
  -> canonical GraphRevision + derived contracts
  -> offline topology/browser evaluation
```

La ruta productiva actual permanece intacta hasta Stage 6.

## Decisiones cerradas

### D5.1 — Resultados

La unión pública es `ready | needs_input | ambiguous | unsupported | rejected`.
Sólo `ready` contiene un `SemanticPlan` compileable. Drafts, alternativas y
continuations no son otra representación canónica.

### D5.2 — Material contractual

El `SemanticPlan` contiene la semántica suficiente para derivar contratos de
nodes, seams, artifacts, validation e integration. No existe `PlanBundle`, lista
paralela ni reconstrucción mediante `WorkBreakdown`.

### D5.3 — Presupuesto y progreso

Un presupuesto único limita model calls, queries, bytes, revisions, repairs y
expansions. Cada revisión tiene lineage y causa. Sin nueva evidencia, decisión,
finding o propuesta semántica, el engine termina con outcome tipado; no repite.

### D5.4 — Evidencia GP1

GP0 usa fakes y outputs grabados. GP1 pre-registra exactamente dos repositorios
reales y un goal por repositorio, luego permite una sesión offline atribuible
por caso con un provider/model/profile fijo. Sin esas dos salidas, GP1 queda
`not_run`; nunca se sustituye con una fixture.

## Estado real del source

Fundación disponible:

- `@manyhands/contracts` ya contiene `GoalContract`, `ProofStrategy`,
  `SemanticPlan` y relaciones canónicas;
- `@manyhands/repository-index` expone views, catalog y queries acotadas;
- `@manyhands/task-graph` ya construye y valida `GraphRevision` canónico;
- el daemon registra grounding productivo con provenance.

Gaps a cerrar:

- `PlanningModule` y `RecursivePlanner` mantienen modelos/resultados previos;
- existen dos shapes llamados `SemanticPlan`;
- el compiler actual proyecta a `WorkBreakdown` y produce
  `LegacyGraphRevisionV2`;
- verifier/critics actuales mezclan semántica con estructuras legacy;
- no existen budgets/revision lineage/no-progress comunes;
- no existe harness diferencial offline con oráculos GP1 pre-registrados.

## Slices TDD y ownership

### Slice A — contratos compartidos

**Owner único:** `packages/contracts` y exports compartidos de decomposer.

Crear REDs para taxonomía, compileability, material contractual, normalización,
digest, budget y revision lineage. No asignar compiler/engine a otro writer hasta
estabilizar esta seam.

### Slice B — verifier y compiler deterministas

**Ownership:** `packages/decomposer/src/verifier`,
`packages/decomposer/src/compiler` target y tests focales; `packages/task-graph`
sólo si una regresión demuestra un invariante canónico ausente.

- `verifyPlan` se ejecuta antes de compilar y devuelve findings estables;
- `compilePlan` es puro, no llama modelos ni queries y no repara semántica;
- salida directa al `GraphRevision` canónico;
- propiedades: determinismo, pérdida semántica cero, refs/digests exactos;
- double writers, proof authority ausente y ciclos fallan antes de compilar.

### Slice C — Progressive Planning Engine

**Ownership:** nuevo módulo cohesivo bajo `packages/decomposer/src/planning-engine`
y tests; consume contracts/verifier/compiler ya congelados.

- implementar `plan`, `expand`, `amend`;
- inyectar `RepositoryQuery` read-only y proposal-model port;
- fan-out normal 2–5 sin convertirlo en requisito;
- local repair causal y acotado;
- model critic consultivo, sin autoridad para aprobar/rechazar;
- no-progress y budget exhaustion terminales.

### Slice D — evaluación offline

**Ownership:** harness/tests/evidence de Stage 5; no tocar la ruta productiva.

- fixtures tiny, cross-package, generated, ambiguous y unsupported;
- celdas R4 y R5;
- comparación diferencial sobre exact goal/view/oracle;
- oráculos de topología y browser committed antes de resultados;
- preview read-only del `GraphRevision`, sin comandos al daemon;
- dos sesiones GP1 exactas y evidencia atribuible.

## Gate

### GP0

- accepted plans satisfacen todos los invariantes;
- double writers, missing proof authority, unknown write overlap y ciclos
  bloquean antes del compiler;
- base/view/budget idénticos producen plan/graph/findings/digests idénticos;
- compilation es semánticamente lossless;
- `ambiguous`, `unsupported`, budget exhaustion y no-progress terminan
  explícitamente.

### GP1

- dos repositorios y goals pre-registrados, con SHA/tree/view exactos;
- topología evaluada por responsabilidades/seams/ownership/proof, no node count;
- browser preview visible y comprensible;
- model critic no decide autoridad;
- planner actual usado sólo como comparator;
- dos sesiones iniciales máximas; cualquier repetición registra cambio causal.

## Límites

Stage 5 no debe:

- modificar la composición productiva del daemon;
- retirar `RecursivePlanner`, `WorkBreakdown` o el compiler legacy;
- cambiar scheduling/readiness de Stage 6;
- implementar artifacts, sandbox, integration o delivery de Stages 7–10;
- iniciar el experimento post-GProd ni modificar la tesis;
- ejecutar benchmarks amplios o comparar múltiples modelos.

## Verificación final esperada

- suites focales de contracts, verifier, compiler y planning engine;
- property/adverse tests de GP0;
- evaluación diferencial y browser/topology oracles de GP1;
- regresión completa GRepo y gates previos relevantes;
- root/package/app typechecks y builds afectados;
- Next build sólo si el preview offline toca web;
- lint acotado, suite completa `--retry=0`, `git diff --check`;
- una revisión independiente acotada;
- audit `docs/audits/stage-5/README.md`, estado GP0+GP1 atribuible y commits
  focales;
- detenerse antes de Stage 6.

Si GP0 pasa pero faltan las dos sesiones atribuibles, registrar GP1 como
`not_run` y Stage 5 como incompleto. No reducir autoridad, provenance ni
oráculos para cumplir fecha o presupuesto.
