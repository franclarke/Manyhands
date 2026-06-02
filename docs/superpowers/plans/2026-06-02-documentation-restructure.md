# Documentation Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limpiar y reestructurar toda la documentación (CLAUDE.md, AGENTS.md, README.md, docs/) separando en documentación de tesis (narrativa humana) y documentación de agentes (LLM-first).

**Architecture:** Crear dos docs de síntesis nuevos (DECISIONS.md + thesis/project-evolution.md), reescribir/actualizar docs de desarrollo vigentes, diferenciar CLAUDE.md de AGENTS.md, y eliminar ~26 docs del era mock-only que ya no reflejan la realidad.

**Tech Stack:** Markdown, git. Sin código ni tests — todo es documentación.

---

### Task 1: Crear docs/DECISIONS.md

**Files:**
- Create: `docs/DECISIONS.md`

- [ ] **Step 1: Crear el archivo**

Contenido completo de `docs/DECISIONS.md`:

```markdown
# ManyHands — Decisiones de Arquitectura

> Síntesis de ADRs y decisiones cerradas. LLM-first: directivo, escaneable, sin narrativa.
> Para el storytelling del proyecto, ver `docs/thesis/project-evolution.md`.
> Para el detalle completo de cada decisión, ver `docs/adr/` (ADR-0001 a ADR-0029).

---

## Executor de Agentes

**Decisión (D4):** Gemini CLI (`gemini`, headless) es el único executor de subagentes y el step-model del decomposer recursivo. Binario configurable vía `MANYHANDS_GEMINI_BIN` (default `gemini`). Reemplazó a Codex CLI en junio 2026.

**Invocación:**
- Hojas: `gemini -p <prompt>` vía stdin, `--approval-mode yolo` (auto-aprueba tool calls, sin bloqueo interactivo)
- Decomposer: `--approval-mode plan` (read-only, solo planificación)

**No hacer:**
- No invocar `child_process.exec` o `spawn` directamente sin el wrapper `GeminiCliExecutor`
- No usar Claude Code SDK, subprocess directo, ni ningún otro CLI como executor
- No sugerir volver a Codex sin consultar a Francisco

**Refs:** ADR-0019 (superseded), ADR-0029

---

## Fuente de Verdad del Resultado

**Decisión (D5):** `git diff HEAD` es la única fuente de verdad de lo que un agente cambió. El stdout/stderr se persiste (`stderrTail`/`stdoutTail`) solo para diagnóstico en la UI, nunca para determinar cambios.

**Por qué:** El output de un LLM puede ser alucinado. `git diff HEAD` es objetivo y verificable. Un diff vacío + exit 0 = `empty_diff`, no `success`.

**No hacer:**
- No confiar en el stdout del agente para determinar qué archivos cambió
- No tratar `empty_diff` como éxito

**Ref:** ADR-0020

---

## El Orquestador Hace Commit

**Decisión (D6):** El agente (Gemini CLI) nunca debe hacer commit. Flujo: diff → scope check → validación → commit (orquestador). Si el agente commitea, se detecta por comparación de SHA (`agentCommittedUnexpectedly: true`). Política: `reject` (default) o `accept`.

**Por qué:** Sin este control el orquestador pierde el commit graph, los mensajes de commit son no-estructurados, y el cherry-pick downstream se vuelve impredecible.

**Refs:** ADR-0021, ADR-0022

---

## Scope e Aislamiento

**Decisión (D7):** El aislamiento real lo dan el **git worktree aislado** + el `ScopeChecker`, no el sandbox del CLI. `SandboxMode` (`workspace-write`/`danger-full-access`) se conserva en el contrato pero `GeminiCliExecutor` mapea ambos a `--approval-mode yolo`.

**Scope:** Tres categorías — `implementationPaths`, `testPaths`, `configPaths`. `forbiddenPaths` siempre gana ("deny wins" sobre `executionScope`).

**No hacer:**
- No depender del sandbox del CLI como única barrera
- No ignorar `forbiddenPaths` aunque haya overlap con `executionScope`

**Refs:** ADR-0018, ADR-0023

---

## Integración: Cherry-Pick + Repair Semántico

**Decisión (D8):** Integración vía cherry-pick de commits hijo sobre rama padre. Conflicto → Gemini como reparador semántico (1 intento máximo). El repair recibe: goal del padre, `sharedInterface` canónico, intención de cada hijo, diff en conflicto. Falla → `IntegrationStatus: executor_repair_failed`.

**No hacer:**
- No usar `git merge` (merge commits complican el historial y el rollback)
- No usar `git rebase` (reescribe historial, conflictúa con el tracking del orquestador)
- No hacer más de 1 intento de repair por integración

**Ref:** ADR-0025

---

## Scheduling y Timeouts

**Decisión (D9):** `maxParallel = 3` hojas en paralelo por batch. Configurable vía `ExecutionConfig`.

**Decisión (D10):** Timeouts: hoja `300_000 ms` (5 min), integración `600_000 ms` (10 min). Configurables por contrato.

**Ref:** ADR-0026

---

## Modelo de Datos

**Decisión (D1):** `graph.dependencies` es canónico. `node.dependencies` es shortcut sincronizado. Mutación solo vía helpers: `addDependency`, `removeDependency`, `syncNodeDependencies`.

**Decisión (D2):** Campo canónico de intención de tarea es `goal` (nunca `intent`). Si aparece `intent` en fixtures legacy, normalizar en el parser, nunca persistir.

**Decisión (D3):** Sin `scenarioId` + LLM falla → run FALLA con error accionable. Sin fallback silencioso. `MetadataDrivenMockDecomposer` solo cuando hay `scenarioId` (Lab Mode).

---

## Decomposer

**Decisión:** Default del producto = `GeminiRecursiveDecomposer` (interface-aware). Baselines opt-in vía `MANYHANDS_DECOMPOSER=single-pass|anthropic-recursive` (requieren `ANTHROPIC_API_KEY`). Lab Mode forzado con `MANYHANDS_FORCE_FALLBACK=1`.

**Granularidad:** `low|medium|high` sesga el umbral de atomicidad por nodo, no fija profundidad ni cantidad de nodos. El árbol resultante es asimétrico; cada rama llega a la profundidad que su complejidad justifica.

**sharedInterface:** Cada paso de descomposición genera un `sharedInterface` — las costuras TypeScript que los hijos paralelos deben respetar. Esto es Artifact 1 de tesis.

**No hacer:**
- No asumir que la granularidad fija cantidad de nodos (era el diseño anterior, superseded)
- No implementar lógica de decomposición fuera de `packages/decomposer/`

---

## Packages: Estado

| Package | Estado | Notas |
|---------|--------|-------|
| `task-graph` | ACTIVO | Core del modelo de nodos |
| `contracts` | ACTIVO | AgentTaskContract V1 + V2 |
| `decomposer` | ACTIVO | RecursiveDecomposer + baselines |
| `execution-core` | ACTIVO | Pipeline completo implementado |
| `scheduler` | ACTIVO | sequential, naive, risk-aware |
| `run-store` | ACTIVO | RunSnapshot, patches |
| `trace-store` | ACTIVO | 16 execution trace events |
| `shared` | ACTIVO | Sin cambios |
| `conflict-risk` | DEFER | No en path crítico |
| `scope-validation` | DEFER | Reemplazado por ScopeChecker |
| `worktree-runner` | DEFER | Mock legacy, referencia |
| `repository-index` | DEFER | Índice estructural |
| `evaluator` | DEFER | Lab Mode |
| `core` | DEPRECATED | Barrel de compat; no usar para dependencias nuevas |
```

