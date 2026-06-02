# ManyHands — Contexto para Claude

> Francisco es el único desarrollador. Comunicación en español. Decisiones ya cerradas no se renegocian.
> Para síntesis de decisiones: [`docs/DECISIONS.md`](docs/DECISIONS.md).
> Para narrativa del proyecto: [`docs/thesis/project-evolution.md`](docs/thesis/project-evolution.md).

---

## Qué es ManyHands

Sistema de orquestación de agentes LLM para desarrollo de software. Toma una feature en lenguaje natural, la descompone recursivamente en un DAG jerárquico con costuras de interfaz explícitas (`sharedInterface`), ejecuta las hojas en git worktrees aislados con **Gemini CLI** (`gemini`, headless), e integra resultados de abajo hacia arriba con cherry-pick.

**Contexto académico:** Tesis de Ingeniería en Sistemas. Pregunta: ¿existe una granularidad óptima de descomposición DAG que maximiza la calidad del output de agentes LLM paralelos?

**No es:** un agente de código, un RAG system, una herramienta de memoria organizacional, ni un plugin de IDE.

---

## Estado Actual

### Verificación rápida
```bash
pnpm test                  # 455 passing, 3 skipped
pnpm -F @manyhands/execution-core typecheck  # 0 errores
pnpm build                 # packages OK
pnpm web:typecheck         # 0 errores
```

### Banderas ⚠️
- **Migración Codex→Gemini sin commitear** — el código en disco ya es Gemini CLI; el último commit de execution-core todavía dice "Codex CLI". Commitear antes de continuar.
- **Sin evidencia empírica** — el pipeline con Gemini está cableado y los tests E2E pasan, pero los experimentos de granularidad (B0-B4 × low/medium/high con Gemini reales) no se corrieron. Solo existe validación estructural con mock.
- **`packages/calculator/`** — artefacto untracked trivial (smoke test), eliminar o gitignorar.

---

## Decisiones Cerradas (NO renegociar)

| ID | Decisión |
|----|----------|
| D1 | `graph.dependencies` es canónico. `node.dependencies` es shortcut sincronizado. Mutación via `addDependency`, `removeDependency`, `syncNodeDependencies`. |
| D2 | Campo canónico es `goal` (no `intent`). Si aparece `intent` en fixtures legacy, normalizar en el parser. |
| D3 | Sin `scenarioId` + LLM falla → run FALLA con error accionable. Sin fallback silencioso. `MetadataDrivenMockDecomposer` solo con `scenarioId` (Lab Mode). |
| D4 | **Gemini CLI** (`gemini`, headless, stdin) es el único executor de subagentes Y el step-model del decomposer. No Claude Code SDK, no subprocess directo, no otros CLIs. Seam provider-agnóstico: interfaz `AgentExecutor`. Binario: `MANYHANDS_GEMINI_BIN` (default `gemini`). |
| D5 | `git diff HEAD` es la fuente de verdad del resultado. No stdout del agente. `stderrTail`/`stdoutTail` se persisten solo para diagnóstico. |
| D6 | **El orquestador hace commit.** El agente nunca debe commitear. Si commitea, política `reject` (default) o `accept`. |
| D7 | Aislamiento real = git worktree aislado + `ScopeChecker`. `SandboxMode` del contrato se mapea a `--approval-mode yolo`. Decomposer corre en `--approval-mode plan`. |
| D8 | Integración: cherry-pick + repair semántico con Gemini (máx. 1 intento). Repair incluye: goal del padre, `sharedInterface` canónico, intención de cada hijo. |
| D9 | `maxParallel = 3` hojas en paralelo (configurable). |
| D10 | Timeouts: hoja 300 s, integración 600 s (configurables por contrato). |

---

## Arquitectura de Paquetes

| Package | Estado | Notas |
|---------|--------|-------|
| `task-graph` | ACTIVO | TaskNode, TaskGraph, validación |
| `contracts` | ACTIVO | AgentTaskContract V1+V2, InterfaceContract |
| `decomposer` | ACTIVO | GeminiRecursive (default) + baselines |
| `execution-core` | ACTIVO | Pipeline completo de ejecución real |
| `scheduler` | ACTIVO | sequential, naive, risk-aware |
| `run-store` | ACTIVO | RunSnapshot, patches |
| `trace-store` | ACTIVO | 50+ trace event types |
| `shared` | ACTIVO | — |
| `conflict-risk` | DEFER | — |
| `scope-validation` | DEFER | Reemplazado por ScopeChecker |
| `worktree-runner` | DEFER | Mock legacy |
| `repository-index` | DEFER | — |
| `evaluator` | DEFER | Lab Mode |
| `core` | DEPRECATED | Barrel de compat; no usar |

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
| `packages/execution-core/src/types.ts` | Zod schemas de ejecución |
| `packages/execution-core/src/errors.ts` | Jerarquía de error classes |
| `apps/web/src/lib/server/runs/runner.ts` | Planning + execution pipeline (motor real) |
| `apps/web/src/lib/decomposer-policy.ts` | `pickDecomposer()` — Gemini por default |
| `apps/web/src/lib/server/runs/schema.ts` | RunRecord schema (Zod) |
| `apps/web/src/lib/graph-view-model.ts` | RunGraphViewModel, InspectorView |
| `benchmarks/expression-calculator/` | Fixture con costuras reales (tesis) |
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
4. **El orquestador hace commit.** Nunca generar código que haga que Gemini commitee.
5. **Error claro sobre fallback silencioso** (D3). Si falta API key → error accionable, no grafo genérico.
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
# MANYHANDS_GEMINI_BIN        ruta al binario gemini (default: gemini)
# MANYHANDS_DECOMPOSER        single-pass | anthropic-recursive (baselines opt-in)
# MANYHANDS_FORCE_FALLBACK=1  fuerza MetadataDrivenMockDecomposer (Lab)
```
