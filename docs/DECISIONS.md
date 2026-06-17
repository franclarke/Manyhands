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

**D12:** los artefactos de build/dependencias (`node_modules`, `dist`, `.next`,
etc.) se **excluyen del commit**, no se prohíben: provisioning escribe
`.git/info/exclude` y el staging usa `addAllExcluding`
(`DEFAULT_ARTIFACT_GLOBS`). No agregarlos a `forbiddenPaths` — forbidden es
hard-fail y mataría runs legítimos donde el agente instala dependencias para
testear. Cambios de más de 500 archivos generan un advisory, nunca un fallo.

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

**D11:** los fallos de integración se clasifican antes de presentarse al humano
(`classifyIntegrationFailure`): `merge_conflict` | `code_validation` | `infra`
(exit 124/126/127 de la validación parent) | `internal`. Un fallo de entorno
nunca se presenta como conflicto de merge. El conflict gate acepta
`retry_integration`, implementado con un tombstone `retry_pending` que el
reducer consume borrando el resultado fallido (los canales de LangGraph no
tienen delete nativo); el composite re-entra al frontier y el worktree sucio
del intento anterior se recrea idempotentemente.

**D12 (P2a/P1):** la integración ya no está limitada a un solo repair global:
cada hijo conflictivo puede disparar su propio repair hasta agotar
`maxRepairsPerIntegration` (default 4). Si se agota el presupuesto o un repair
falla, se aborta el cherry-pick conflictivo y se preserva el commit de
integración parcial (los hijos previos, incluidos los reparados, ya
commitearon). Así, si el humano hace `accept_conflict`, el composite tiene un
`integrationCommitSha` que el padre puede cherry-pickear — antes quedaba sin
commit y la integración del padre se trababa con `Missing: <child>`.

**D13 (P2b):** un fallo de hoja/integración **aceptado por el humano** ya no
fuerza el run a `failed`. La aceptación ES la resolución: si la validación final
pasa, el run termina en el estado terminal `completed_with_accepted` (corre
final-apply y entrega el resultado), distinto de `completed` para no afirmar que
fue 100% limpio. El grafo y `RunExecutionResult` siguen siendo binarios
`completed`/`failed`; la distinción vive en el estado del `RunRecord`.

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
`execution-core`. **Claude Code CLI** (`claude`, headless, `--output-format json`)
es el executor primario/default del producto; **Codex CLI** (`codex exec`) es la
alternativa seleccionable. El planning usa el `ClaudeCodeRecursiveDecomposer`
(CLI, plan mode). Gemini CLI fue removido el 2026-06-16 (ver ADR-0031).

No cambiar el executor default, agregar CLIs nuevos o depender de subprocesses
directos fuera del wrapper sin discutirlo.

**D13:** los comandos de validación corren con `shell: true` en win32 (shims
`.cmd`) y, por venir del LLM, pasan por la charset whitelist
`validationCommandSafetyIssues` en dos capas (parse del decomposer + runner).
Exit codes sintéticos: 124 timeout (kill de árbol), 126 comando rechazado,
127 binario ausente — son la base de la clasificación `infra` de D11.

**D14:** los gates de ejecución se publican como decisión `clarify` con
`context.gate` y `context.options` (labels). UI y chat resuelven por el mismo
`execution-gate-service`; respuesta inválida → 400 con opciones, duplicado →
409 (CAS por `gateId`). El estado visual `gated` ("Esperando decisión") se
deriva de decisiones blocking pendientes en los selectores — no existe un
evento de "nodo pausado".

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

