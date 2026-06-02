# System Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear 11 archivos de documentación en `docs/system/` que expliquen en lenguaje natural el funcionamiento de cada componente principal de ManyHands.

**Architecture:** Un README.md de overview con flujo narrativo completo + 10 archivos de componente (400-700 palabras cada uno) con estructura fija: Qué es → Responsabilidad → Cómo funciona → Interfaces → Decisiones de diseño.

**Tech Stack:** Markdown. Sin código, sin tests. Español con términos técnicos en inglés.

---

### Task 1: Crear docs/system/README.md (overview del sistema)

**Files:**
- Create: `docs/system/README.md`

- [ ] **Step 1: Crear el archivo de overview**

El README.md debe cubrir:
- Qué es ManyHands (1 párrafo)
- El flujo completo del sistema (diagrama ASCII + explicación narrativa de cada etapa)
- Las dos dimensiones del sistema: producto visual y artefacto de tesis
- Una tabla-índice de todos los componentes con links a sus archivos
- Dónde encontrar más contexto (DECISIONS.md, thesis/project-evolution.md)

Diagrama ASCII a incluir:
```
Feature (lenguaje natural)
    ↓
[GeminiRecursiveDecomposer] → TaskGraph + AgentTaskContracts + sharedInterfaces
    ↓
[RunExecutor] ← orquestador top-level
    ├── [BatchScheduler] → agrupa hojas respetando dependencias (maxParallel=3)
    │       ↓
    │   [WorktreeManager] → crea git worktree aislado por hoja
    │       ↓
    │   [FileSystemContextPacker] → arma el prompt (archivos + interfaces consumidas)
    │       ↓
    │   [GeminiCliExecutor] → invoca gemini --approval-mode yolo
    │       ↓
    │   [ScopeChecker] → valida archivos cambiados vs scope permitido
    │       ↓
    │   [ResultRecorder] → captura git diff HEAD, emite trace events, commitea
    │       ↓
    │   [WorktreeManager] → limpia el worktree
    ↓
[IntegrationAgent] → cherry-pick bottom-up, repair semántico con Gemini ante conflicto
    ↓
[GranularityVector] → computa 17 métricas (9 pre + 8 post ejecución)
    ↓
RunRecord (persistido en JSON)
    ↓
[Web App] → visualiza el DAG, expone inspector, streaming SSE en tiempo real
```

- [ ] **Step 2: Commit**

```bash
git add docs/system/README.md
git commit -m "docs(system): add system overview README"
```

---

### Task 2: Crear 01-task-graph.md

**Files:**
- Create: `docs/system/01-task-graph.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** el modelo de datos central del sistema — representa el plan de trabajo como un DAG jerárquico
- **NodeKind:** tres tipos de nodo — `root` (objetivo raíz, siempre uno), `integrator` (nodo compuesto que tiene hijos y los integra), `leaf` (unidad atómica ejecutable)
- **TaskNode fields:** id, title, goal, kind, granularity (auto/low/medium/high), status, prompt, acceptanceCriteria, output, dependencies
- **graph.dependencies vs node.dependencies:** por qué `graph.dependencies` es el registro canónico (Map de nodeId → Set de nodeIds) y `node.dependencies` es solo un shortcut sincronizado para conveniencia de lectura
- **Validación:** `validateTaskGraph` detecta ciclos, nodos huérfanos, dependencias hacia nodos inexistentes, constraints de kind (solo la hoja puede tener contract)
- **Topo sort:** `getTopologicalOrder()` y cómo el BatchScheduler lo consume
- **Readiness:** `getLeafReadiness()` — una hoja está lista cuando todos sus antecesores están en estado done/integrated
- **Estado agregado:** `aggregateTaskStatus()` sube el estado desde las hojas hasta la raíz

- [ ] **Step 2: Commit**

```bash
git add docs/system/01-task-graph.md
git commit -m "docs(system): add task-graph component doc"
```

---

### Task 3: Crear 02-contracts.md

**Files:**
- Create: `docs/system/02-contracts.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** el contrato entre el orquestador y un agente ejecutor — define exactamente qué debe hacer, qué puede tocar, y cómo se verifica el resultado
- **AgentTaskContract V1:** goal, title, prompt, acceptanceCriteria (con tipos: test/typecheck/exports_symbol/command/custom), expectedOutput (changedFiles, producedSymbols, consumedSymbols), allowedScope, forbiddenPaths, contextPack
- **Extensión V2 (Execution Core):** executionScope (implementationPaths, testPaths, configPaths), forbiddenPaths, leafValidationCommands, parentValidationCommands, runValidationCommands — todos opcionales, backward-compatible
- **InterfaceContract:** el nuevo tipo central de los artifacts de tesis — id, kind (type/function/module), signature (firma TypeScript real), description, definedAtNodeId. Los campos consumedInterfaces/producedInterfaces en el contrato de cada hoja lo que conectan las costuras entre agentes paralelos
- **ExecutionValidationCommand:** `{ command, args[], timeoutMs, cwd: "worktree"|"repo-root" }`
- **Cómo lo usa el sistema:** el Decomposer lo genera, el ContextPacker lo lee para construir el prompt, el ScopeChecker valida contra él, el ResultRecorder lo referencia para decidir qué commitear