- [ ] **Step 2: Verificar que el archivo existe y tiene estructura correcta**

```bash
Get-Content "docs/DECISIONS.md" | Select-Object -First 5
```

- [ ] **Step 3: Commit**

```bash
git add docs/DECISIONS.md
git commit -m "docs: add DECISIONS.md - synthesized architecture decisions reference"
```

---

### Task 2: Crear docs/thesis/project-evolution.md

**Files:**
- Create: `docs/thesis/project-evolution.md`

- [ ] **Step 1: Crear directorio y archivo**

Contenido completo de `docs/thesis/project-evolution.md`:

```markdown
# ManyHands — Evolución del Proyecto

> Narrativa de la evolución arquitectónica para el tribunal de tesis.
> Audiencia: Francisco Clarke + tribunal de Ingeniería en Sistemas.
> Comunicación en español; términos técnicos y código en inglés.

---

## 1. El origen: laboratorio determinístico

ManyHands nació como respuesta a una pregunta de investigación concreta: ¿existe una granularidad óptima de descomposición que mejora la calidad del output de agentes LLM paralelos? Para poder responderla de forma metodológicamente sólida, el primer paso no fue correr agentes reales — fue construir un laboratorio.

El laboratorio inicial era completamente determinístico. No ejecutaba agentes LLM, no creaba git worktrees ni corría subprocesos. En cambio, simulaba el comportamiento de un pipeline de orquestación completo: tomaba una feature, la descomponía en un DAG jerárquico, asignaba contratos a las hojas, "ejecutaba" esas hojas con resultados determinísticos predefinidos, y generaba `RunSnapshot` con trazas auditables.

Esta decisión de diseño fue deliberada. El objetivo de la Etapa 1 no era demostrar que los agentes funcionan — era demostrar que la *arquitectura de orquestación* puede producir comparaciones reproducibles bajo condiciones controladas: misma feature, distintas estrategias (B0-B4), distintas granularidades (G3/G6/G9), mismos resultados estructurales cada vez.

Los baselines del laboratorio (`mock-v0`, `conflict-v0`) cubrían cinco estrategias de ejecución:
- **B0** — single agent (sin descomposición)
- **B1** — DAG secuencial (una hoja a la vez)
- **B2** — paralelo naive (todas las hojas a la vez)
- **B3** — paralelo + IntegrationAgent (cherry-pick)
- **B4** — paralelo + risk-aware + IntegrationAgent + human gate

El evaluador consumía `RunSnapshot` y derivaba métricas estructurales: forma del grafo, contratos, riesgo de conflicto, scheduling, trazabilidad. Las advertencias metodológicas eran explícitas: estos resultados validan estructura y reproducibilidad, no calidad final de código producido por agentes reales.

---

## 2. Pivote a producto visual

Después de construir el laboratorio determinístico, quedó claro que la tesis necesitaba un artefacto tangible más allá de un CLI. Un jurado técnico puede defender la arquitectura de un sistema si puede *verlo funcionar*, no solo si puede leer sus schemas.

El pivote fue construir una web app en Next.js App Router que consomiera el core existente directamente — no una UI con datos mockeados aparte, sino la misma lógica de orquestación expuesta visualmente.

Las superficies principales de la aplicación:
- **Command Center** (`/`): el usuario describe una feature en lenguaje natural y crea un run
- **Run workspace** (`/runs/[runId]`): vista canónica de una run con DAG interactivo, inspector de nodos, lifecycle del run y eventos SSE en tiempo real
- **Lab** (`/lab`): modo de benchmarks determinísticos para experimentos controlados
- **Replay** (`/replay/demo`): replay de snapshots para demos sin riesgo de ejecución live

El canvas del DAG usa `@xyflow/react` (React Flow) — es un grafo interactivo basado en componentes React, no un canvas de píxeles. Los nodos muestran estado, el inspector muestra contratos, las trazas se proyectan en tiempo real.

Este pivote fue importante para la tesis porque hace la arquitectura *visible y defendible*: el tribunal puede ver el DAG generarse, ver los contratos de cada hoja, ver cómo el scheduler agrupa hojas en batches, y ver las trazas de ejecución. No hay que inferir la estructura desde schemas abstractos.

---

## 3. Execution Core: de simulación a worktrees reales

Con el laboratorio validado y la web app funcionando, el siguiente paso fue implementar el pipeline de ejecución real. El `execution-core` pasó de ser un set de tipos y schemas vacíos a un pipeline funcional completo.

Los componentes implementados:

**Git y worktrees:**
- `SimpleGitRunner` — wrapper de `simple-git` para operaciones git
- `WorktreeManager` — crea y limpia git worktrees, detecta commits inesperados del agente

**Executor:**
- `AgentExecutor` — interfaz (seam) provider-agnóstica
- `MockAgentExecutor` — test double determinístico (no invoca ningún agente real)
- `GeminiCliExecutor` — wrapper real de `gemini` headless

**Pipeline:**
- `ScopeChecker` — valida `changedFiles` contra `executionScope` y `forbiddenPaths`
- `ResultRecorder` — captura `git diff HEAD`, persiste patch + traces
- `ValidationRunner` — ejecuta `leafValidationCommands`, `parentValidationCommands`, `runValidationCommands`
- `IntegrationAgent` — cherry-pick de commits hijo + repair semántico con Gemini ante conflicto
- `BatchScheduler` — control de concurrencia (`maxParallel = 3`)
- `FileSystemContextPacker` — empaqueta contexto de archivos + interfaces consumidas para el prompt del agente
- `RunExecutor` — orquestador top-level que coordina todos los componentes anteriores

**Diseño clave — el orquestador hace commit:** El agente nunca debe hacer commit. El flujo es: Gemini trabaja → `git diff HEAD` → scope check → validación → commit (orquestador). Si el agente commitea de todas formas, se detecta por comparación de SHA y se aplica la política configurada (`reject` por default).

**Diseño clave — git diff como verdad:** El output de un LLM puede ser alucinado. `git diff HEAD` es objetivo y verificable. El stdout/stderr del agente se persiste para diagnóstico en la UI, pero nunca se usa para determinar qué cambió.

La web app se cableó al motor real: `runner.ts` construye un `RunExecutor` + `GeminiCliExecutor` sobre un repo fixture provisionado (`createFixtureRepoProvisioner`). Los eventos de ejecución llegan a la UI vía SSE. El `GranularityVector` y el execution summary se persisten en el `RunRecord` y se proyectan en los paneles de evidencia del run workspace.

---

## 4. Los dos artifacts de tesis

### Artifact 1: Decomposer Recursivo Interface-Aware

El diseño original del decomposer era single-pass: una sola llamada al LLM producía el DAG entero. La granularidad era un control global de cantidad de nodos. Esto generaba un problema fundamental: árbol con profundidad uniforme en todas las ramas, sin importar que la complejidad real sea desigual.

El insight de Francisco fue correcto y llevó al rediseño: *"una rama del árbol podría necesitar más profundidad de descomposición que otra, por lo que no creo que sea útil definir un máximo o un objetivo de niveles."*

El nuevo decomposer es **recursivo y local**: cada nodo evalúa por sí mismo si conviene descomponerse, aplicando una rúbrica de atomicidad explícita. El árbol crece de forma asimétrica, reflejando la complejidad real de cada sub-problema.

Pero el cambio más importante no fue la recursión — fue el descubrimiento de la **costura entre hojas paralelas** como problema de primera clase. En el diseño anterior, dos hojas paralelas trabajaban a ciegas: cada una inventaba su versión de la interfaz que compartían. Cada una pasaba su scope check individual. Y después el cherry-pick fallaba — no por un conflicto de texto trivial, sino porque habían diseñado interfaces incompatibles.

La solución: en cada paso de descomposición, el Decomposer produce — además de los hijos — un `sharedInterface`: las definiciones de tipos y firmas de funciones que los hijos comparten. Cada hijo declara qué interfaces `consumes` (producidas por hermanas) y qué `produces` (para hermanas). En ejecución, el `ContextPacker` inyecta en el prompt de cada hoja las interfaces que consume, fijando la costura *antes* de despachar las hojas.

**Claim falsable:** Producir un `sharedInterface` en cada paso de descomposición reduce `conflictRate` y aumenta `integrationSuccessRate` vs. descomposición single-pass sin costuras explícitas.

### Artifact 2: Composer Contract-Aware

El `IntegrationAgent` original era un integrador sintáctico: ante un conflicto de cherry-pick, le pasaba a Gemini el texto del conflicto y nada más. Gemini veía el choque de líneas pero no sabía por qué cada hoja tomó la decisión que tomó, ni cuál era el objetivo del padre, ni cuál era la interfaz canónica que ambas hojas debían honrar.

El **Composer contract-aware** es el sucesor: un integrador consciente del contrato. Ante un conflicto, el repair se hace con contexto semántico completo:
- El goal y acceptance criteria del **padre** (qué tiene que lograr el conjunto)
- El **sharedInterface canónico** relevante al conflicto (la fuente de verdad de la costura)
- El contrato de cada hijo: goal, qué `produces`/`consumes`, su diff

El conflicto deja de ser un choque aleatorio de texto y pasa a ser una *violación del contrato de interfaz compartido*, que se resuelve por referencia al contrato canónico.

Además, cuando el composite tiene `parentValidationCommands` (poblados por el Decomposer), el Composer los corre contra el worktree integrado, verificando que la costura quedó bien. Esto cierra el lazo de calidad: `testsPassedRate` mide el sistema integrado, no solo hojas aisladas.

**Claim falsable:** Resolver conflictos por referencia al `sharedInterface` logra mayor `integrationSuccessRate` y `testsPassedRate` post-integración que un repair sintáctico.

---

## 5. Migración Codex → Gemini CLI

El executor original era Codex CLI (`codex exec`). La migración a Gemini CLI (`gemini`) ocurrió en junio 2026 por razones prácticas y de acceso:

- Gemini CLI está disponible y activado para el proyecto
- El seam `AgentExecutor` ya era provider-agnóstico por diseño previo, lo que hizo la migración menos invasiva
- Las garantías de no-interactividad se replican con `--approval-mode yolo` (ejecución de hojas) y `--approval-mode plan` (decomposer)
- El aislamiento real sigue dependiendo del git worktree + `ScopeChecker`, no del sandbox del CLI

Cambios técnicos de la migración:
- `CodexCliExecutor` → `GeminiCliExecutor` (`packages/execution-core/src/executor/gemini-cli.ts`)
- `--instructions-file` → prompt por stdin con `-p`
- `bypassApprovals: true` → `--approval-mode yolo`
- `AnthropicDecomposer` como default → `GeminiRecursiveDecomposer` como default
- Campos renombrados a naming provider-agnóstico: `executorExitCode`, `executorDurationMs`, `executorTimedOut`
- `stderrTail`/`stdoutTail` persisten para diagnóstico

El seam `AgentExecutor` se conserva provider-agnóstico. Un futuro swap a otro CLI requeriría solo un nuevo adapter, sin cambios en el pipeline.

ADR-0019 (Codex CLI) queda superseded por ADR-0029 (Gemini CLI).

---

## 6. Estado actual y lo que falta

### Lo implementado

El pipeline de orquestación está implementado de punta a punta:

- Web app cableada al motor real con SSE de ejecución
- `RunExecutor` + `GeminiCliExecutor` sobre repos fixture provisionados
- Dos fixtures de benchmark: `benchmarks/expression-calculator/` (costuras reales) y `benchmarks/task-manager-api/` (smoke test)
- Los dos artifacts de tesis implementados y cableados
- `GranularityVector` (17 métricas pre + post ejecución) persistido en el RunRecord

### Lo que falta: la evidencia empírica

El pipeline funciona con mocks y tests E2E. Lo que **no existe todavía** es la evidencia del experimento real:

- La matriz B0-B4 × {low, medium, high} sobre los fixtures con agentes Gemini reales no se corrió
- No hay `GranularityVector` post-ejecución real
- No hay `integrationSuccessRate`, `conflictRate`, ni `testsPassedRate` con agentes reales

Esta es la diferencia entre "el sistema funciona" (validado) y "la hipótesis de la tesis tiene evidencia" (pendiente).

El siguiente paso es correr los experimentos de granularidad reales: fixture → GeminiCliExecutor → capturar GranularityVector → analizar correlación entre aggressiveness y las métricas de calidad.

---

## Arquitectura resultante

```
apps/
  web/                  Next.js App Router — Command Center, Run workspace, Lab, Replay

