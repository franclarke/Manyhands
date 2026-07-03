# UI history run audit - 2026-07-03

## Objetivo y restricciones

Auditar la UI de ManyHands usando runs previos del historial, sin crear runs nuevos y sin ejecutar agentes/subagentes reales.

Restricciones respetadas:

- No se creo ningun run nuevo.
- No se aprobo ningun plan ni merge.
- No se hizo resume/run/cancel sobre runs existentes.
- No se invocaron agentes ni subagentes de ManyHands.
- Solo se navegaron rutas, panels, tabs, docks, drawer inferior y lectura de estado persistido.

## Entorno

- Repo root confirmado: `C:/Users/franc/Documents/Proyectos/Manyhands`.
- URL usada: `http://localhost:3001`.
- Servidor local: `apps/web/node_modules/.bin/next.CMD dev -p 3001`.
- Health check: `GET /api/health` respondio `{"ok":true,"app":"manyhands-web","mode":"development"}`.
- Browser: Codex in-app Browser sobre Chrome/Playwright.

Nota operativa: `pnpm web:dev` y `pnpm web:typecheck` quedaron bloqueados por `ERR_PNPM_IGNORED_BUILDS` porque el wrapper de pnpm intento instalar/validar dependencias y encontro build scripts no aprobados. Para no mutar dependencias, se uso `next dev` directo y verificaciones equivalentes directas.

## Runs revisados

| Run | Estado persistido | Eventos | UI revisada |
| --- | --- | ---: | --- |
| `14a468ad-610c-454e-8517-af19f54312a1` | `completed` | 82 | Run completado con `approve_merge` pendiente |
| `cb0e29cd-e595-48e8-9497-c5230a88c8bd` | `failed` | 158 | Run fallido con decisiones historicas resueltas |
| `b008a478-153b-4834-a5de-ebb940c89360` | `interrupted` | 86 | Run interrumpido con gate de ejecucion pendiente |

## Checklist probado

- Carga inicial de app y sidebar de historial.
- Navegacion desde `Runs recientes` hacia runs previos.
- Deep links `/runs/<runId>`.
- Header de run: estado, workspace, cantidad de tareas y conflictos.
- Timeline de fases.
- Panel Orquestador.
- Grafo de tareas.
- Dock superior: `Agentes`, `Archivos`, `Diff`.
- Drawer inferior: `Eventos`, `Validacion`, `Logs`.
- Refresh de pagina sobre run historico.
- Run completed, failed e interrupted.
- Consola del navegador y errores relevantes.
- Comparacion con `.manyhands/runs/<runId>.json` y `.events.jsonl`.

No se probaron botones mutantes como `Aprobar`, `Rechazar`, `Reintentar reparacion`, `Abortar run`, `Mergear a master`, `Limpiar worktrees` o `Descartar rama`.

## Comparacion UI vs estado persistido

### `14a468ad-610c-454e-8517-af19f54312a1`

Persistido:

- `status`: `completed`.
- `nodeCount`: 6.
- Ultimo evento: seq 82.
- Decisiones: `approve_plan` resuelta con `approve`; `approve_merge` pendiente.

UI:

- Muestra `Completado`, workspace `QA StrKit`, 6 tareas.
- Muestra `Aprobar merge`, consistente con `decision.raised:approve_merge`.
- `Diff` carga el diff integrado.
- `Logs`, `Eventos` y `Validacion` abren sin errores nuevos.

Resultado: consistente.

### `cb0e29cd-e595-48e8-9497-c5230a88c8bd`

Persistido:

- `status`: `failed`.
- `nodeCount`: 13.
- Ultimo evento: seq 158.
- Decisiones de reparacion/conflicto resueltas; no queda gate pendiente.

UI:

- Muestra `Fallido`, workspace `QA Events`, 13 tareas.
- Muestra decisiones historicas como resueltas.
- Grafo muestra nodos fallidos (`validation_failed`, `timeout`, `scope_violation`, `integration child_failed`).

Resultado: consistente despues de la correccion de liveness.

### `b008a478-153b-4834-a5de-ebb940c89360`

Persistido:

- `status`: `interrupted`.
- `nodeCount`: 11.
- Ultimo evento: seq 86.
- `approve_plan` resuelta; `clarify:app-shell` pendiente.

