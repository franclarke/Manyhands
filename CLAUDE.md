# ManyHands — Guía operativa para Claude Code

> Comunicación con Francisco: español. Código y nombres técnicos: inglés.
> Comenzar por [`PRODUCT.md`](PRODUCT.md) y [`docs/README.md`](docs/README.md).

## Contexto

ManyHands coordina agentes para convertir un objetivo de software en un resultado
integrado, verificado y entregado. El repositorio está en transición: los
documentos canónicos describen el target y el código puede estar parcial o ser
incompatible.

No presentes una capacidad objetivo como implementada sin evidencia en código,
tests y, cuando corresponda, un run persistido.

## Fuentes de decisión

1. `PRODUCT.md` — producto.
2. `docs/DECISIONS.md` — decisiones objetivo.
3. `docs/system/` — contratos técnicos.
4. `docs/design/` — experiencia y sistema visual.
5. `docs/adr/` — razones y trade-offs.

Las auditorías y planes anteriores fueron retirados. El futuro gap analysis debe
clasificar cada capacidad como implemented, partial, missing, incompatible o
unknown.

## Arquitectura objetivo resumida

- Grafo híbrido grounded en el repositorio.
- Relaciones canónicas: ownership, artifacts, seams y conflict constraints.
- Planner separado de Graph Compiler.
- Contratos de scope, artifacts, seams y validación versionados.
- Intentos inmutables con inputs exactos.
- Readiness basada en artifacts, decisiones, recursos y riesgo.
- Recuperación por causa.
- Eventos de dominio como historia; snapshots como proyección.
- Decisiones humanas locales y no bloqueantes para trabajo independiente.
- Evidence Matrix sobre commits exactos.
- Integración bottom-up y entrega del tree validado.
- Frameworks y executors detrás de adapters.

## Trabajo seguro sobre el código actual

- Confirmar Git root, status y diff antes de editar.
- Preservar cambios ajenos; nunca reset/clean/stash global.
- Leer la ruta productiva y sus tests.
- Para cambios conductuales, usar TDD: regression roja, fix mínimo, refactor.
- Mantener worktree isolation, diff inspection, scope, commits del orquestador,
  Process Supervisor, leases y fencing durante la migración.
- No introducir duplicados de estado o relaciones como puente sin retiro
  explícito.
- Preferir slices verticales y diffs pequeños a una reescritura total.
- El índice usa LF y `core.autocrlf=false`. Las herramientas de edición escriben
  CRLF, lo que produce diffs de archivo entero. Normalizar a LF los archivos
  modificados antes de cada commit y verificar con `git diff --numstat`.
- No marcar un ticket `closed` sin haber corrido `pnpm test` **completo sobre su
  commit exacto**. Cerrar 23–26 con gates focales dejó 12 tests rojos que nadie
  vio hasta el freeze siguiente, incluidos tres defectos productivos reales.

## Monorepo actual

`apps -> packages específicos -> shared`. `@manyhands/core` es legacy.

- `task-graph`: grafo actual.
- `contracts`: contratos actuales.
- `decomposer`: planning recursivo actual.
- `orchestrator-graph`: StateGraphs/control plane actual.
- `execution-core`: worktrees, executors, scope, validación e integración.
- `scheduler`, `conflict-risk`: waves y riesgo.
- `repository-index`: grounding estructural.
- `run-store`, `trace-store`: persistencia y trazas.
- `apps/web`: Command Center y Run Workspace.

## UI objetivo

- Un workspace por run.
- Grafo central durante planning/running; evidencia central al final.
- Sin destinos primarios separados de Tareas/Planificación/Integración/Interfaces.
- Tarjeta de decisión contextual + dialog accesible + cola.
- El canvas no se recentra, enfoca ni hace fit por eventos.
- Candidate, verified, stale, failed y delivered son estados distintos.
- WCAG 2.2 AA y `prefers-reduced-motion`.

## Definición de terminado

1. Comportamiento observable especificado.
2. Test o evidencia de regresión antes del cambio conductual.
3. Implementación mínima alineada al target.
4. Checks estrechos y luego consumidores relevantes.
5. Docs y futuro ledger de transición actualizados.
6. Diff final inspeccionado; limitaciones declaradas.

```bash
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
```

Para cambios solo documentales, verificar links relativos, términos obsoletos y
consistencia; no es necesario ejecutar builds del producto.

### Verificar UI en el navegador

La ruta `/` tarda minutos en responder (dev y producción) con datos reales, así
que el preview pane se cuelga y no sirve para verificar. Para inspeccionar
componentes globales como la barra lateral: `pnpm web:build`, arrancar el
preview `web-prod` de `.claude/launch.json` y abrir `/runs/<runId>` (~10 s).
Ahí la barra lateral monta colapsada: expandirla con el botón
`aria-label="Expandir barra lateral"` antes de leer el DOM.

## Agent skills

### Issue tracker

El trabajo se registra como Markdown local bajo `.scratch/`; no se publica
remotamente sin autorización explícita. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Los tickets locales usan los roles canónicos de Pocock más `closed`. Ver
`docs/agents/triage-labels.md`.

### Domain docs

Este monorepo usa un mapa de contextos sobre sus documentos autoritativos
existentes. Ver `CONTEXT-MAP.md` y `docs/agents/domain.md`.
