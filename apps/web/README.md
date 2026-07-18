# ManyHands Web

`apps/web` contiene el Command Center y el workspace continuo de cada run. La
ruta productiva usa una sola arquitectura V2: journal de eventos canÃ³nico,
proyecciÃ³n descartable y una interfaz centrada en el grafo.

## Experiencia de run

- El grafo es la superficie principal durante planning y ejecuciÃ³n.
- Las decisiones aparecen asociadas a los nodos afectados y no detienen ramas independientes.
- Los contratos, seams, dependencias de artefactos y conflictos se leen en contexto.
- El canvas se encuadra una vez al abrirse; nuevos eventos no alteran el viewport del usuario.
- En `result_ready`, evidencia y publicaciÃ³n explican el resultado sin inventar estados cliente.

`/runs/proto/[fixture]` reproduce el mismo workspace con eventos V2 de ejemplo.
Su sidebar enumera fixtures, nunca workspaces o runs reales.

## API de runs

- `POST /api/runs`
- `GET /api/runs/[id]`
- `GET /api/runs/[id]/run-events` (SSE con replay por sequence)
- `POST /api/runs/[id]/run`
- `POST /api/runs/[id]/pause`
- `POST /api/runs/[id]/resume`
- `POST /api/runs/[id]/restart`
- `POST /api/runs/[id]/cancel`
- `POST /api/runs/[id]/decisions/[decisionId]`
- `POST /api/runs/[id]/deliver`

El journal V2 es la verdad durable. El `RunRecord` solo conserva identidad,
target inmutable, selecciones de executor y un cache de proyecciÃ³n para listas.

## Comandos

```bash
pnpm web:dev
pnpm web:typecheck
pnpm web:lint
pnpm web:build
```

Variables principales: `MANYHANDS_CLAUDE_BIN`, `MANYHANDS_CODEX_BIN`,
`MANYHANDS_DECOMPOSER`, `MANYHANDS_RUNS_DIR` y `MANYHANDS_WORKSPACES_FILE`.