packages/
  task-graph/           TaskNode, TaskGraph, validación, topo sort
  contracts/            AgentTaskContract V1+V2 (ejecutionScope, interfaces)
  decomposer/           GeminiRecursiveDecomposer (default) + baselines
  execution-core/       Pipeline completo: worktree, executor, scope, recorder,
                        integration, scheduler, granularity, RunExecutor
  scheduler/            sequential, naive, risk-aware
  run-store/            RunSnapshot, patches, persistencia JSON
  trace-store/          50+ trace event types (planning + execution)
  shared/               schemas y helpers compartidos

benchmarks/
  expression-calculator/ Fixture de costuras reales (tokenize→parse→evaluate)
  task-manager-api/      Fixture REST API (PUT/DELETE stubs para completar)

docs/
  adr/                  29 ADRs (decisiones de arquitectura)
  design/               Diseño detallado de los artifacts de tesis
  thesis/               Este documento y material de investigación
  DECISIONS.md          Síntesis de decisiones para agentes
```
```

- [ ] **Step 2: Verificar que el archivo existe**

```bash
Get-Content "docs/thesis/project-evolution.md" | Select-Object -First 5
```

- [ ] **Step 3: Commit**

```bash
git add docs/thesis/project-evolution.md
git commit -m "docs(thesis): add project-evolution.md - narrative arc for thesis committee"
```