- [ ] **Step 2: Commit**

```bash
git add docs/system/02-contracts.md
git commit -m "docs(system): add contracts component doc"
```

---

### Task 4: Crear 03-decomposer.md

**Files:**
- Create: `docs/system/03-decomposer.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** el componente que transforma una feature en lenguaje natural en un DAG jerárquico con costuras de interfaz explícitas
- **Dos modos:** GeminiRecursiveDecomposer (default del producto) vs. baselines Anthropic opt-in vía env var
- **El algoritmo recursivo:** `decomposeNode()` — una sola llamada LLM por nodo que decide `atomic` (→ hoja) o `decompose` (→ composite + sharedInterface + hijos). Por qué una sola llamada es más eficiente y coherente que separar `shouldDecompose` de `decompose`
- **La rúbrica de atomicidad:** cuatro criterios que el LLM evalúa para decidir si un nodo es atómico. El parámetro `aggressiveness` (low/medium/high) modula el criterio 1 (tamaño de la unidad cohesiva). El piso absoluto: nunca más pequeño que una función coherente
- **sharedInterface:** cuando un nodo se descompone, produce definiciones TypeScript concretas (tipos y firmas) que sus hijos deben respetar. Estos se cablee como `consumedInterfaces`/`producedInterfaces` en los contratos de cada hoja
- **DecomposeStepOutputSchema:** discriminated union `{ decision: "atomic", leafContract: ... } | { decision: "decompose", children: [...], sharedInterfaces: [...], ... }`
- **Invocación de Gemini:** `--approval-mode plan` (read-only), prompt enviado por stdin, JSON output validado con Zod
- **Baselines:** el single-pass Anthropic decomposer se conserva para comparación experimental

- [ ] **Step 2: Commit**

```bash
git add docs/system/03-decomposer.md
git commit -m "docs(system): add decomposer component doc"
```

---

### Task 5: Crear 04-run-executor.md

**Files:**
- Create: `docs/system/04-run-executor.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** el orquestador top-level que toma un TaskGraph ya aprobado y coordina toda la ejecución
- **Constructor:** recibe `SimpleGitRunner`, `AgentExecutor`, `TraceStore`, `ExecutionConfig` y construye internamente `WorktreeManager`, `ResultRecorder`, `IntegrationAgent`, `ValidationRunner`, `BatchScheduler`, `FileSystemContextPacker`
- **El método `run()`:** el loop principal. Obtiene el topo sort, forma batches con `BatchScheduler`, por cada batch lanza las hojas en paralelo (Promise.all), espera resultados, decide si integrar o reportar fallo
- **Integración bottom-up:** cuando todas las hojas de un composite terminan, el RunExecutor invoca `IntegrationAgent.integrate()` en ese composite antes de avanzar al siguiente nivel del árbol
- **Error handling:** si una hoja falla con `scope_violation` o `validation_failed`, el run puede continuar con las hojas restantes del mismo batch o abortar (según policy). Si falla la integración, el composite se marca como fallido
- **GranularityVector:** al final de la run, `computeGranularityVector()` toma el TaskGraph + todos los resultados y produce las 17 métricas
- **Trazas:** cada paso emite trace events — `batch_started`, `agent_started`, `executor_started`, `executor_completed`, `integration_started`, etc.

- [ ] **Step 2: Commit**

```bash
git add docs/system/04-run-executor.md
git commit -m "docs(system): add run-executor component doc"
```

