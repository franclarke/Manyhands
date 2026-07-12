# ManyHands — Guía Operativa para Claude Code

> Comunicación con Francisco: español. Código, nombres de APIs y términos
> técnicos: inglés.
> Fuente de verdad de decisiones vigentes: [`docs/DECISIONS.md`](docs/DECISIONS.md).
> Documentación técnica actual: [`docs/system/`](docs/system/).
> Rediseño agent-first de UI/orquestación: [`docs/design/`](docs/design/).

---

## 1. Qué Es ManyHands

ManyHands es un sistema de orquestación de agentes LLM para desarrollo de
software. Toma una feature en lenguaje natural, la descompone en un DAG
jerárquico de tareas con contratos de interfaz, ejecuta hojas en git worktrees
aislados y compone resultados bottom-up con cherry-pick y repair semántico.

El foco actual es terminar el producto: una sala de control agent-first donde el
usuario pueda crear un run, revisar el plan, supervisar ejecución, responder
decisiones humanas de alto impacto e inspeccionar evidencia operativa.

No hay una estrategia de benchmark o tesis activa. Los experimentos antiguos,
Lab Mode, `/replay`, B0-B4, G3/G6/G9 y los benchmarks determinísticos fueron
retirados o quedaron como historia. No los reintroduzcas.

---

## 2. Objetivos Técnicos Vigentes

1. **Paralelismo aislado:** múltiples agentes pueden trabajar sobre el mismo
   repositorio mediante worktrees independientes y `ScopeChecker`.
2. **Estado durable:** planning y ejecución se modelan con StateGraphs y
   checkpoints JSON; resume/fork deben reconstruir dependencias desde el
   `RunRecord`, no desde estado mutable accidental.
3. **UI derivada de eventos:** el cliente reduce un log append-only de
   `RunEvent` y deriva vistas con selectores. No persistas estado visual
   duplicado.
4. **Integración verificable:** `git diff HEAD` es la fuente de verdad de los
   cambios; el orquestador commitea; el Composer integra y repara con contexto.

---

## 3. Arquitectura Del Monorepo

Regla de dependencias: `apps → packages específicos → shared`. Nunca importes
desde `apps` dentro de un paquete.

Paquetes principales:

- `task-graph`: `TaskNode`, `TaskGraph`, DAG validation, topo sort.
- `contracts`: `AgentTaskContract`, `InterfaceContract`, scopes.
- `decomposer`: schemas y decomposer recursivo interface-aware.
- `orchestrator-graph`: StateGraphs de planning/ejecución, state annotations y
  checkpointer JSON.
- `execution-core`: worktrees, executor registry, scope checker, recorder,
  validation, integration, grounding y amendments.
- `scheduler`: selección de waves y políticas de scheduling.
- `run-store` / `trace-store`: persistencia y trazas.
- `conflict-risk` / `repository-index`: señales de riesgo y grounding estructural.
- `core`: barrel legacy; evita usarlo para código nuevo.

Aplicación web:

- `apps/web/src/app/page.tsx`: Command Center.
- `apps/web/src/app/runs/[runId]/`: Run workspace.
- `apps/web/src/lib/server/runs/`: APIs, runner, host de planificación/ejecución.
- `apps/web/src/lib/run-model/`: modelo agent-first, reducer, selectores y
  view-models.

---

## 4. Invariantes De Trabajo

- `graph.dependencies` es canónico; `node.dependencies` es shortcut sincronizado.
- El campo canónico de intención de tarea es `goal`, no `intent`.
- Falla de LLM debe fallar con error accionable; no hay fallback silencioso.
- La ejecución de agentes debe pasar por `AgentExecutor` y perfiles configurados.
- Claude Code CLI es el executor por defecto; Codex CLI es la alternativa. No
  documentes ni agregues Gemini.