---

### Task 3: Crear ADR-0029 (supersede Codex → Gemini)

**Files:**
- Create: `docs/adr/0029-gemini-cli-executor.md`

- [ ] **Step 1: Crear el archivo**

Contenido de `docs/adr/0029-gemini-cli-executor.md`:

```markdown
# 0029 · Gemini CLI as agent executor

## Status

Accepted. Supersedes ADR-0019 (Codex CLI in non-interactive mode).

## Context

ManyHands originally used Codex CLI (`codex exec --instructions-file`) as the agent executor for leaf tasks. In June 2026, access to Gemini CLI became available and practical, while Codex CLI usage became harder to justify. The executor seam (`AgentExecutor` interface) was already provider-agnostic by design, making migration possible without changing the orchestration pipeline.

## Decision

- Gemini CLI (`gemini`) replaces Codex CLI as the only agent executor and as the step-model for the recursive decomposer.
- Leaf task execution: `gemini -p <prompt>` with the prompt passed via stdin, `--approval-mode yolo` (auto-approves all tool calls to prevent interactive blocking in headless mode).
- Decomposer steps: `--approval-mode plan` (read-only; Gemini can read files but cannot write or execute commands).
- Binary path is configurable via `MANYHANDS_GEMINI_BIN` (default: `gemini`).
- The `AgentExecutor` interface remains provider-agnostic. Switching to another CLI in the future requires only a new adapter.

## Consequences

Positive:
- Fully automated — no human-in-the-loop during leaf execution.
- `--approval-mode yolo` prevents interactive prompts from blocking headless runs.
- `--approval-mode plan` gives the decomposer read access to the repo for grounding without allowing side effects.
- The executor seam keeps the orchestration pipeline decoupled from the specific CLI.

Negative / accepted:
- `--approval-mode yolo` means Gemini can use any tool within the worktree. Real isolation comes from the git worktree boundary + `ScopeChecker`, not from the CLI sandbox.
- Gemini CLI must be installed and available on `$PATH` (or `MANYHANDS_GEMINI_BIN`). If missing, the executor fails with a clear error.
- On Windows, the binary may need a `.cmd` shim. `MANYHANDS_GEMINI_BIN` covers this.

## Migration from Codex CLI

| Codex CLI | Gemini CLI |
|-----------|------------|
| `codex exec --instructions-file <path>` | `gemini -p <prompt>` (prompt via stdin) |
| `bypassApprovals: true` | `--approval-mode yolo` |
| `--sandbox workspace-write` | `--approval-mode yolo` (isolation via worktree + ScopeChecker) |
| `CodexCliExecutorOptions` schema | `AgentExecutorOptionsSchema` (renamed, provider-agnostic) |
| `CodexExecutionError` | `AgentExecutionError` |
| `codex_started` / `codex_completed` trace events | `executor_started` / `executor_completed` |

## Alternatives considered

- **Staying on Codex CLI**: rejected — access became impractical.
- **Claude Code SDK**: rejected — Gemini CLI provides the same non-interactive execution model with less integration overhead.
- **Direct subprocess without CLI wrapper**: rejected — the CLI handles tool use routing; reimplementing that is out of scope.

## References

- Decision D4 in `CLAUDE.md`
- `packages/execution-core/src/executor/gemini-cli.ts`: `GeminiCliExecutor`
- `packages/decomposer/src/llm/recursive/gemini-recursive-decomposer.ts`: `GeminiRecursiveDecomposer`
- Supersedes: ADR-0019
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0029-gemini-cli-executor.md
git commit -m "docs(adr): add ADR-0029 Gemini CLI executor, supersedes ADR-0019"
```

---

### Task 4: Reescribir docs/development/architecture.md

**Files:**
- Modify: `docs/development/architecture.md`

- [ ] **Step 1: Reemplazar el contenido completo**

Nuevo contenido de `docs/development/architecture.md`:

