# Uso real de librerías y frameworks

> Una dependencia declarada no equivale a una responsabilidad arquitectónica.
> Esta guía explica qué aporta cada librería a la implementación actual y lo
> comprueba mediante imports, boundaries y tests reales.

## Resumen

| Librería/framework | Estado actual | Responsabilidad |
|---|---|---|
| Zod | uso productivo transversal | schemas, parsing de boundaries e invariantes estructurales |
| Next.js | uso productivo web | rutas HTTP, server/client composition y render del workspace |
| React | uso productivo web | estado local de interacción y composición de vistas |
| React Flow (`@xyflow/react`) | uso productivo como adapter visual | render de nodos/edges y controles explícitos de viewport |
| `simple-git` | uso productivo de infraestructura | adapter Git con `cwd` explícito |
| Vitest | verificación | unit, integration, filesystem/Git real y E2E de dominio |
| LangChain / LangGraph | removido del manifest, sin imports productivos | no participa en el control plane actual |

## Zod

### Por qué se eligió

TypeScript desaparece en runtime. ManyHands recibe JSON de usuarios, modelos,
disco y SSE; por eso necesita validar datos cuando cruzan un
boundary, no solo tiparlos durante compilación.

### Cómo se usa

1. **Uniones discriminadas para eventos.**
   [`RunEventSchema`](../../packages/run-coordinator/src/domain/events.ts) usa
   `z.discriminatedUnion("type", ...)`. Cada event type define un payload
   distinto y `.strict()` rechaza campos inesperados.
2. **Tipos derivados del schema.** Los tipos se obtienen mediante `z.infer`, de
   modo que parseo y TypeScript no evolucionan por separado.
3. **Invariantes cross-field.** [`TaskContractBundleSchema`](../../packages/contracts/src/contract-bundle.ts)
   usa `superRefine` para probar ownership, referencias/revisiones, participación
   en seams y cobertura de criterios obligatorios.
4. **Validación de grafo.** [`GraphRevisionSchema`](../../packages/task-graph/src/graph-revision.ts)
   valida forma; [`validateGraphRevision`](../../packages/task-graph/src/validate-v2.ts)
   agrega invariantes algorítmicas como ciclos, parents y endpoints.
5. **Output de modelos.** [`WorkBreakdownSchema`](../../packages/decomposer/src/planner/schema.ts)
   y [`WorkBreakdownProgressLineSchema`](../../packages/decomposer/src/planner/work-breakdown.ts)
   impiden que texto parcial o JSON con conceptos prohibidos entre al compiler.
6. **HTTP y persistencia.** [`RunCreateRequestSchema`](../../apps/web/src/lib/server/runs/schema.ts)
   valida intake; los stores vuelven a parsear al leer para que un archivo
   corrupto no se trate como estado válido.

Ejemplo representativo simplificado del patrón real:

```ts
const event = <T extends string, S extends z.ZodTypeAny>(type: T, payload: S) =>
  z.object({ ...BaseEventShape, type: z.literal(type), payload }).strict();

export const RunEventSchema = z.discriminatedUnion("type", [
  event("run.created", z.object({ goal: NonEmptyStringSchema }).strict()),
  event("decision.raised", z.object({ decision: DecisionInputSchema }).strict())
]);
```

### Qué no resuelve Zod

Zod no decide si una transición de lifecycle es legal, si un artifact es fresh
o si un grafo tiene ciclo. Esas políticas viven en reducer, adopción y
validadores de dominio. El schema garantiza forma; el dominio garantiza
significado.

### Evidencia

- [`contracts-v2.test.ts`](../../tests/contracts-v2.test.ts): paths inseguros,
  revisiones y referencias imposibles.
- [`task-graph-v2.test.ts`](../../tests/task-graph-v2.test.ts): forma y semántica
  del grafo.
- [`run-store-event-source.test.ts`](../../tests/run-store-event-source.test.ts):
  parsing de envelopes persistidos.

## LangChain y LangGraph

### Estado de uso actual

LangChain y LangGraph no intervienen en la ruta productiva ni siguen declaradas.
La evidencia es directa:

- `rg '@langchain|StateGraph|Annotation|interrupt\(' apps packages --glob '*.ts' --glob '*.tsx'`
  no encuentra imports productivos;
- `apps/web/package.json` ya no declara `@langchain/core` ni `@langchain/langgraph`;
- [`run-coordinator-boundaries.test.ts`](../../tests/run-coordinator-boundaries.test.ts)
  prohíbe explícitamente importar LangGraph desde el dominio.

Por lo tanto, LangChain/LangGraph no forman parte del sistema. El control
productivo se reparte entre:

- [`RunCoordinator`](../../packages/run-coordinator/src/coordinator.ts):
  comandos, eventos y lifecycle;
- [`V2ExecutionDriver`](../../packages/orchestrator-graph/src/v2/execution-driver.ts):
  readiness, waves y dispatch;
- hosts de [`apps/web/src/lib/server/runs/v2/`](../../apps/web/src/lib/server/runs/v2/):
  wiring, leases y adapters concretos.