UI:

- Muestra `Omitido`, workspace `Task Pulse`, 11 tareas.
- Muestra `Gate de ejecucion` y opciones para `app-shell`.
- No se tocaron esos controles porque reanudarian o mutarian el run.

Resultado: consistente.

## Hallazgos

### Corregido: runs historicos terminales mostraban `Reconectando...`

Reproduccion:

1. Abrir `http://localhost:3001/runs/cb0e29cd-e595-48e8-9497-c5230a88c8bd`.
2. Esperar varios segundos.
3. El header del orquestador seguia mostrando `Reconectando...` aunque el run estaba `failed`, el historial ya estaba renderizado y el stream no necesitaba eventos nuevos para ser util.

Causa:

- El cliente marcaba `connected` solo desde `EventSource.onopen`.
- Para conexiones con `?after=<ultimo seq>`, la ruta SSE no enviaba datos hasta el heartbeat de 15s.
- En runs terminales (`completed`, `completed_with_accepted`, `failed`, `interrupted`), mostrar reconexion como alerta es ruido: la vista historica ya esta completa.

Correccion:

- La ruta `/api/runs/[id]/run-events` ahora flush-ea un comentario SSE inicial `: connected ...` despues del replay.
- `useLiveRunModel` considera terminales como conectados para el indicador visual de liveness, sin cambiar eventos ni reducer.

Verificacion visual:

- En `cb0e29cd-e595-48e8-9497-c5230a88c8bd`, una pestaña nueva muestra `Conectado` y no `Reconectando...`.

## Bugs no corregidos

No quedaron bugs de UI dentro del alcance que ameritaran cambio adicional.

Observaciones no corregidas:

- Durante `corepack pnpm -r --filter "./packages/*" build` con Next dev abierto, la consola del browser registro errores transitorios de modulos `packages/*/dist/index.js` faltantes. Esto fue causado por `tsup --clean` mientras el servidor dev estaba leyendo `dist`. No es un bug del flujo de historial, pero conviene evitar builds de paquetes en paralelo con `next dev` para QA manual.
- El run `completed` muestra botones de entrega mutantes (`Mergear a master`, `Limpiar worktrees`, `Descartar rama`) porque `approve_merge` esta pendiente. No se tocaron por restriccion del objetivo.

## Screenshots

- `C:\Users\franc\Documents\Proyectos\Manyhands\output\playwright\ui-history-audit-2026-07-03-completed-run.png`
- `C:\Users\franc\Documents\Proyectos\Manyhands\output\playwright\ui-history-audit-2026-07-03-failed-run.png`
- `C:\Users\franc\Documents\Proyectos\Manyhands\output\playwright\ui-history-audit-2026-07-03-interrupted-run.png`

## Verificacion ejecutada

Pasaron:

- `corepack pnpm vitest run tests/run-events-replay.test.ts`
- `corepack pnpm vitest run tests/run-events-replay.test.ts tests/run-model-live.test.ts`
- `corepack pnpm -r --filter "./packages/*" build`
- `apps/web/node_modules/.bin/tsc.CMD --noEmit`
- Browser manual sobre `http://localhost:3001`

Bloqueado:

- `pnpm web:dev`
- `corepack pnpm web:typecheck`

Motivo: ambos caminos invocaron el wrapper de `pnpm` que intento instalar/validar dependencias y fallo con `ERR_PNPM_IGNORED_BUILDS`.

## Archivos tocados

- `apps/web/src/app/api/runs/[id]/run-events/route.ts`
- `apps/web/src/components/run-model/use-live-run-model.ts`
- `tests/run-events-replay.test.ts`
- `tests/run-model-live.test.ts`
- `docs/development/ui-history-run-audit-2026-07-03.md`

## Proximos pasos para el futuro e2e real

- Correr el test end-to-end con un run nuevo cuando haya creditos suficientes.
- Antes de ese test, detener `next dev` si se van a reconstruir paquetes con `tsup --clean`.
- Probar explicitamente botones mutantes en un run disposable: approve plan, resolver gate, cancel/retry y merge/delivery.
- Revisar mobile/narrow con foco en drawer y dock si el test e2e futuro incluye captura responsive completa.