```markdown
# Architecture

ManyHands is a visual orchestration workspace for multi-agent software development. Takes a feature in natural language, decomposes it into a hierarchical DAG, executes leaves in isolated git worktrees with Gemini CLI, and integrates results bottom-up with cherry-pick.

## Product Architecture

```txt
Web App (Next.js)
  → API routes
  → Core orchestration (RunExecutor)
  → Agent executor (GeminiCliExecutor)
  → Git / worktree layer (WorktreeManager, SimpleGitRunner)
  → Trace / evaluation layer (trace-store, run-store)
```

The web app does not reimplement orchestration logic. It calls API routes backed by existing package APIs and displays validated core artifacts: `TaskGraph`, `AgentTaskContract`, `RunRecord`, `GranularityVector`.

## Execution Pipeline

```txt
Feature prompt (user)
  → GeminiRecursiveDecomposer     (recursive interface-aware decomposition)
  → TaskGraph + AgentTaskContracts
  → RunExecutor (orchestrator)
      → BatchScheduler             (maxParallel=3)
      → WorktreeManager.create()
      → FileSystemContextPacker    (files + consumedInterfaces)
      → GeminiCliExecutor          (gemini --approval-mode yolo)
      → ScopeChecker               (git diff vs allowed/forbidden paths)
      → ValidationRunner           (leafValidationCommands)
      → ResultRecorder             (git diff HEAD → patch + traces)
      → WorktreeManager.clean()
  → IntegrationAgent (bottom-up, per composite)
      → git cherry-pick
      → Gemini semantic repair (on conflict, max 1 attempt)
      → ValidationRunner           (parentValidationCommands)
  → GranularityVector              (17 metrics: 9 pre + 8 post)
  → RunRecord (persisted)
```

## Package Boundaries

Dependency direction: `apps → packages específicos → shared`. `@manyhands/core` existe como barrel de compatibilidad pero no debe usarse para dependencias nuevas.

| Package | Responsabilidad | Estado |
|---------|-----------------|--------|
| `task-graph` | TaskNode, TaskGraph, validación, topo sort | Activo |
| `contracts` | AgentTaskContract V1+V2, InterfaceContract | Activo |
| `decomposer` | GeminiRecursiveDecomposer (default), baselines | Activo |
| `execution-core` | Pipeline completo de ejecución real | Activo |
| `scheduler` | sequential, naive, risk-aware | Activo |
| `run-store` | RunSnapshot, patches, JSON persistence | Activo |
| `trace-store` | TraceEvent union (50+ types) | Activo |
| `shared` | EntityId, IsoTimestamp, helpers | Activo |
| `conflict-risk` | Predicción de conflictos entre hojas | Deferred |
| `scope-validation` | Legacy, reemplazado por ScopeChecker | Deferred |
| `worktree-runner` | Mock runner legacy | Deferred (referencia) |
| `repository-index` | Índice estructural del repo | Deferred |
| `evaluator` | Métricas y reportes de Lab Mode | Deferred |
| `core` | Barrel de compatibilidad | Deprecated |

## Thesis Artifacts

**Artifact 1 — Interface-Aware Recursive Decomposer:**
`GeminiRecursiveDecomposer` descompone recursivamente. Cada paso produce un `sharedInterface` — las firmas TypeScript que los hijos paralelos comparten. Hojas reciben sus `consumedInterfaces` en el prompt vía `FileSystemContextPacker`. Esto fija la costura antes de despachar los agentes.

**Artifact 2 — Contract-Aware Composer:**
`IntegrationAgent` hace cherry-pick y, ante conflicto, invoca Gemini con contexto semántico completo: goal del padre, `sharedInterface` canónico, intención de cada hijo. La reparación se hace por referencia al contrato, no adivinando el merge textual.

## Decomposer Policy

Configurable vía env var `MANYHANDS_DECOMPOSER`:

| Valor | Decomposer | Requisito |
|-------|-----------|-----------|
| (default) | `GeminiRecursiveDecomposer` | `MANYHANDS_GEMINI_BIN` (default: `gemini`) |
| `single-pass` | `AnthropicSinglePassDecomposer` | `ANTHROPIC_API_KEY` |
| `anthropic-recursive` | `AnthropicRecursiveDecomposer` | `ANTHROPIC_API_KEY` |
| (`MANYHANDS_FORCE_FALLBACK=1`) | `MetadataDrivenMockDecomposer` | Lab Mode only |

## Runtime Design

- Persistencia JSON: workspaces y runs en disco. SQLite deferred.
- SSE: eventos de ejecución streameados a la UI en tiempo real.
- Repos: solo fixture provisioning (`createFixtureRepoProvisioner`). Repos locales reales: deferred.
- Tests: 455 passing + 3 skipped. `MockAgentExecutor` para tests del pipeline sin invocar Gemini real.

## Lab Mode

Lab Mode corre benchmarks determinísticos con `MetadataDrivenMockDecomposer` y fixtures precargadas (`mock-v0`, `conflict-v0`). Valida estructura, scheduling y trazabilidad sin LLM variance. Los resultados de Lab Mode son evidencia estructural, no evidencia de calidad de código de agentes reales.
```

- [ ] **Step 2: Commit**

```bash
git add docs/development/architecture.md
git commit -m "docs: rewrite architecture.md to reflect current implemented state"
```

---

### Task 5: Actualizar docs/development/thesis-plan.md

**Files:**
- Modify: `docs/development/thesis-plan.md`

- [ ] **Step 1: Actualizar el estado de cada Stage**

Reemplazar la sección "Evaluation Path" con el estado actual real. Cambiar:

- Stage 1 (Mock Structural): `Status: implemented` → ya correcto
- Stage 2 (Visual Orchestration): `Status: next` → `Status: implemented`
- Stage 3 (Real Execution Slice): `Status: future` → `Status: implemented (execution-core v0.1)`
- Stage 4 (Agentic Execution Pilot): `Status: future` → `Status: in progress — pipeline wired with Gemini CLI, empirical experiments pending`
- Stage 5 (Final Analysis): `Status: future` → mantener

Agregar al final de la sección de cada Stage la nota de estado actual.

- [ ] **Step 2: Commit**

```bash
git add docs/development/thesis-plan.md
git commit -m "docs: update thesis-plan.md stage status to reflect current implementation"
```

---

### Task 6: Actualizar docs/development/product-vision.md

**Files:**
- Modify: `docs/development/product-vision.md`

