# ManyHands — Decisiones Vigentes

> Síntesis operativa para agentes. Para historia completa, leer ADRs en
> `docs/adr/`. Los ADRs preservan decisiones pasadas; este documento dice qué
> sigue vigente hoy.

---

## Estado De Evaluación y Benchmarks

No hay benchmark suite ni metodología de evaluación activa. La prioridad actual
es terminar y estabilizar el producto. La forma de medir calidad se diseñará
después.

Decisiones pasadas superseded:

- Lab Mode determinístico.
- Rutas `/lab`, `/replay`, `/replay/demo`.
- Manifests `mock-v0` y `conflict-v0`.
- Baselines B0-B4 como matriz operativa.
- G3/G6/G9 como targets de granularidad.
- Fixtures bajo `benchmarks/` como fuente de experimentos.
- Narrativa de “artifacts de tesis” como objetivo operativo.

Los nombres heredados que todavía existen en código, como `GranularityVector` o
golden fixtures del run model, son mecanismos internos/operativos. No implican
una estrategia académica activa.

---

## Fuente De Verdad Del Resultado

**D5:** `git diff HEAD` es la única fuente de verdad de lo que un agente cambió.
Stdout/stderr se guardan solo como diagnóstico (`stderrTail`/`stdoutTail`).

Reglas:

- No confiar en stdout para decidir qué archivos cambiaron.
- Diff vacío + exit 0 es `empty_diff`, no éxito.
- Los patches y evidencias deben derivarse del estado real del repo.

---

## Commits

**D6:** el orquestador hace commit. El agente no debe commitear.

Flujo:

```text
agent edits worktree
  -> git diff HEAD
  -> scope check
  -> validation
  -> orchestrator commit
```

Si un agente commitea inesperadamente, se registra
`agentCommittedUnexpectedly` y se aplica la política configurada.

---

## Scope e Aislamiento

**D7:** el aislamiento real lo dan git worktrees + `ScopeChecker`, no el modo de
aprobación del CLI.

`executionScope` se divide en:

- `implementationPaths`
- `testPaths`
- `configPaths`

`forbiddenPaths` siempre gana sobre cualquier allow-list.

---

## Integración

**D8:** la integración se realiza con cherry-pick de commits hijo sobre el
composite padre.

Ante conflicto, el Composer invoca reparación semántica con:

- goal del padre;
- `sharedInterface` canónico;
- intención de cada hijo;
- diff y salida del cherry-pick.

No usar `git merge` ni `git rebase` para la integración normal.

---

## Planning y Decomposer

El producto usa descomposición recursiva interface-aware. Cada nodo decide si es
atómico o si debe dividirse. Cuando se divide, produce interfaces compartidas
que los hijos deben honrar.

`low | medium | high` describe agresividad de descomposición. No fija cantidad
de nodos ni profundidad de árbol.

Falla de LLM durante planning debe producir error accionable. No agregar
fallback silencioso a planificación determinística.

---

## Ejecución De Agentes

La ejecución pasa por el seam `AgentExecutor` y perfiles configurados en
`execution-core`. Gemini CLI es el executor primario/default del producto.

No cambiar el executor default, agregar CLIs nuevos o depender de subprocesses
directos fuera del wrapper sin discutirlo.

---

## Modelo De Datos

**D1:** `graph.dependencies` es canónico. `node.dependencies` es un shortcut
sincronizado. Mutar dependencias solo vía helpers.

**D2:** el campo canónico de intención es `goal`, no `intent`.

**D3:** no hay fallback silencioso ante falla del LLM.

---

## Scheduling y Timeouts

**D9:** el paralelismo se controla por `ExecutionConfig` y selección de wave.

**D10:** timeouts explícitos y configurables:

- hojas;
- integración;
- run completo cuando aplica.

---

## Package Boundaries

Dirección de dependencias: `apps → packages específicos → shared`.

| Package | Estado | Notas |
|---------|--------|-------|
| `task-graph` | Activo | Modelo de nodos y DAG |
| `contracts` | Activo | Contratos e interfaces |
| `decomposer` | Activo | Planning recursivo |
| `orchestrator-graph` | Activo | StateGraphs y checkpoints |
| `execution-core` | Activo | Worktrees, executors, scope, recorder, integration |
| `scheduler` | Activo | Selección de waves |
| `run-store` | Activo | Persistencia JSON de runs |
| `trace-store` | Activo | Eventos y trazas |
| `conflict-risk` | Activo | Riesgo entre tareas |
| `repository-index` | Activo | Índice estructural |
| `shared` | Activo | Tipos base |
| `core` | Legacy | Barrel heredado; evitar en código nuevo |