- `git diff HEAD` es la única fuente de verdad del resultado.
- El orquestador hace commit; los agentes no.
- El aislamiento real es worktree + `ScopeChecker`.
- La integración usa cherry-pick + repair semántico con `sharedInterface`.
- No reintroducir Lab Mode, benchmarks viejos, replay determinístico ni manifests
  `mock-v0`/`conflict-v0`.

## 4.1 Operación durable de runs

- Antes de ejecutar, usa el `RunTargetContext` capturado, no el workspace mutable.
- Toda mutación de pipeline debe conservar el operation lease, CAS y fencing.
  Un resultado con lease invalidado no puede escribir RunRecord, eventos ni estado
  terminal. Los side effects Git requieren además el repository lease.
- Cancelar no es `running -> interrupted` inmediato: pasa por `cancelling`,
  invalida el lease, usa `ProcessSupervisor` y solo termina al verificar
  `allDead=true`. Los agentes no commitean; el orquestador hace los commits.
- El resultado terminal se representa con `FinalArtifactManifest` y outcomes
  separados de execution/artifact/delivery. No llames `completed` a un artifact
  parcial, no verificado o pendiente de delivery.
- La ejecución usa config efectiva persistida antes del scheduler. El default
  `maxParallel=6` aplica aun sin override, el scheduling productivo es
  `risk_aware` y cada wave lleva `waveId` durable; el evento required
  `run.scheduling.wave_selected` se persiste antes del dispatch.
- El JSONL de `RunEvent` es el registro canónico para reconstruir la UI. El exit
  code del executor no prueba validation; ésta se emite desde su resultado real.
  `gated` se deriva de decisiones pendientes `decision.raised`/`decision.resolved`.
- Planes: ediciones semánticas usan CAS `expectedVersion`, suben `planRevision`
  e invalidan `approvedPlanRevision`. Claude debe exigir un override explícito y
  auditable para critic errors; nunca enviar acknowledgements implícitos.

---

## 5. UI/UX

La interfaz debe sentirse como una sala de control técnica: densa, clara y calma.

Principios:

- El color de marca señala actividad viva, no decoración.
- Obsoleto no equivale a fallado.
- El estado visible se deriva del event log; no inventes overrides locales.
- El canal de decisiones unifica toda intervención humana.
- El panel de foco resuelve detalles lazy con
  `GET /api/runs/[id]/artifacts?ref=...`.
- Mantener accesibilidad y contraste en ambos temas.

Usá los tokens y componentes existentes antes de crear nuevos.

---

## 6. Definición De Terminado

Para cambios funcionales se trabaja **siempre en modalidad TDD (test-first)**:

1. Leer el código relevante antes de editar.
2. Escribir primero un test que falle y fije el comportamiento esperado
   (rojo); recién entonces implementar el cambio mínimo para que pase (verde)
   y refactorizar. Ninguna línea de implementación se escribe antes de su test
   en rojo.
3. Mantener diffs pequeños y alineados al patrón existente.
4. Correr la verificación más estrecha y luego checks más amplios si aplica.
5. Actualizar docs afectadas en `docs/system/`, `docs/design/` o
   `docs/development/`.

Para corrección de bugs, el primer paso es un test que reproduzca el bug y
falle; el fix lo pone en verde.

Comandos usuales:

```bash
pnpm test
pnpm web:typecheck
pnpm -F @manyhands/execution-core typecheck
pnpm build
```

Para cambios solo de documentación, alcanza con una revisión de links y búsqueda
de términos obsoletos.

---

## 7. Documentación

- [`docs/DECISIONS.md`](docs/DECISIONS.md): decisiones vigentes.
- [`docs/system/`](docs/system/): funcionamiento actual del sistema.
- [`docs/design/`](docs/design/): modelo agent-first y UX/orquestación objetivo.
- [`docs/development/architecture.md`](docs/development/architecture.md): mapa de
  arquitectura vivo.
- [`docs/adr/`](docs/adr/): historia de decisiones; no todo lo aceptado allí
  sigue vigente.