- [ ] **Step 1: Eliminar frases stale**

Buscar y eliminar/reemplazar frases como:
- "Near-term Build Mode will still use mock execution" → eliminar (ya no aplica, hay ejecución real)
- "Future Real Agent Mode" → actualizar para indicar que el pipeline existe con Gemini CLI

Actualizar "Product Modes":
- Build Mode: ya usa ejecución real con Gemini CLI (no solo mock)
- Real Agent Mode: el pipeline ya existe; lo que falta es la evidencia empírica

- [ ] **Step 2: Commit**

```bash
git add docs/development/product-vision.md
git commit -m "docs: update product-vision.md - remove stale mock-only references"
```

---

### Task 7: Reformar CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Reemplazar con versión reformada**

Nuevo contenido de `CLAUDE.md` (target ~130 líneas):

```markdown
# ManyHands — Contexto para Claude

> Francisco es el único desarrollador. Comunicación en español. Decisiones ya cerradas no se renegocian.
> Para el detalle de cada decisión: `docs/DECISIONS.md`. Para narrativa del proyecto: `docs/thesis/project-evolution.md`.

---

## Qué es ManyHands

Sistema de orquestación de agentes LLM para desarrollo de software. Toma una feature en lenguaje natural, la descompone recursivamente en un DAG jerárquico, ejecuta las hojas en git worktrees aislados con **Gemini CLI** (`gemini`, headless), y integra resultados de abajo hacia arriba con cherry-pick.

**Contexto académico:** Tesis de Ingeniería en Sistemas. Pregunta de investigación: ¿existe una granularidad óptima de descomposición DAG que maximiza la calidad del output de agentes LLM paralelos?

---

## Estado Actual

### Verificación
- `pnpm test` → 455 passing, 3 skipped (458 total)
- `pnpm -F @manyhands/execution-core typecheck` → 0 errores
- `pnpm build` → packages OK
- `pnpm web:typecheck` → 0 errores

### Banderas ⚠️
- **La migración Codex→Gemini está sin commitear** — código en disco es Gemini, último commit de execution-core aún dice "Codex CLI". Commitear.
- **Sin evidencia empírica** — el pipeline con Gemini está cableado pero los experimentos de granularidad (B0-B4 × low/medium/high con Gemini reales) no se corrieron. Solo existe validación estructural con mock/E2E.
- **`packages/calculator/`** — artefacto untracked trivial, eliminar o gitignorar.
- **ADR-0019** stale — ya superseded por ADR-0029 (Gemini CLI).

---

## Decisiones Cerradas (NO renegociar)

| ID | Decisión |
|----|----------|
| D1 | `graph.dependencies` es canónico. `node.dependencies` es shortcut. Mutación via `addDependency` / `removeDependency` / `syncNodeDependencies`. |
| D2 | Campo canónico es `goal` (no `intent`). Si aparece `intent` en fixtures legacy, normalizar en el parser. |
| D3 | Sin `scenarioId` + LLM falla → run FALLA con error accionable. Sin fallback silencioso. `MetadataDrivenMockDecomposer` solo con `scenarioId` (Lab Mode). |
| D4 | **Gemini CLI** (`gemini`, headless, stdin) es el único executor de subagentes Y el step-model del decomposer. No Claude Code SDK, no subprocess directo, no otros CLIs. Seam provider-agnóstico: `AgentExecutor`. Binario: `MANYHANDS_GEMINI_BIN` (default `gemini`). |
| D5 | `git diff HEAD` es la fuente de verdad del resultado. No stdout del agente. `stderrTail`/`stdoutTail` se persisten solo para diagnóstico en UI. |
| D6 | **El orquestador hace commit.** El agente nunca debe commitear. Si commitea, política `reject` (default) o `accept`. |
| D7 | Aislamiento real = git worktree + `ScopeChecker`. `SandboxMode` del contrato se mapea a `--approval-mode yolo` en Gemini headless. |
| D8 | Integración: cherry-pick + repair semántico con Gemini (máx. 1 intento). Repair incluye: goal del padre, `sharedInterface` canónico, intención de cada hijo. |
| D9 | `maxParallel = 3` hojas en paralelo (configurable). |
| D10 | Timeouts: hoja 300 s, integración 600 s (configurables). |

---

## Arquitectura de Paquetes

| Package | Estado | Notas |
|---------|--------|-------|
| `task-graph` | ACTIVO | TaskNode, TaskGraph, validación |
| `contracts` | ACTIVO | AgentTaskContract V1+V2 |
| `decomposer` | ACTIVO | GeminiRecursive (default) + baselines |
| `execution-core` | ACTIVO | Pipeline completo |
| `scheduler` | ACTIVO | sequential, naive, risk-aware |
| `run-store` | ACTIVO | RunSnapshot, patches |
| `trace-store` | ACTIVO | 50+ trace event types |
| `shared` | ACTIVO | — |
| `conflict-risk` | DEFER | — |
| `scope-validation` | DEFER | Reemplazado por ScopeChecker |
| `worktree-runner` | DEFER | Mock legacy |
| `repository-index` | DEFER | — |
| `evaluator` | DEFER | Lab Mode |
| `core` | DEPRECATED | Barrel de compat |

---

## Archivos Clave

| Archivo | Descripción |
|---------|-------------|
| `packages/task-graph/src/index.ts` | TaskNode, TaskGraph, topo sort |
| `packages/contracts/src/index.ts` | AgentTaskContract + InterfaceContract |
| `packages/decomposer/src/llm/recursive/` | GeminiRecursiveDecomposer (Artifact 1) |
| `packages/execution-core/src/run/executor.ts` | RunExecutor — orquestador top-level |
| `packages/execution-core/src/executor/gemini-cli.ts` | GeminiCliExecutor |
| `packages/execution-core/src/integration/agent.ts` | IntegrationAgent / Composer (Artifact 2) |
| `packages/execution-core/src/types.ts` | 14 Zod schemas de ejecución |
| `packages/execution-core/src/errors.ts` | 7 clases de error tipadas |
| `apps/web/src/lib/server/runs/runner.ts` | Planning + execution pipeline (motor real) |
| `apps/web/src/lib/decomposer-policy.ts` | `pickDecomposer()` — Gemini por default |
| `apps/web/src/lib/server/runs/schema.ts` | RunRecord schema (Zod) |
| `apps/web/src/lib/graph-view-model.ts` | RunGraphViewModel, InspectorView |
| `benchmarks/expression-calculator/` | Fixture de costuras reales (tesis) |
| `benchmarks/task-manager-api/` | Fixture REST API |
| `docs/DECISIONS.md` | Síntesis de todos los ADRs y decisiones |
| `docs/thesis/project-evolution.md` | Narrativa del proyecto para la tesis |
| `docs/design/decomposer-composer-redesign.md` | Diseño detallado de los dos artifacts |
| `docs/adr/` | 29 ADRs (registro histórico) |

---

## Reglas para Claude

1. **No renegociar D1-D10.** Si algo parece en tensión, señalarlo sin cambiar la decisión.
2. **Gemini CLI es mandatorio** (ejecución + planning). No sugerir alternativas sin consultar a Francisco.
3. **Git diff como verdad.** Nunca confiar en stdout del agente para determinar cambios.
4. **El orquestador hace commit.** Nunca hacer que Gemini commitee.
5. **Error claro sobre fallback silencioso** (D3).
6. **Tests como safety net.** `pnpm test` antes y después de cambios en packages core.
7. **La suite debe pasar siempre** (455 + 3 skipped). Si un cambio rompe tests, arreglarlo en la misma sesión.
8. **Lab Mode es secundario.** Los escenarios determinísticos son infraestructura de tesis, no el flujo principal.
9. **`@manyhands/core` está deprecado.** Nuevas dependencias van a packages específicos.
10. **Comunicación en español.**

---

## Comandos de Verificación Rápida

```bash
pnpm test                  # 455 passing + 3 skipped
pnpm -F @manyhands/execution-core typecheck
pnpm web:typecheck
pnpm build
pnpm web:dev               # localhost:3000

