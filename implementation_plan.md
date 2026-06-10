# Implementation Plan — High-Effort Frontier Session (2026-06-10)

Auditoría completa en `docs/design/future-frontier-tasks.md` (hallazgos + diseño).
Este archivo es el plan operativo de implementación, en orden de ejecución.

## Diagnóstico clave (resumen)

| # | Hallazgo | Severidad |
|---|----------|-----------|
| 1 | El grafo de ejecución LangGraph retorna `Send[]` desde un nodo → `InvalidUpdateError` en el primer batch. El pipeline de ejecución por defecto **no puede completar ningún run real**. Cero tests del grafo. | Crítica |
| 2 | `currentBatchIndex` nunca se incrementa tras despachar → loop infinito latente aunque (1) se arreglara. | Crítica |
| 3 | `/resume` muta el JSON del checkpoint a mano y relanza con `stream(null)` → el nodo interrumpido re-ejecuta el executor completo y vuelve a interrumpir. Los payloads de decisión de la UI se descartan. | Crítica |
| 4 | `interrupt()` dentro de nodos caros (post-executor, loop de integración monolítico) → resume repite trabajo de agente y cherry-picks sobre worktrees sucios. | Alta |
| 5 | Scheduler risk-aware desconectado (`riskMatrix: []`, política `parallel_naive`). | Alta |
| 6 | `runner.ts` (2 382 líneas) duplica lógica de dominio de execution-core (repair de hojas inline). | Alta |
| 7 | Composer no valida sintaxis post-repair; GroundingAgent 100% LLM sin garantía de compilación. | Media |
| 8 | UI legacy (`?model=legacy`, DagCanvas, TaskInspector, kanban, timeline) viva contra la política de cero legacy. | Media |
| 9 | Falta `react-resizable-panels` para el layout multipanel exigido por el sistema de diseño. | Media |

## Fases

### F1 — Execution StateGraph idiomático (backend, crítico)
1. Reescribir `packages/orchestrator-graph/src/state.ts`: reducers de identidad
   (merge por taskId), canal `acceptedFailures`, limpieza de canales muertos.
2. Reescribir `execution-nodes.ts` + `execution-graph.ts` con la topología:
   `prepare → [routeFrontier] → Send(executeLeaf)* → waveJoin → [routeFrontier]`,
   gates puros `leafGate`/`conflictGate` (interrupt-first, Command-resume),
   `integrateNextComposite` (un composite por superstep), `runValidation`.
3. Decisiones tipadas `ResumeDecision` exportadas del paquete.
4. Test suite nueva `execution-graph.test.ts` (deps falsas, checkpointer real en
   tmp): paralelismo, orden de waves, retry, accept-failing, conflicto, resume
   por `Command({resume})` tras reinicio del grafo.

### F2 — Scheduler scope-aware (backend)
5. `selectScopeAwareWave` en `@manyhands/scheduler` + heurística de solape de
   globs por prefijo + serialización por riesgo high/blocking. Tests.
6. Conectar la riskMatrix real del planning al host de ejecución.

### F3 — Composer AST + GroundingAgent determinista (backend)
7. `integration/syntax-check.ts` (marcadores de conflicto + parse diagnostics TS)
   y loop de repair multi-intento (máx. 2) con feedback de compilador en
   `IntegrationAgent`. Tests con executor mock.
8. `run/skeleton-scaffolder.ts`: scaffolding determinista de InterfaceContracts +
   extracción de tipos exportados del repo para imports; LLM solo como fallback;
   validación sintáctica del esqueleto antes del commit. Tests.

### F4 — Host de ejecución y resume nativo (web server)
9. `apps/web/src/lib/server/runs/execution-host.ts`: deps + grafo compilado +
   loop de stream compartido entre start/resume; manejo de interrupts → estado
   `paused` con `pendingDecision` tipada.
10. Mover el repair de hojas a `execution-core` (`RunExecutor.repairLeaf`).
11. Reescribir `/api/runs/[id]/resume`: planning → flujo existente; ejecución →
    `Command({ resume: decision })`. Borrar la mutación manual de checkpoints.
12. Adelgazar `runner.ts` (planning pipeline + façade).

### F5 — UI: legacy fuera, multipanel dentro
13. Borrar la rama `?model=legacy` de `page.tsx`, `RunCanvasBinding`, y todos los
    componentes `components/dag/*` + hooks alcanzables solo desde ahí; conservar
    las librerías de dominio que usa el runner (`live-graph`, `conflict-view-model`).
14. Instalar `react-resizable-panels`; aplicarlo al workspace agent-first
    (workspace ⇄ focus panel redimensionable con persistencia).

### F6 — Validación y documentación
15. `pnpm -F @manyhands/execution-core typecheck` + `pnpm web:typecheck` limpios;
    `pnpm test` 100% verde (847 base + nuevos); invariantes
    `tests/run-model-invariants.test.ts`.
16. Actualizar `docs/system/` afectados; escribir `walkthrough.md`; commits de
    checkpoint por fase.

## Riesgos y mitigaciones
- **Resume de ejecución depende de deps reconstruibles** → el host reconstruye
  deps desde el RunRecord persistido (provisioned repo, config), nunca desde
  closures en memoria.
- **Borrado legacy puede romper tests de UI-model** → se ejecuta la suite tras
  cada borrado; las librerías compartidas se conservan.
- **Windows paths en checkpoints/worktrees** → tests usan `tmpdir()` y `join()`.