---

### Task 6: Crear 05-worktree-layer.md

**Files:**
- Create: `docs/system/05-worktree-layer.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** la capa que crea y gestiona el aislamiento físico de cada tarea ejecutable en el sistema de archivos
- **SimpleGitRunner:** wrapper tipado sobre `simple-git` para todas las operaciones git del orquestador (add, commit, cherry-pick, worktree add/remove, diff). Centraliza el manejo de errores de git
- **WorktreeManager:** crea un git worktree por hoja en `.manyhands/worktrees/{runId}/{taskId}`. Cada worktree es una rama nueva a partir del `baseCommit` del run — es decir, el agente siempre parte del mismo estado del repo, independientemente de lo que otras hojas hayan hecho
- **Ciclo de vida de un worktree:** `create()` → agente trabaja → `detectUnexpectedCommit()` → orchestrator commitea (o rechaza si el agente ya commitió) → `clean()`
- **detectUnexpectedCommit():** compara el HEAD actual del worktree contra el `baseCommit` conocido. Si difieren, el agente hizo un commit propio — se reporta como `agentCommittedUnexpectedly: true` y se aplica la política (`reject` por default)
- **Por qué worktrees y no branches normales:** los worktrees de git permiten tener múltiples branches del mismo repo activos en paralelo en distintos directorios del filesystem. Sin worktrees, cambiar de branch haría que el repo principal perdiera el estado de trabajo

- [ ] **Step 2: Commit**

```bash
git add docs/system/05-worktree-layer.md
git commit -m "docs(system): add worktree-layer component doc"
```

---

### Task 7: Crear 06-gemini-executor.md

**Files:**
- Create: `docs/system/06-gemini-executor.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** el adaptador que traduce un `AgentTaskContract` en una invocación de Gemini CLI y captura el resultado
- **AgentExecutor interface:** el seam provider-agnóstico — `execute(options): Promise<AgentExecutionResult>`. El `GeminiCliExecutor` es la implementación real; el `MockAgentExecutor` es el test double determinístico
- **Invocación:** `gemini --model <model> --approval-mode yolo --skip-trust -o text -p STDIN_DIRECTIVE`. El prompt completo (instrucciones de la tarea) se escribe a un archivo temporal y se lee desde stdin al proceso
- **`--approval-mode yolo`:** auto-aprueba todas las tool calls de Gemini sin intervención humana. Es lo que permite la ejecución headless. El aislamiento real NO viene del CLI sino del worktree aislado + ScopeChecker
- **Timeout:** el orquestador inicia un timer y mata el proceso si excede `timeoutMs` (default 5 min). En Windows usa `taskkill /T /F` para matar el árbol de procesos completo (Gemini puede spawnar subprocesos propios)
- **Captura de output:** stdout y stderr se capturan y persisten truncados a 4KB (`stderrTail`/`stdoutTail`) para diagnóstico en la UI. Pero nunca se usan para determinar qué cambió — para eso está `git diff HEAD`
- **MockAgentExecutor:** para tests, ejecuta una función determinística que produce resultados configurables sin invocar ningún proceso externo. Permite testear el pipeline completo sin Gemini real

- [ ] **Step 2: Commit**

```bash
git add docs/system/06-gemini-executor.md
git commit -m "docs(system): add gemini-executor component doc"
```

---

### Task 8: Crear 07-context-and-scope.md

**Files:**
- Create: `docs/system/07-context-and-scope.md`

- [ ] **Step 1: Crear el archivo**

Cubrir dos componentes que trabajan en tándem:

**FileSystemContextPacker:**
- Arma la sección del prompt que contiene el contexto de archivos — lee del worktree los archivos que el agente necesita conocer para hacer su trabajo
- Límites: 8KB por archivo, 32KB total, máximo 10 archivos. Si un archivo no existe todavía, lo marca como `"(does not exist yet — create it)"` para guiar al agente
- Prevención de path traversal: `isWithinWorktree()` rechaza cualquier path que intente salir del worktree
- Qué va en el prompt final: (1) objetivo + acceptance criteria, (2) scope permitido/prohibido, (3) contenido actual de archivos, (4) [nuevo] `consumedInterfaces` — firmas TypeScript de las costuras que esta hoja debe respetar, (5) `producedInterfaces` — costuras que debe exponer