# Variables de entorno:
# MANYHANDS_GEMINI_BIN      ruta al binario gemini (default: gemini)
# MANYHANDS_DECOMPOSER      single-pass | anthropic-recursive (baselines opt-in)
# MANYHANDS_FORCE_FALLBACK=1  fuerza MetadataDrivenMockDecomposer (Lab)
```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reform CLAUDE.md - remove exhaustive type listings, add doc pointers"
```

---

### Task 8: Crear AGENTS.md diferenciado

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Reemplazar con versión diferenciada para Codex y otros**

Nuevo contenido de `AGENTS.md`:

```markdown
# ManyHands — Context for AI Coding Agents

> This file is for AI coding tools working in this repository (Codex, Cursor, etc.).
> It is NOT the context file read by Claude Code (that's CLAUDE.md).
> Communication with Francisco: Spanish. Code and technical terms: English.

---

## What this repository is

ManyHands is an LLM agent orchestration system for software development. It takes a feature in natural language, recursively decomposes it into a hierarchical DAG, executes leaf tasks in isolated git worktrees with Gemini CLI (`gemini`, headless), and integrates results bottom-up with cherry-pick.

Academic context: Engineering thesis. Research question: does an optimal decomposition granularity exist that maximizes the quality of parallel LLM agent output?

**Not:** a coding agent, a RAG system, an IDE plugin, or an organizational memory tool.

---

## System Invariants — Do Not Change Without Discussing

| # | Invariant |
|---|-----------|
| D1 | `graph.dependencies` is canonical. `node.dependencies` is a synced shortcut. Mutation only via `addDependency` / `removeDependency` / `syncNodeDependencies`. |
| D2 | Canonical task intent field is `goal`, never `intent`. Normalize legacy `intent` in parsers, never persist. |
| D3 | No `scenarioId` + LLM failure → run FAILS with actionable error. No silent fallback. `MetadataDrivenMockDecomposer` only when `scenarioId` present (Lab Mode). |
| D4 | **Gemini CLI** (`gemini`, headless, stdin) is the only agent executor and the step-model for the recursive decomposer. No direct subprocess, no other CLIs. Binary via `MANYHANDS_GEMINI_BIN` (default: `gemini`). |
| D5 | `git diff HEAD` is the only source of truth for what an agent changed. stdout/stderr are diagnostic only. |
| D6 | **The orchestrator commits.** Agents must never commit. If an agent commits unexpectedly, policy: `reject` (default) or `accept`. |
| D7 | Real isolation comes from git worktree + `ScopeChecker`, not the CLI sandbox. `--approval-mode yolo` is used for leaf execution; `--approval-mode plan` for the decomposer. |
| D8 | Integration via cherry-pick + semantic repair with Gemini (max 1 attempt). Repair uses full context: parent goal, canonical `sharedInterface`, child intent. |
| D9 | `maxParallel = 3` leaves per batch (configurable). |
| D10 | Timeouts: leaf 300 s, integration 600 s (configurable). |

---

## Package Boundaries

Dependency direction: `apps → specific packages → shared`. Never import from `apps` in packages. Never use `@manyhands/core` for new dependencies (deprecated barrel).

| Package | Purpose | Status |
|---------|---------|--------|
| `task-graph` | TaskNode, TaskGraph, DAG validation | Active |
| `contracts` | AgentTaskContract V1+V2, InterfaceContract | Active |
| `decomposer` | GeminiRecursiveDecomposer (default) + baselines | Active |
| `execution-core` | Full execution pipeline | Active |
| `scheduler` | sequential, naive, risk-aware | Active |
| `run-store` | RunSnapshot, patches, JSON persistence | Active |
| `trace-store` | TraceEvent union (50+ types) | Active |
| `shared` | Shared schemas and helpers | Active |
| `conflict-risk` | Conflict risk prediction | Deferred |
| `scope-validation` | Legacy, replaced by ScopeChecker | Deferred |
| `worktree-runner` | Legacy mock runner | Deferred |
| `repository-index` | Structural repo index | Deferred |
| `evaluator` | Lab Mode evaluation | Deferred |
| `core` | Compatibility barrel | Deprecated |

---

## Operational Rules

1. Do not re-argue D1–D10. If something seems in tension, flag it, don't change it.
2. Gemini CLI is mandatory for execution and planning. Do not suggest alternatives.
3. Never use agent stdout to determine what changed. Use `git diff HEAD`.
4. Never make the agent (Gemini) commit. The orchestrator commits.
5. No silent fallback on decomposer failure (D3).
6. Run `pnpm test` before and after changes to core packages (`task-graph`, `contracts`, `decomposer`).
7. Test suite must always pass (455 passing + 3 skipped). Fix failures in the same session.
8. Lab Mode is secondary. Deterministic scenarios are thesis infrastructure, not the main user flow.
9. `@manyhands/core` is deprecated. Use specific packages for new dependencies.

---

## Verification Commands

```bash
pnpm test                           # 455 passing + 3 skipped
pnpm -F @manyhands/execution-core typecheck
pnpm web:typecheck
pnpm build
pnpm web:dev                        # localhost:3000
```

Environment variables:
- `MANYHANDS_GEMINI_BIN` — path to gemini binary (default: `gemini`)
- `MANYHANDS_DECOMPOSER` — `single-pass` | `anthropic-recursive` (opt-in baselines, require `ANTHROPIC_API_KEY`)
- `MANYHANDS_FORCE_FALLBACK=1` — force `MetadataDrivenMockDecomposer` (Lab Mode)

---

## Key Files

| File | Description |
|------|-------------|
| `packages/task-graph/src/index.ts` | TaskNode, TaskGraph, topo sort |
| `packages/contracts/src/index.ts` | AgentTaskContract + InterfaceContract |
| `packages/decomposer/src/llm/recursive/` | GeminiRecursiveDecomposer |
| `packages/execution-core/src/run/executor.ts` | RunExecutor — top-level orchestrator |
| `packages/execution-core/src/executor/gemini-cli.ts` | GeminiCliExecutor |
| `packages/execution-core/src/integration/agent.ts` | IntegrationAgent / Composer |
| `packages/execution-core/src/types.ts` | 14 Zod schemas for execution domain |
| `packages/execution-core/src/errors.ts` | 7 typed error classes |
| `apps/web/src/lib/server/runs/runner.ts` | Planning + execution pipeline |
| `apps/web/src/lib/decomposer-policy.ts` | `pickDecomposer()` |
| `benchmarks/expression-calculator/` | Interface seams fixture (thesis) |
| `benchmarks/task-manager-api/` | REST API benchmark fixture |

---

## Reference Documentation

- `docs/DECISIONS.md` — synthesized decisions reference (LLM-first)
- `docs/thesis/project-evolution.md` — project narrative for context
- `docs/design/decomposer-composer-redesign.md` — thesis artifacts design
- `docs/adr/` — 29 ADRs with full decision rationale
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: differentiate AGENTS.md for Codex/Cursor - remove CLAUDE.md mirror"
```

