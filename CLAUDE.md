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
- `core.autocrlf=false`, así que el final de línea es parte del contenido. Las
  herramientas de edición escriben CRLF y eso produce diffs de archivo entero.
  **El índice no es uniforme**: la mayoría de los archivos está en LF pero
  algunos están commiteados en CRLF, así que normalizar todo a LF a ciegas
  reescribe esos por completo. Antes de cada commit, ajustar cada archivo
  modificado **al final de línea con que está commiteado** —
  `git show HEAD:<archivo> | grep -c $'\r$'` lo dice— y verificar con
  `git diff --numstat`: un archivo que suma y resta su longitud entera es la
  señal de que se corrigió para el lado equivocado.
- Antes de planificar o congelar una serie experimental, verificar que sus
  activos externos existan: el repositorio base con su SHA exacto, el seed, los
  targets y el evaluador externo que cubre *ese* alcance. Viven fuera de este
  repo y desaparecen sin dejar rastro en el historial; descubrirlo después de
  escribir el freeze cuesta la sesión entera.
- Que existan no alcanza: **ejecutar el oráculo en las dos direcciones antes de
  congelar**. Debe fallar sobre el target intacto —si pasa, no mide la tarea— y
  pasar sobre una solución de referencia desechable escrita fuera del repo. Sin
  la segunda mitad no hay forma de distinguir «el sistema falló» de «los
  criterios eran mutuamente imposibles». En SP2 eso reveló dos criterios
  declarados que el evaluador nunca comprobaba y un `deepStrictEqual` del
  fixture que volvía contradictorio el objetivo. Corregir oráculo y fixture es
  legítimo **sólo antes** del congelamiento, y se registra en la
  pre-registración.
- Toda derivación de una métrica se escribe **antes** de la serie y se verifica
  contra un journal real producido por el camino productivo, no sólo contra
  eventos armados a mano. Una derivación escrita después de ver los runs está
  ajustada a ellos. Si la evidencia no se registró, la métrica se reporta
  **ausente**, nunca en cero: «no se observó» no es «no había».
- **Un repositorio target no puede vivir en una ruta larga en Windows.** El ref
  de candidato por intento
  (`refs/manyhands/runs/<runId>/attempts/<runId>_attempt_<nodo>-<hash>/candidate`)
  ocupa ~136 caracteres él solo, porque el `runId` aparece **dos veces**. Con
  `MAX_PATH = 260` eso deja ~124 para la ruta del repo. Pasado ese límite el run
  muere con `update_ref failed ... unable to create directory` —y se clasifica
  `unclassified`, así que el mensaje es lo único que delata la causa—. Poner los
  targets en algo como `C:/mh-<serie>/<celda>`, nunca dentro del scratchpad de
  sesión, que ya arranca en ~132 caracteres.
- El modelo de planning productivo (`invokeSelectedPlanningCli`) entrega la
  respuesta como **string**. Un test de `PlanningModule` o `WorkBreakdownPlanner`
  que devuelva array u objeto no ejercita el camino real y deja pasar defectos
  productivos. Cubrir siempre la forma string.
- El store de pnpm compartido (`%LOCALAPPDATA%\pnpm\store\v3`) tiene archivos
  escritos por el perfil `franc_rgy` cuyo ACL excluye a `franc`, así que
  `pnpm install` aborta con `EPERM`. Instalar con
  `--store-dir <store propio>` en vez de tocar ACLs.
- `FastRepositoryIndexer` cachea `index` **y** `capabilityResult` por
  `(rootPath, repositoryId, baseCommit)`, con un checksum del payload — nunca
  del código que lo derivó. Cambiar `discoverRepositoryCapabilities` o el parser
  no invalida nada: todo target ya indexado sigue devolviendo lo viejo. Bumpear
  `INDEXER_PROFILE` es el único lever. Verificar el arreglo contra un target real
  ya indexado, no sólo contra un fixture nuevo, que siempre cachea en frío.
- El árbol instalado puede quedarse sin el paquete nativo win32 de
  `@tailwindcss/oxide` mientras `pnpm install` responde «Already up to date»;
  entonces **el dev server y `pnpm web:build` fallan igual** con `Cannot find
  native binding`, y no se puede verificar nada de UI. Es una laguna de
  instalación, no un fallo de código: no buscarlo en el fuente. Se repara sin
  tocar el lockfile, bajando el tarball de la plataforma y extrayéndolo dentro
  de `node_modules`:

  ```bash
  npm pack @tailwindcss/oxide-win32-x64-msvc@<misma versión que oxide>
  tar -xzf <tgz> -C "node_modules/.pnpm/@tailwindcss+oxide@<v>/node_modules/@tailwindcss/oxide-win32-x64-msvc" --strip-components=1
  ```

  Verificar con `require` sobre el `index.js` de oxide; hacerlo desde la raíz
  del repo da un falso negativo porque ahí no es dependencia directa.
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

Para el **canvas del grafo** no hace falta un run real: `/runs/proto/<fixture>`
(hoy `golden-password-recovery`) monta el mismo modelo desde un fixture, sin
backend, y su control de reproducción permite saltar al evento final para tener
el grafo compilado entero. El dev server escucha en `127.0.0.1`, no en
`localhost`; navegar a `localhost` falla.

El panel del navegador puede no estar visible y entonces `screenshot` da timeout.
No es un bloqueo para verificar: `javascript_tool` mide lo que de verdad importa
—posiciones, `aria-*`, y contraste real pintando el color en un canvas de 1×1—.
Parsear un color con regex **no** sirve: los tokens resuelven a `oklch` y un
parser ingenuo devuelve un ratio inventado.

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