**ScopeChecker:**
- Recibe la lista de archivos que cambiaron (`git diff --name-only`) y los valida contra los globs del contrato
- Tres categorías permitidas: `implementationPaths`, `testPaths`, `configPaths` (todos globs)
- `forbiddenPaths`: lista de globs siempre prohibidos, independientemente del scope. **Deny wins**: si un archivo matchea tanto un glob permitido como uno prohibido, es una violación
- Resultado: `{ passed: boolean, violations: string[] }` — si `passed: false`, el ResultRecorder rechaza el resultado sin commitear

- [ ] **Step 2: Commit**

```bash
git add docs/system/07-context-and-scope.md
git commit -m "docs(system): add context-and-scope component doc"
```

---

### Task 9: Crear 08-result-pipeline.md

**Files:**
- Create: `docs/system/08-result-pipeline.md`

- [ ] **Step 1: Crear el archivo**

Cubrir dos componentes secuenciales:

**ResultRecorder:**
- El componente que transforma el output bruto de una ejecución de agente en un `AgentExecutionResult` verificado y commiteado
- **Tres caminos posibles:**
  1. *Fallo del executor* (timeout, error de spawn): retorna inmediatamente con el status correspondiente y los tails de stderr/stdout. No hay nada que commitear
  2. *Commit inesperado detectado*: el `WorktreeManager.detectUnexpectedCommit()` encontró que el agente commitió por su cuenta. Si la política es `reject`, se descarta el resultado. Si es `accept`, se usa el commit del agente pero se valida scope de todas formas
  3. *Camino normal*: hace `git diff HEAD` para ver qué cambió, ejecuta `ScopeChecker`, y si todo pasa, el orquestador hace el commit con un mensaje estructurado

**ValidationRunner:**
- Ejecuta los comandos de validación definidos en el contrato (`leafValidationCommands`, `parentValidationCommands`, `runValidationCommands`)
- Cada comando tiene: `command`, `args[]`, `timeoutMs`, y `cwd` ("worktree" o "repo-root")
- Los tres niveles de validación: *leaf* (post-hoja, pre-commit), *parent* (post-integración del composite), *run* (al completar toda la run)
- Si un comando falla (exit code ≠ 0), el resultado es `validation_failed` y el ResultRecorder no commitea

- [ ] **Step 2: Commit**

```bash
git add docs/system/08-result-pipeline.md
git commit -m "docs(system): add result-pipeline component doc"
```

---

### Task 10: Crear 09-composer.md

**Files:**
- Create: `docs/system/09-composer.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** el componente que integra los resultados de las hojas hijas en su nodo compuesto padre — es el Artifact 2 de tesis
- **Camino limpio:** cuando el cherry-pick de un commit hijo no produce conflictos, simplemente avanza al siguiente hijo en orden topológico. Es el caso feliz
- **Detección de conflictos:** si el cherry-pick falla con conflictos, en vez de abortar el `IntegrationAgent` intenta un repair semántico (máximo 1 intento por integración, ADR-0025)
- **El repair semántico:** a diferencia de un merge textual, el repair recibe contexto completo — goal del padre, acceptance criteria, el `sharedInterface` canónico del composite (las costuras que los hijos debían respetar), y el diff en conflicto. El prompt tiene el concepto: *"resolvé el conflicto de modo que el resultado honre exactamente la definición canónica de la interfaz compartida y cumpla el objetivo del padre"*
- **Por qué es diferente a un simple `git mergetool`:** un merge textual ve líneas. El Composer entiende intención: sabe qué producía cada hijo, qué consumía, y cuál es la fuente de verdad de la costura entre ellos. Los conflictos que requieren comprensión semántica (dos hojas que renombraron la misma función de maneras diferentes, por ejemplo) se resuelven por referencia al contrato, no adivinando
- **Verificación post-integración:** si el composite tiene `parentValidationCommands`, el Composer los corre contra el worktree integrado. Esto verifica que la costura quedó correcta (típicamente tests de integración)
- **Estados de salida:** `success`, `executor_repair_success`, `executor_repair_failed`, `validation_failed`, `cherry_pick_conflict` (si repair también falla)

- [ ] **Step 2: Commit**

```bash
git add docs/system/09-composer.md
git commit -m "docs(system): add composer component doc"
```

---

### Task 11: Crear 10-web-app.md

**Files:**
- Create: `docs/system/10-web-app.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** la capa de presentación que hace visible y controlable el trabajo del core — un workspace visual para inspeccionar y supervisar runs
- **Command Center (`/`):** el usuario describe una feature → `POST /api/runs` → el servidor lanza `GeminiRecursiveDecomposer` → el grafo generado vuelve al cliente con status `needs_review`
- **Run workspace (`/runs/[runId]`):** vista canónica de un run activo con tres sub-vistas: DAG canvas (grafo interactivo), Timeline (eventos en orden cronológico), Board (columnas por estado de tarea)
- **DAG canvas:** usa `@xyflow/react` (React Flow) — es un grafo de nodos y edges React, no un canvas de píxeles. Los nodos son `TaskNodeCard` con estado en tiempo real, el inspector lateral muestra contrato, diff, trazas y métricas del nodo seleccionado
- **SSE streaming:** durante la ejecución, el servidor envía eventos SSE desde `/api/runs/[runId]/events` cada 220ms. El cliente los consume y actualiza el RunRecord en su estado local. Los eventos incluyen trace events de ejecución, cambios de estado de hojas, progreso de integración
- **RunGraphViewModel:** la capa de view-model que traduce un `RunRecord` del core (con su `TaskGraph` y `TraceEvent[]`) a los tipos que necesita el canvas (`GraphNodeView`, `GraphEdgeView`, `GraphStatusCounts`). Separa la lógica de presentación de los schemas del core
- **Decisiones de planning:** el usuario puede revisar el DAG antes de ejecutar, editar nodos, regenerar subárboles, y aprobar el plan. Solo cuando el run está en `approved` se despacha la ejecución real
- **Lab Mode (`/lab`):** modo de benchmarks determinísticos con `MetadataDrivenMockDecomposer` y fixtures precargadas. Para experimentos controlados sin invocar Gemini

