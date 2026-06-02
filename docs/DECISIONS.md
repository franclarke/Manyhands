# ManyHands — Decisiones de Arquitectura

> Síntesis de ADRs y decisiones cerradas. LLM-first: directivo, escaneable, sin narrativa.
> Para el storytelling del proyecto, ver `docs/thesis/project-evolution.md`.
> Para el detalle completo de cada decisión, ver `docs/adr/` (ADR-0001 a ADR-0029).

---

## Executor de Agentes

**Decisión (D4):** Gemini CLI (`gemini`, headless) es el único executor de subagentes y el step-model del decomposer recursivo. Binario configurable vía `MANYHANDS_GEMINI_BIN` (default `gemini`). Reemplazó a Codex CLI en junio 2026.

**Invocación:**
- Hojas: `gemini -p <prompt>` con el prompt enviado por stdin, `--approval-mode yolo` (auto-aprueba tool calls para no bloquear en headless)
- Decomposer: `--approval-mode plan` (read-only; puede leer archivos, no puede escribir ni ejecutar)

**No hacer:**
- No invocar `child_process.exec` o `spawn` directamente sin el wrapper `GeminiCliExecutor`
- No usar Claude Code SDK, subprocess directo, ni ningún otro CLI como executor
- No sugerir volver a Codex sin consultar a Francisco

**Refs:** ADR-0019 (superseded por ADR-0029), ADR-0029

---

## Fuente de Verdad del Resultado

**Decisión (D5):** `git diff HEAD` es la única fuente de verdad de lo que un agente cambió. El stdout/stderr se persiste (`stderrTail`/`stdoutTail`) solo para diagnóstico en la UI, nunca para determinar qué cambió.

**Por qué:** El output de un LLM puede ser alucinado. Un agente puede reportar "implementé X" sin haber tocado ningún archivo. `git diff HEAD` es objetivo y verificable.

**Regla adicional:** Un diff vacío + exit 0 = `empty_diff`, no `success`.

**No hacer:**
- No confiar en el stdout del agente para determinar qué archivos cambió
- No tratar `empty_diff` como éxito

**Ref:** ADR-0020

---

## El Orquestador Hace Commit

**Decisión (D6):** El agente (Gemini CLI) nunca debe hacer commit. El flujo es: `git diff HEAD` → scope check → validación → commit (orquestador). Si el agente hace commit, se detecta por comparación de SHA (`agentCommittedUnexpectedly: true`). Política configurable: `reject` (default) o `accept`.

**Por qué:** Sin este control el orquestador pierde el commit graph, los mensajes no son estructurados, y el cherry-pick downstream se vuelve impredecible.

**No hacer:**
- No dejar que `--approval-mode yolo` sea la única barrera contra commits del agente — el `WorktreeManager` detecta commits inesperados independientemente

**Refs:** ADR-0021, ADR-0022

---

## Scope e Aislamiento

**Decisión (D7):** El aislamiento real lo dan el **git worktree aislado** + el `ScopeChecker`, no el sandbox del CLI. `SandboxMode` (`workspace-write`/`danger-full-access`) se conserva en el contrato pero `GeminiCliExecutor` mapea ambos a `--approval-mode yolo`.

**Scope:** Tres categorías — `implementationPaths`, `testPaths`, `configPaths` (globs). `forbiddenPaths` siempre gana sobre `executionScope` ("deny wins").

**No hacer:**
- No depender del sandbox del CLI como única barrera de aislamiento
- No ignorar `forbiddenPaths` aunque haya overlap con `executionScope`

**Refs:** ADR-0018, ADR-0023

---

## Integración: Cherry-Pick + Repair Semántico

**Decisión (D8):** Integración vía cherry-pick de commits hijo sobre rama padre. Ante conflicto, el Composer invoca Gemini como reparador semántico (máximo 1 intento). El repair recibe: goal del padre, `sharedInterface` canónico, intención de cada hijo involucrado, diff en conflicto. Falla → `IntegrationStatus: executor_repair_failed`.