El diseño evita que un framework sea propietario del lifecycle. El coordinator
decide la transición de dominio, el driver decide qué trabajo puede avanzar y
los hosts ejecutan los side effects. Los checkpoints de una librería no son el
mecanismo actual de recovery: el replay se realiza desde el event journal.

Las dependencias fueron removidas de `apps/web/package.json`; una adopción futura
sería una decisión explícita. El contexto histórico y el criterio para una
eventual integración están aislados en
[`../design/langgraph-orchestrator-design.md`](../design/langgraph-orchestrator-design.md),
fuera del recorrido necesario para comprender el sistema actual.

## Next.js

### Cómo se usa

ManyHands usa App Router como capa de transporte y composition root:

- [`POST /api/runs`](../../apps/web/src/app/api/runs/route.ts) valida intake,
  persiste metadata e inicia planning en background;
- rutas bajo [`api/runs/[id]/`](../../apps/web/src/app/api/runs/[id]/) traducen
  decisiones, pause/resume, cancelación y delivery a commands de dominio;
- [`runs/[runId]/page.tsx`](../../apps/web/src/app/runs/[runId]/page.tsx) carga el
  seed/proyección del run;
- componentes con `"use client"` mantienen selección, lentes, dialogs/sheets y
  viewport local.

`NextResponse` y route handlers pertenecen al borde. Ningún tipo de Next.js
entra en `packages/run-coordinator`; esto se verifica con el boundary test.

### Estrategia

El servidor responde commands con la proyección confirmada y el cliente aprende
la evolución por snapshot/eventos. No se usa estado optimista para afirmar
`verified`, `completed` o `resolved` antes del hecho durable.

## React y React Flow

### React

React compone el workspace y mantiene únicamente interacción local: nodo
seleccionado, lente activa, inspector abierto o minimapa visible. El modelo del
run proviene de [`buildRunModel`](../../apps/web/src/lib/run-model/reducer.ts),
no de múltiples `useState` de negocio.

### React Flow

`@xyflow/react` renderiza la proyección preparada por código propio:

- [`layoutRunTree`](../../apps/web/src/lib/run-model/tree-layout.ts) calcula
  posiciones sin React Flow;
- [`buildRelationViews`](../../apps/web/src/lib/run-model/presentation.ts)
  agrupa y filtra relaciones sin mutar `GraphRevision`;
- [`cockpit-run-graph.tsx`](../../apps/web/src/app/runs/[runId]/_components/cockpit-run-graph.tsx)
  convierte esas vistas a `Node[]` y `Edge[]`.

`useReactFlow()` se utiliza para acciones de viewport controladas:

- `setCenter` una sola vez en `onInit`;
- `fitView` desde el botón `Encuadrar` o, mientras el switch `Autoencuadre`
  permanece activo, cuando cambia la firma de IDs de nodos.

No se usa `fitView` como prop ni se depende del modelo completo: estado,
selección, lentes y actividad conservan el viewport. La regresión
[`run-canvas-no-auto-fit.test.ts`](../../tests/run-canvas-no-auto-fit.test.ts)
inspecciona el default activado y la dependencia exclusivamente estructural.

### Por qué React Flow no es dominio

React Flow puede cambiar cómo se dibuja un edge, pero no puede cambiar que un
`ArtifactRequirement` afecta readiness y un `SeamBinding` no. Esa semántica vive
en `task-graph` y `scheduler`.

## simple-git y Git nativo

[`SimpleGitRunner`](../../packages/execution-core/src/git/runner.ts) encapsula
`simple-git` y exige un `cwd` explícito para cada operación. Esto reduce comandos
shell construidos manualmente y mantiene el adapter sustituible.

No toda operación usa `simple-git.raw()`: cuando una salida no-cero es un
resultado semántico esperado —por ejemplo `merge-base --is-ancestor`— el adapter
usa un proceso controlado para distinguir `false` de un fallo operacional. Git
sigue siendo la autoridad de diff/commit; `simple-git` solo es el cliente.

Los tests [`integration-real-git.test.ts`](../../tests/integration-real-git.test.ts)
y [`execution-core-worktree.test.ts`](../../tests/execution-core-worktree.test.ts)
usan repositorios temporales reales, no mocks de strings.

## Vitest

Vitest se usa en cuatro niveles:

1. **Schemas/políticas:** contratos, fingerprints y recovery.
2. **Integración de adapters:** filesystem, event store, worktrees y Git real.
3. **Boundaries:** dependencias prohibidas entre paquetes.
4. **E2E de dominio:** [`run-v2-e2e.test.ts`](../../tests/run-v2-e2e.test.ts)
   compila un grafo, ejecuta hojas, materializa artifacts hijos, integra la raíz
   y alcanza `result_ready`.

Los tests no sustituyen un smoke productivo con CLIs reales. Por eso la
documentación separa cobertura E2E automatizada de una auditoría manual. El
nombre del test conserva `v2` como identificador interno; la garantía relevante
es el recorrido que verifica.

## Regla para futuras dependencias

Antes de afirmar que una librería “forma parte de la arquitectura” deben existir
las tres evidencias siguientes:

1. import productivo o adapter concreto;
2. responsabilidad delimitada que no duplique dominio;
3. test que pruebe el boundary o comportamiento aportado.

El package manifest por sí solo demuestra instalación, no utilización.
