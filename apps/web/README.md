# ManyHands Web

`apps/web` es la aplicación Next.js de ManyHands. Expone el Command Center, el
workspace de runs, APIs de workspaces/runs y la proyección agent-first basada en
`RunEvent`.

No es una app de Lab Mode ni un runner de benchmarks. Las rutas antiguas
`/lab`, `/lab/benchmarks`, `/lab/reports`, `/replay` y `/replay/demo` fueron
retiradas. Los prototipos bajo `/runs/proto/[fixture]` usan golden fixtures del
modelo de eventos para validar UI/reducer/selectores; no son benchmarks de
calidad.

## Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- App Router route handlers
- `react-resizable-panels` para el workspace multipanel

## Commands

Desde la raíz del repo:

```bash
pnpm web:dev
pnpm web:typecheck
pnpm web:lint
pnpm web:build
```

## Routes

- `/` — Command Center: prompt + workspace + granularidad + modelo.
- `/workspaces` — configuración de repositorios locales.
- `/runs/[runId]` — sala de control agent-first del run.
- `/runs/proto` — índice de golden fixtures de UI.
- `/runs/proto/[fixture]` — reproducción fixture-first del modelo de eventos.

## API Routes

- `GET /api/health`
- `GET /api/providers/readiness`
- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/[id]`
- `PATCH /api/workspaces/[id]`
- `DELETE /api/workspaces/[id]`
- `POST /api/local-fs/browse`
- `GET /api/runs[?workspaceId&limit]`
- `POST /api/runs`
- `GET /api/runs/[id]`
- `GET /api/runs/[id]/events`
- `GET /api/runs/[id]/run-events`
- `POST /api/runs/[id]/approve-plan`
- `POST /api/runs/[id]/run`
- `POST /api/runs/[id]/pause`
- `POST /api/runs/[id]/resume`
- `POST /api/runs/[id]/cancel`
- `POST /api/runs/[id]/restart`
- `POST /api/runs/[id]/fork`
- `POST /api/runs/[id]/answer`
- `POST /api/runs/[id]/auto-resolve`
- `POST /api/runs/[id]/serialize`
- `GET /api/runs/[id]/export`
- `GET /api/runs/[id]/artifacts?ref=...`
- `POST /api/runs/[id]/decisions/[decisionId]`
- `PATCH /api/runs/[id]/nodes/[taskId]`
- `POST /api/runs/[id]/nodes/[taskId]/review`
- `POST /api/runs/[id]/nodes/[taskId]/regen`
- `POST /api/runs/[id]/nodes/[taskId]/run`
- `POST /api/runs/[id]/dependencies`
- `POST /api/runs/[id]/risks/acknowledge`
- `POST /api/runs/[id]/integrator`

## Workspaces

Workspaces persisten en `.manyhands/workspaces.json` salvo que se configure
`MANYHANDS_WORKSPACES_FILE`. La persistencia vive en
`src/lib/server/workspaces/repository.ts`.

Un workspace puede apuntar a un repo local y guardar hints de planificación:
`repoPath`, `packageManager`, `defaultBranch`, `allowedPaths`, `testCommand`,
`buildCommand`.

## Runs

Runs persisten en `.manyhands/runs/<runId>.json` como `{ version, run }`
validado con Zod. La persistencia vive en
`src/lib/server/runs/repository.ts`.

El lifecycle se coordina desde:

- `src/lib/server/runs/planning-host.ts`
- `src/lib/server/runs/execution-host.ts`
- `src/lib/server/runs/runner.ts`
- `src/lib/server/runs/lifecycle.ts`

La ejecución usa checkpoints JSON de LangGraph bajo `.manyhands/` y puede
reanudar/forkear desde esos checkpoints.

## Run Model

La UI agent-first consume un log append-only de `RunEvent`:

- `src/lib/run-model/reducer.ts` reduce eventos.
- `src/lib/run-model/selectors.ts` deriva estado.
- `src/lib/run-model/workspace-view.ts`, `focus-view.ts` y `timeline-view.ts`
  producen view-models.
- `src/components/run-model/` renderiza la experiencia.

Regla: la UI no debe escribir estado derivado imperativo para nodos. Si algo se
ve en pantalla, debe salir del log + reducer + selectores.

## Environment

- `MANYHANDS_GEMINI_BIN` — ruta al binario de Gemini CLI.
- `MANYHANDS_DECOMPOSER` — override de decomposer para desarrollo.
- `MANYHANDS_RUNS_DIR` — override del directorio de runs.
- `MANYHANDS_WORKSPACES_FILE` — override del archivo de workspaces.
- `MANYHANDS_REPO_ROOT` — ancla alternativa para `.manyhands/`.

## Tests

Los tests de web y run model viven en `tests/` en la raíz del repo y corren con:

```bash
pnpm test
pnpm web:typecheck
```