**No hacer:**
- No usar `git merge` (crea merge commits que complican el historial y el rollback)
- No usar `git rebase` (reescribe historial, conflictúa con el tracking del orquestador)
- No hacer más de 1 intento de repair por integración (ADR-0025)

**Ref:** ADR-0025

---

## Scheduling y Timeouts

**Decisión (D9):** `maxParallel = 3` hojas en paralelo por batch. Configurable vía `ExecutionConfig`.

**Decisión (D10):** Timeouts por defecto: hoja `300_000 ms` (5 min), integración `600_000 ms` (10 min). Configurables por contrato.

**Ref:** ADR-0026

---

## Modelo de Datos

**Decisión (D1):** `graph.dependencies` es canónico. `node.dependencies` es shortcut sincronizado. Mutación solo vía helpers: `addDependency`, `removeDependency`, `syncNodeDependencies`. Nunca mutar directamente.

**Decisión (D2):** Campo canónico de intención de tarea es `goal` (nunca `intent`). Si aparece `intent` en fixtures legacy, normalizar en el parser, nunca persistir.

**Decisión (D3):** Sin `scenarioId` + LLM falla → run FALLA con error accionable. Sin fallback silencioso al grafo genérico. `MetadataDrivenMockDecomposer` solo cuando hay `scenarioId` (Lab Mode).

---

## Decomposer

**Decisión:** Default del producto = `GeminiRecursiveDecomposer` (interface-aware, recursivo, usa Gemini CLI en `--approval-mode plan`). Baselines opt-in vía `MANYHANDS_DECOMPOSER`:

| Valor | Decomposer | Requisito |
|-------|-----------|-----------|
| (default) | `GeminiRecursiveDecomposer` | `MANYHANDS_GEMINI_BIN` |
| `single-pass` | `AnthropicSinglePassDecomposer` | `ANTHROPIC_API_KEY` |
| `anthropic-recursive` | `AnthropicRecursiveDecomposer` | `ANTHROPIC_API_KEY` |
| (`MANYHANDS_FORCE_FALLBACK=1`) | `MetadataDrivenMockDecomposer` | Lab Mode only |

**Granularidad:** `low|medium|high` sesga el umbral de atomicidad por nodo, no fija profundidad ni cantidad de nodos. El árbol resultante es asimétrico; cada rama llega a la profundidad que su complejidad justifica. G3/G6/G9 son etiquetas observadas en experimentos, no objetivos de forma.

**sharedInterface:** Cada paso de descomposición genera costuras TypeScript entre hijos paralelos. El `ContextPacker` las inyecta en el prompt de cada hoja. Esto es Artifact 1 de tesis.

**No hacer:**
- No asumir que la granularidad fija cantidad de nodos (era el diseño anterior, superseded)
- No implementar lógica de descomposición fuera de `packages/decomposer/`

---

## Packages: Estado

| Package | Estado | Notas |
|---------|--------|-------|
| `task-graph` | ACTIVO | Core del modelo de nodos |
| `contracts` | ACTIVO | AgentTaskContract V1+V2, InterfaceContract |
| `decomposer` | ACTIVO | GeminiRecursiveDecomposer + baselines |
| `execution-core` | ACTIVO | Pipeline completo implementado |
| `scheduler` | ACTIVO | sequential, naive, risk-aware |
| `run-store` | ACTIVO | RunSnapshot, patches, JSON persistence |
| `trace-store` | ACTIVO | 50+ trace event types |
| `shared` | ACTIVO | Sin cambios |
| `conflict-risk` | DEFER | No en path crítico |
| `scope-validation` | DEFER | Reemplazado por ScopeChecker en execution-core |
| `worktree-runner` | DEFER | Mock legacy, solo referencia |
| `repository-index` | DEFER | Índice estructural del repo |
| `evaluator` | DEFER | Lab Mode, infraestructura de tesis |
| `core` | DEPRECATED | Barrel de compat; no usar para dependencias nuevas |
