# Stage 6 — Cutover productivo de planificación y frontier

**Gate:** GS  
**Status:** `pass`  
**Accepted code candidate:** `02f05e4cc320a11a0a1c762e2a2faa04d4bc1af0`  
**Accepted candidate tree:** `02c14934156ec6c1d76545952ff75e582ec05367`  
**Base Stage 5:** `94a3f27d959225643e4e0bdb6f3981c61ef0a7b5`  
**Branch:** `codex/correctness-first-full-implementation`  
**Captured:** 2026-08-13 (`America/Buenos_Aires`)

Este registro cierra exclusivamente Stage 6 del
[plan correctness-first](../../plans/2026-08-12-correctness-first-system-redesign.md).
No inicia Stage 7, no ejecuta modelos live, no ejecuta el experimento y no
modifica la tesis.

## Resultado

La ruta productiva del daemon ahora conserva una sola cadena de planificación y
ejecución:

```mermaid
flowchart LR
  V["RepositoryView exacto"] --> P["PlanningEngine"]
  P --> S["SemanticPlan"]
  S --> C["compilePlan directo"]
  C --> G["GraphRevision"]
  G --> R["ReadinessEvaluator"]
  R --> F["SelectionPolicy"]
  F --> E["CanonicalExecutionDriver"]
```

- `apps/daemon/src/current-lifecycle-adapters.ts` compone `PlanningEngine` y
  persiste el `SemanticPlan` canónico junto con el `GraphRevision` compilado;
  no llama `RecursivePlanner`, `WorkBreakdown`, proyección legacy ni compiler
  legacy.
- `planning.completed` tiene una rama canónica con `semanticPlan`; el reader
  conserva la rama histórica de breakdown exclusivamente para replay de
  journals anteriores.
- `apps/daemon/src/transitional-unsafe-worker.ts` valida `GraphRevision`, lo
  liga al `RepositoryView` exacto capturado durante planning y utiliza
  `CanonicalExecutionDriver`. No carga `LegacyGraphRevisionV2` ni construye
  `conflictConstraints`.
- `ReadinessEvaluator` verifica artifacts por `(id, revision)`, decisiones
  afectadas, contratos disponibles, writers activos, leases de runtime,
  capacidad y presupuesto. Un overlap desconocido con writer bloquea la
  frontera; no se serializa como sustituto de autoridad.
- `SelectionPolicy` recibe sólo elementos ya listos. Evalúa riesgo contra el
  conjunto seleccionado y acotado por seams, preservando sus IDs de evidencia;
  el riesgo sólo difiere concurrencia/orden. Colisiones de resource/lease son
  precondiciones duras, no scores.
- `CanonicalNodeExecutor` adapta el executor transicional con el grafo directo
  y el commit objetivo. No reconstituye una proyección legacy ni una matriz de
  conflictos.

Los exports V2 y sus tests permanecen como compatibilidad histórica aislada.
Las rutas productivas testeadas no los alcanzan; su retiro físico definitivo
queda ligado al cierre de los consumers históricos, no se introdujo un nuevo
producer legacy.

## Gate GS

| Obligación | Evidencia |
|---|---|
| Sin proyección legacy/pairwise en ruta viva | `stage6-productive-cutover-boundary.test.ts` hace scan de planner, worker, aplicación, driver y scheduler productivos. |
| Readiness explicable | `stage6-canonical-frontier.test.ts`: artifact exacto, decisión acotada, writer unknown y lease incompatible. |
| Riesgo no cambia validez | El mismo test compara score bajo/alto: cambia la concurrencia pero no el ready-set. |
| Decisión afecta sólo su nodo | La decisión pendiente en `unit:a` deja `unit:b` listo cuando tiene su artifact. |
| Sin serialización de writer conflictivo | La colisión de writers se difiere como `resource_claim_conflict`, no como `IntegrationRiskEstimate`. |
| Ejecución productiva directa | `stage6-canonical-execution-driver.test.ts` ejecuta `GraphRevision` con executor fake, adopta artifacts declarados y llega a candidato final; su caso adverso persiste una decisión y no reintenta/adopta. |

## TDD e incidentes

- La primera RED del frontier falló porque `evaluateReadiness` todavía no
  existía; la implementación posterior deja 5 regresiones verdes.
- La primera RED del driver falló porque `CanonicalExecutionDriver` no estaba
  exportado; la ruta directa tiene ahora 2 regresiones verdes.
- El helper de respuesta fake inicialmente emitía la forma del planner viejo y
  luego proof bindings incompletos; se cambió por material `SemanticPlan` y
  bindings determinísticos de ProofStrategy antes de aceptar la ruta.
- El typecheck raíz detectó cuatro reemplazos con capturas regex posiblemente
  `undefined` en el helper; se validaron las dos capturas antes de renderizar.
- Los intentos de suite total y build completo del daemon que excedieron el
  límite de 60 s del host terminaron por cierre del pipe (`EPIPE`). No se
  contabilizan como pass ni como defecto de producto. Los checks focales,
  typechecks y builds por paquete se ejecutaron por separado.

## Verificación

**Toolchain:** Windows; Node `22.22.0`; Vitest `2.1.9`; TypeScript `5.9.3`;
tsup `8.5.1`.

| Check | Resultado |
|---|---|
| Focal Stage 6 + grounding | 4 archivos, 10 tests pass, `--retry=0`. |
| Compatibilidad Stage 3 | 2 archivos, 9 tests pass, `--retry=0`. |
| Compatibilidad execution V2 | 3 archivos, 81 tests pass, `--retry=0`. |
| TypeScript | Root, daemon, scheduler, orchestrator-graph, execution-core, run-coordinator y task-graph: pass. |
| Builds ESM/CJS/DTS | scheduler, orchestrator-graph y execution-core: pass. |
| Source reachability | scan productivo: cero tokens de proyección legacy, selector V2 o matriz pairwise. |
| Git | `git diff --check`: pass; worktree limpio antes del commit documental. |

Comandos representativos:

```powershell
$runtime = 'C:\mh-runtime-c781-09\node-v22.22.0-win-x64'
$env:Path = "$runtime;$env:Path"

pnpm.cmd exec vitest run tests\stage6-canonical-frontier.test.ts `
  tests\stage6-canonical-execution-driver.test.ts `
  tests\stage6-productive-cutover-boundary.test.ts `
  tests\stage4-productive-grounding.test.ts --retry=0
pnpm.cmd exec tsc -p tsconfig.json --noEmit
pnpm.cmd --filter @manyhands/daemon typecheck
pnpm.cmd --filter @manyhands/scheduler build
pnpm.cmd --filter @manyhands/orchestrator-graph build
pnpm.cmd --filter @manyhands/execution-core build
git -c core.whitespace=cr-at-eol diff --check
```

## Límites y siguiente frontera

- La suite total queda como verificación amplia pendiente de una terminal sin
  límite de 60 s; su intento abortado no es evidencia verde.
- El executor conserva internals transicionales por alcance: Stage 7 reemplaza
  el transporte commit-as-artifact y afina attempts/evidence exacta.
- Los readers V2 históricos siguen explícitamente fuera de reachability
  productiva. No se debe reintroducirlos en daemon/web.

Stage 7 permanece `not_started`.
