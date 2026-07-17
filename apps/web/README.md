# ManyHands Web

`apps/web` contiene el producto Next.js actual: Command Center, workspaces, runs,
APIs y el prototipo `/runs/proto`.

> Estado de transición: el código actual usa un run model y superficies heredadas
> que deben auditarse contra [`docs/system/10-web-app.md`](../../docs/system/10-web-app.md)
> y [`docs/design/interaction-model.md`](../../docs/design/interaction-model.md).

## Dirección objetivo

- una ruta continua por run;
- grafo central durante planning/ejecución;
- resultado/evidencia central al finalizar;
- reducer + selectors sobre eventos de dominio;
- decisiones contextuales que bloquean solo alcance afectado;
- sin destinos primarios separados de Tasks/Planning/Integration/Interfaces;
- sin auto-fit o recentrado por eventos;
- WCAG 2.2 AA y reduced motion.

## Proto

`/runs/proto/[fixture]` reproduce fixtures contra el modelo cliente actual. Su
sidebar muestra fixtures y no datos reales. Un fixture es demostración/regresión
de UI, no evidencia backend. Ver
[`docs/design/golden-fixtures.md`](../../docs/design/golden-fixtures.md).

## Puntos actuales

- `src/app/(command-center)/`: creación y navegación.
- `src/app/runs/[runId]/`: workspace real.
- `src/app/runs/proto/`: fixtures.
- `src/lib/server/runs/`: planning, lifecycle, ejecución y delivery web.
- `src/lib/run-model/`: tipos, reducer, selectors y view models actuales.
- `src/components/run-model/`: proyección del run.

Runs y workspaces persisten actualmente bajo `.manyhands/` con overrides por
variables de entorno. La arquitectura objetivo exige separar event log de
dominio, snapshots y trazas; no asumir que la persistencia actual ya cumple.

## Comandos

```bash
pnpm web:dev
pnpm web:typecheck
pnpm web:lint
pnpm web:build
```

Variables actuales: `MANYHANDS_CLAUDE_BIN`, `MANYHANDS_CODEX_BIN`,
`MANYHANDS_DECOMPOSER`, `MANYHANDS_RUNS_DIR`, `MANYHANDS_WORKSPACES_FILE` y
`MANYHANDS_REPO_ROOT`.