- [ ] **Step 2: Commit**

```bash
git add docs/system/10-web-app.md
git commit -m "docs(system): add web-app component doc"
```

---

### Task 12: GranularityVector — agregar sección a 04-run-executor.md o archivo separado

**Files:**
- Create: `docs/system/11-granularity-vector.md`

- [ ] **Step 1: Crear el archivo**

Cubrir:
- **Qué es:** el vector de métricas que captura las dimensiones de la granularidad de descomposición y los resultados de ejecución — el artefacto de medición central de los experimentos de tesis
- **9 métricas pre-ejecución** (derivadas de la estructura del DAG antes de ejecutar): `depth`, `leafCount`, `compositeCount`, `avgLeafDepth`, `maxLeafDepth`, `dependencyCount`, `avgAcceptanceCriteriaPerLeaf`, `estimatedTokensPerLeaf` (heurística)
- **8 métricas post-ejecución** (derivadas de los resultados): `integrationSuccessRate`, `leafSuccessRate`, `conflictRate`, `totalDurationMs`, `linesChanged`, `unexpectedCommitCount`, `scopeViolationCount`, `testsPassedRate` (si hay validationCommands)
- **Cómo se computa:** `computeGranularityVector(graph, results)` — toma el TaskGraph y el array de `AgentExecutionResult` (uno por hoja) y deriva todas las métricas. Las rates están validadas 0-1 con Zod
- **Por qué 17 métricas y no un score único:** la pregunta de tesis requiere correlacionar estructura del DAG con resultados. Un score único colapsaría la multidimensionalidad del fenómeno. Con el vector, se puede ver si `high` agresividad produce más `conflictRate` pero mejor `testsPassedRate` que `low`, y decidir cuál curva de trade-off es óptima
- **Dónde vive en el sistema:** se computa al final de `RunExecutor.run()` y se persiste como campo del `RunRecord`. La web app lo muestra en el panel de evidencia del run workspace

- [ ] **Step 2: Commit**

```bash
git add docs/system/11-granularity-vector.md
git commit -m "docs(system): add granularity-vector component doc"
```

---

### Task 13: Verificación final

- [ ] **Step 1: Verificar estructura final**

```bash
Get-ChildItem "docs/system" -Name | Sort-Object
```

Esperado: README.md + 01 a 11 archivos.

- [ ] **Step 2: Verificar que pnpm test sigue pasando**

```bash
pnpm test
```

Expected: 455 passing, 3 skipped.

- [ ] **Step 3: Commit final si hace falta**

```bash
git status
```
