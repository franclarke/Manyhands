# Walkthrough — Sesión 2026-06-11 (UI/UX Professionalization Pass)

> PR: pase de profesionalización UI/UX del flujo core de ManyHands.
> Auditoría completa + plan + resultados: [`docs/ui-audit/manyhands-ui-audit.md`](docs/ui-audit/manyhands-ui-audit.md).
> Before/after: `docs/ui-audit/screenshots/{before,after}/`.

## Qué se hizo

1. **Auditoría escrita** (scorecard 11 dimensiones, issues por área, plan PR-shaped) antes de tocar código.
2. **Loop A — fundación**: fix de capas CSS (`@layer base` para resets — los resets sin capa pisaban TODAS las utilidades Tailwind en form controls, la causa raíz de los inline styles), `Button` con estados completos, `StatusPill`, `ConfirmDialog`, `.mh-skeleton` (el loading del run era invisible), fix SSR de `useDefaultLayout` (500 intermitente en /runs/[runId]), purga de 18 componentes muertos + `/counter` + jest vestigial roto, readiness/preflight traducidos al español.
3. **Loop B — shell**: sidebar tokenizada, sin links 404 (/compare /benchmarks /settings), conflictos en ámbar (rust solo si el run falló).
4. **Loop C — new run**: composer de una sola tarjeta (contexto + prompt + acciones + drawer avanzado con labels), CTA estable "Generar plan" con razón de bloqueo, pills Repo/Gemini separadas, ConfirmDialog para borrar workspace.
5. **Loop D — cockpit**: header jerárquico (sin UUIDs crudos), chat por id semántico de mensaje (sin string-sniffing), GateCard que apunta a su decisión por id, wave-progress con títulos reales de nodos, **eliminada la respuesta fake del asistente**, composer honesto conectado a `/api/runs/[id]/answer` (responde preguntas del planner), errores de acciones visibles, estado Conectado/Reconectando real, tabs ARIA con flechas.
6. **Loop E — DAG**: lanes sin ember (P1: el calor es estado vivo), nodo raíz distinto, minimapa >12 nodos, canvas sin banda inferior, failed/blocked/obsolete tintan el borde de la card (obsolete nunca rojo), bug del dato falso "Profundidad: 3" corregido.
7. **Loop F — polish**: FocusPanel 100% tokens semánticos, reduced-motion ampliado (`animate-pulse`, `.mh-skeleton`), selects con caret custom, targets 28px con aria-label.
8. **Build de producción reparado**: el patch de `@assistant-ui/tap` no era production-safe (accesos `React['x']` estáticamente analizables → errores webpack en prod); endurecido con accessors opacos. `pnpm web:build` ahora pasa.

## Verificación

- `pnpm test` → 925 passed / 3 skipped (1 assert actualizado por traducción de readiness).
- `pnpm typecheck`, `pnpm -F @manyhands/web typecheck`, `pnpm -F @manyhands/web lint`, `pnpm -F @manyhands/web contrast:check` → limpios.
- `pnpm web:build` → ✅ (estaba roto pre-pase).
- `pnpm lint` raíz → 56 errores **preexistentes** fuera del alcance UI (packages/, scratch/, tests/), documentados como follow-up.

## Notas operativas

- Screenshots reproducibles: `apps/web/scripts/ui-shots.mjs` y `ui-shot-crop.mjs` (puppeteer-core devDep raíz + Chrome del sistema; `MSYS_NO_PATHCONV=1` en git-bash).
- Se detuvo un dev server huérfano en :3000 (PID 9828, de ayer) que lockeaba `next-swc` y rompía los installs.
- Follow-ups priorizados en la sección 7.4 del audit doc.

---

# Walkthrough — Sesión UltraCode 2026-06-10 (frontera end-to-end)

Reporte de cambios de la sesión. Detalle completo del diseño y el mapa
instruir/evaluar/corregir: ver [`implementacion-frontera.md`](implementacion-frontera.md).

## Commits de checkpoint

1. `b3b798d` — **execution-core multi-executor**: capa por perfiles
   (`CliAgentExecutor` + `CliExecutorProfile`), rediseño Gemini (`-o json` con token
   stats), Claude Code con `--output-format json` (usage/costo reportados), Codex CLI
   habilitado (`codex exec` headless), clasificador de fallos (`failureKind`/`failureHint`),
   canal send-to-user (`MH_STATUS` → trazas `agent_status`), upgrade automático de
   `usageSource` en el recorder.
2. `411adc5` — **enrutamiento por complejidad**: scorer determinista explicable,
   política por tiers con fallback por disponibilidad real de binarios, escalación de
   tier en repairs, traza `executor_routed`, `executionConfig.routing`.
3. `5a5f2f2` — **planning sobre LangGraph**: StateGraph v2 con gates baratos
   (`questionGate`/`approvalGate` con `interrupt()` nativo), critics in-loop,
   `planning-host.ts`, resume nativo con `Command({ resume })` en
   resume/answer/decisions/approve-plan, thread `${runId}__planning`,
   `DecomposerQuestionError` eliminado del flujo de orquestación.
4. `9cf6439` — **re-decomposición selectiva**: `graftSubtree` (task-graph),
   `AmendmentsEngine.invalidateTask` (cierre subárbol+dependientes+ancestros),
   `replan-service.ts` (re-plan scoped con seams congelados), gate option
   `replan_subtree` en el leafGate.

## Verificación

- `pnpm -F @manyhands/execution-core typecheck` ✅
- `pnpm -F @manyhands/orchestrator-graph typecheck` ✅
- `pnpm -F @manyhands/task-graph typecheck` ✅
- `pnpm web:typecheck` ✅
- `pnpm build` ✅
- `pnpm typecheck` (raíz) ✅ — exit 0. Nota: el typecheck raíz estaba roto desde antes
  (sin mapping `@/*` y ~40 errores latentes en fixtures de tests que vitest nunca
  typecheckeó); se agregó el alias a `tsconfig.base.json`, lib DOM al programa raíz,
  y se repararon los 21 archivos de test afectados.
- `pnpm test` ✅ — 925 tests passed / 3 skipped (96 archivos; baseline previo: 868 / 88)

## Archivos clave nuevos

- `packages/execution-core/src/executor/{cli-executor,failure,status-channel}.ts`
- `packages/execution-core/src/executor/profiles/{gemini,claude-code,codex}.ts`
- `packages/execution-core/src/routing/{complexity,policy,availability}.ts`
- `packages/orchestrator-graph/src/graphs/planning-graph.ts` (v2) + test
- `apps/web/src/lib/server/runs/{planning-host,replan-service}.ts`

## Eliminado (cero legacy)

- `packages/execution-core/src/executor/{gemini-cli,claude-code-cli}.ts`
  (reemplazados por perfiles + executor genérico)
- Planning nodes v1 (cola por superstep con interrupt dentro del nodo caro) y su test
- Flujo exception-driven de preguntas en `planning-pipeline.ts` (653 → driver fino)
