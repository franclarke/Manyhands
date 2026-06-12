# ManyHands

ManyHands es un sistema de orquestación de agentes LLM para desarrollo de
software. Toma una feature descrita en lenguaje natural, la descompone en un DAG
jerárquico de tareas con contratos de interfaz explícitos, ejecuta hojas en git
worktrees aislados con agentes CLI headless, e integra los resultados de abajo
hacia arriba con cherry-pick y reparación semántica.

No es un coding agent. Es la capa que coordina agentes: decide qué trabajo
existe, qué dependencias hay entre partes, qué archivos puede tocar cada agente,
cómo se supervisa el trabajo paralelo y cómo se valida e integra cada resultado.

![Command Center: prompt de feature, configuración del run](docs/img/img1.png)

![Run workspace: DAG interactivo con inspector](docs/img/img2.png)

---

## Estado Actual

El foco vigente del repositorio es terminar el producto y estabilizar la sala de
control agent-first. La estrategia de evaluación académica o de benchmarks queda
deliberadamente fuera del plan actual: se diseñará desde cero cuando el producto
esté completo y sea claro qué calidad queremos medir.

Consecuencias prácticas:

- No hay una benchmark suite activa.
- No existe un directorio `benchmarks/` en el árbol actual.
- Las rutas antiguas de Lab/Replay y los benchmarks determinísticos
  `mock-v0`/`conflict-v0` fueron retirados.
- Los ADRs viejos sobre evaluación, Lab Mode y granularidad experimental son
  historia del proyecto, no instrucciones vigentes.
- El nombre `GranularityVector` sigue existiendo en el código por compatibilidad,
  pero hoy debe leerse como métricas operativas del run, no como metodología de
  tesis cerrada.

## Producto

La cara visible es una web app en Next.js orientada a inspección y control de
runs.

- `/` — Command Center: describir la feature, elegir workspace, modelo y nivel de
  granularidad.
- `/workspaces` — configurar repositorios locales donde ManyHands puede trabajar.
- `/runs/[runId]` — sala de control agent-first: canal de decisiones, superficie
  del DAG, foco on-demand, evidencia operativa y stream de eventos.
- `/runs/proto/[fixture]` — prototipos con golden fixtures del modelo de UI. Son
  fixtures de regresión de eventos, no benchmarks de calidad.

Flujo principal:

1. El usuario describe la feature y crea el run.
2. El `GeminiRecursiveDecomposer` genera un `TaskGraph` con contratos e
   interfaces compartidas entre tareas.
3. El usuario revisa el plan y lo aprueba.
4. El orquestador despacha hojas en worktrees aislados.
5. Cada hoja ejecuta un agente CLI, se valida con scope/tests, y el orquestador
   captura `git diff HEAD` como fuente de verdad.
6. El Composer integra resultados con cherry-pick y repair semántico si hay
   conflictos.
7. El run persiste eventos, evidencias, diffs y métricas operativas.

## Arquitectura Del Monorepo

```text
apps/
  web/                  Next.js App Router — Command Center y Run workspace

packages/
  task-graph/           TaskNode, TaskGraph, DAG, validación, topo sort
  contracts/            AgentTaskContract, InterfaceContract, scopes
  decomposer/           Decomposición recursiva interface-aware
  orchestrator-graph/   StateGraphs de planning/ejecución y checkpoints
  execution-core/       Worktrees, executors, scope, recorder, integration
  scheduler/            Waves y políticas de selección de tareas
  run-store/            RunSnapshot, patches, persistencia JSON
  trace-store/          TraceEvent de planning y ejecución
  conflict-risk/        Predicción de riesgo entre hojas
  repository-index/     Índice estructural del repo
  shared/               EntityId, IsoTimestamp, helpers
  core/                 Barrel legacy — no usar para código nuevo

docs/
  system/               Cómo funciona cada componente actual
  design/               Rediseño agent-first y modelo operativo
  development/          Visión de producto y arquitectura viva
  adr/                  Registro histórico de decisiones
  DECISIONS.md          Síntesis de decisiones vigentes
```

Dirección de dependencias: `apps → packages específicos → shared`. `@manyhands/core`
queda como barrel legacy; el código nuevo debe depender de paquetes específicos.

## Stack

- TypeScript
- pnpm workspaces
- Next.js 15, React 19, Tailwind CSS 4
- `@xyflow/react` para visualización de DAG cuando aplica
- LangGraph.js para la orquestación de planning/ejecución
- Zod para validación de runtime
- Vitest, tsup
- Gemini CLI como executor principal configurado por `MANYHANDS_GEMINI_BIN`

## Primeros Pasos

```bash
pnpm install
pnpm build
pnpm web:dev    # http://localhost:3000
```

Para ejecutar runs reales hace falta tener Gemini CLI instalado y en `PATH`, o
configurar `MANYHANDS_GEMINI_BIN`.

## Verificación

```bash
pnpm test
pnpm build
pnpm web:typecheck
```

## Documentación

| Documento | Para qué sirve |
|-----------|----------------|
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Síntesis de decisiones vigentes para agentes |
| [`docs/system/`](docs/system/) | Explicación componente por componente del sistema actual |
| [`docs/design/`](docs/design/) | Modelo agent-first, event log, run model y UX objetivo |
| [`docs/development/architecture.md`](docs/development/architecture.md) | Vista de arquitectura desde el código actual |
| [`docs/development/product-vision.md`](docs/development/product-vision.md) | Visión de producto sin estrategia de benchmarks activa |
| [`docs/adr/`](docs/adr/) | Registro histórico; algunos ADRs están superseded |
| [`apps/web/README.md`](apps/web/README.md) | Rutas y APIs actuales de la web app |