---

### Task 9: Actualizar README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Cambios puntuales en README.md**

1. En la sección "Stack", reemplazar `Gemini CLI` si dice otra cosa, asegurar que diga `Gemini CLI (gemini) para planificación recursiva y ejecución real de subagentes`.

2. En "Estado actual", actualizar si hay referencias a tests con número diferente de 455.

3. Revisar si hay frases que implican que la ejecución real no existe — si las hay, actualizarlas.

4. En "Alcance y límites", la última sección ya está bien — solo verificar que no haya referencias a "Codex CLI".

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README.md - remove stale Codex references, verify test count"
```

---

### Task 10: Eliminar docs stale

**Files:**
- Delete: los 26 archivos listados abajo

- [ ] **Step 1: Eliminar archivos stale del era mock**

```bash
# Progress report y archivos vacíos
Remove-Item "docs/PROGRESS-REPORT-2025-05-28.md"
Remove-Item "docs/manyhands-knowledge-base.md"
Remove-Item "docs/research/README.md"
Remove-Item -Recurse "docs/research"

# Mock-era development docs
Remove-Item "docs/development/mock-planning-flow.md"
Remove-Item "docs/development/mock-worktree-runner.md"
Remove-Item "docs/development/mock-execution-flow.md"
Remove-Item "docs/development/benchmark-runner-mock.md"
Remove-Item "docs/development/benchmark-report.md"
Remove-Item "docs/development/evaluation-report.md"
Remove-Item "docs/development/evaluator-v0.md"
Remove-Item "docs/development/granularity-comparison.md"
Remove-Item "docs/development/benchmark-dataset-v0.md"
Remove-Item "docs/development/benchmark-configurations.md"
Remove-Item "docs/development/conflict-benchmark-v0.md"
Remove-Item "docs/development/controlled-conflict-scenarios.md"
Remove-Item "docs/development/human-gated-mock.md"
Remove-Item "docs/development/run-snapshots.md"
Remove-Item "docs/development/persistent-trace-store.md"
Remove-Item "docs/development/run-export-import.md"
Remove-Item "docs/development/decomposer.md"
Remove-Item "docs/development/scope-validation.md"
Remove-Item "docs/development/repository-index.md"
Remove-Item "docs/development/static-conflict-signals.md"
Remove-Item "docs/development/enhanced-conflict-risk.md"
Remove-Item "docs/development/roadmap.md"
Remove-Item "docs/development/web-app-roadmap.md"
Remove-Item "docs/development/frontend-implementation-handoff.md"
Remove-Item "docs/development/benchmark-v0.md"
```

- [ ] **Step 2: Verificar que los archivos que deben quedar siguen existiendo**

```bash
Test-Path "docs/development/architecture.md"    # debe ser True
Test-Path "docs/development/thesis-plan.md"     # debe ser True
Test-Path "docs/development/ui-vision.md"       # debe ser True
Test-Path "docs/development/product-vision.md"  # debe ser True
Test-Path "docs/design/decomposer-composer-redesign.md"  # debe ser True
Test-Path "docs/DECISIONS.md"                   # debe ser True
Test-Path "docs/thesis/project-evolution.md"    # debe ser True
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: delete ~26 stale mock-era docs from docs/development/"
```

---

### Task 11: Verificación final

- [ ] **Step 1: Verificar estructura final de docs/**

```bash
Get-ChildItem -Recurse "docs" -Name | Sort-Object
```

Estructura esperada:
```
adr/0001-... a 0029-...
design/decomposer-composer-redesign.md
development/architecture.md
development/product-vision.md
development/thesis-plan.md
development/ui-vision.md
DECISIONS.md
superpowers/plans/...
superpowers/specs/...
thesis/project-evolution.md
```

- [ ] **Step 2: Verificar que pnpm test sigue pasando** (los cambios son solo docs, pero confirmar)

```bash
pnpm test
```

Expected: 455 passing, 3 skipped.

- [ ] **Step 3: Commit final si hace falta**

```bash
git status
# Si hay archivos sin commitear:
git add -A
git commit -m "docs: documentation restructure complete"
```
