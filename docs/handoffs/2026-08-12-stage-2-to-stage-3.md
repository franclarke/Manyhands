# Handoff operativo — Stage 2 cerrado, Stage 3 listo para iniciar

## Estado exacto

- **Repositorio:** `C:\Users\franc\Documents\Proyectos\Manyhands`
- **Branch:** `codex/correctness-first-full-implementation`
- **Stage 2 code candidate:** `1c9c742687ec98c54b8d9330a0fe483c6d9d2ed3`
- **Candidate tree:** `8e21667c03d27b5f588dd4811ff2e0ab159ae2c3`
- **GD0 + GD1:** `pass`
- **Bounded gate review:** GO 3/3 sobre los únicos P1 encontrados
- **Stage 3 / GR:** `not_started`
- **Motivo del corte:** el usuario pidió cerrar, documentar y continuar en una
  nueva conversación antes de iniciar el siguiente stage.

La evidencia técnica completa de Stage 2 está en
[`docs/audits/stage-2/README.md`](../audits/stage-2/README.md). Este archivo es
el punto de reanudación; no reemplaza al plan canónico.

## Lectura obligatoria, en orden

El nuevo conductor debe leer cada archivo completo antes de editar producción:

1. [`PRODUCT.md`](../../PRODUCT.md) — propósito y límites del producto.
2. [`AGENTS.md`](../../AGENTS.md) — reglas activas del repositorio.
3. [Plan correctness-first canónico](../plans/2026-08-12-correctness-first-system-redesign.md)
   — única arquitectura y secuencia normativa.
4. [Runbook multiagente](../agents/correctness-first-execution.md) — ownership,
   TDD, gates y custody de evidencia.
5. [Stage 0 baseline](../audits/stage-0/README.md),
   [productive route](../audits/stage-0/productive-route.md) y
   [transition ledger](../audits/stage-0/transition-ledger.md).
6. [Stage 1 / G1](../audits/stage-1/README.md).
7. [Stage 2 / GD0+GD1](../audits/stage-2/README.md).
8. Este handoff, nuevamente, después de inspeccionar el source actual.

## Qué está implementado

Stage 2 dejó una nueva frontera durable, aún pre-cutover:

- command envelopes y receipts canónicos e idempotentes;
- un daemon kernel con lease de instalación y epoch;
- un registry que crea un actor serial y fenced por run;
- journal JSONL canónico con batches atómicos, tail repair y corrupción
  intermedia fail-closed;
- input store content-addressed y physical receipt store inmutable;
- dispatcher con los nueve effect kinds y reconciliación específica;
- startup discovery/recovery de todos los journals antes de publicar IPC;
- IPC HMAC con capability, nonce, request ID, timestamp, replay bound y frames
  acotadas;
- Unix socket privado y Windows capability/named-pipe DACL físicamente
  verificados;
- Windows Job Object supervision, exact process identities y process adapters;
- cliente IPC server-only en `apps/web`;
- queries del nuevo engine que sólo leen/fold-ean el journal.

La secuencia durable es:

```text
authenticated command
  -> installation + run fence
  -> serialized actor/CAS
  -> immutable exact effect input
  -> atomic command.accepted + effect.requested flush
  -> command acknowledgement
  -> reconcile/execute by effect kind
  -> immutable physical receipt
  -> actor validates identity/current state
  -> atomic effect.observed + one terminal fact
  -> rebuildable projection
```

Los tests Stage 2 pasaron 23 archivos/228 tests. La suite completa del candidato
pasó 259 archivos y 1,735 tests totales: 1,731 passed, 4 pending/skipped y 0
fallos. Root tsc,
siete configs afectadas, 13 package builds, daemon build, Next production build,
ambos helpers Rust y lint acotado también pasaron. Los incidentes de harness y
la deuda de lint histórica están preservados en el audit; no deben reinterpretarse.

## Qué todavía no está implementado

El hecho más importante para continuar es éste:

> El nuevo daemon kernel es real y está probado, pero todavía no es el owner de
> la ruta productiva de ManyHands.

La ruta observada en Stage 0 aún crea y ejecuta background promises dentro de
Next, conserva state en `globalThis`, compone planner/executor/validation desde
`apps/web`, y puede reconciliar/cancelar desde GET. Esos son gaps explícitos,
no contradicciones ocultas del gate Stage 2.

Tampoco están completos:

- `create_run`, pause/resume/cancel/decisions/delivery como comandos productivos
  del actor;
- queries/list/SSE productivas puras sobre el daemon;
- shutdown/cancellation end-to-end y ausencia de descendants;
- restart real de browser + Next + daemon en una ejecución fake productiva;
- Repository Model/View y Resource Catalog final;
- planner semántico directo y scheduler canónico;
- artifacts Git-native y proof authority completa;
- sandbox/live executor;
- integración jerárquica;
- delivery crash-safe final;
- retiro global de compatibilidad, evaluación, documentación final y tesis.

POSIX process supervision falla cerrado; no existe fallback sin custodia. El
Windows helper se compila desde source y deberá tener una ruta de instalación
declarada al productivizar el daemon. El host comprometido bajo el mismo usuario
permanece fuera de la frontera de seguridad.

## Stage 3 — objetivo inmediato

**Propósito normativo:** convertir al daemon en único owner productivo de
lifecycle mientras planner y executor actuales siguen detrás de adapters
transicionales.

**Gate GR:** una ejecución de la ruta productiva con executor fake determinista
debe sobrevivir cierre del browser, reinicio de Next y reinicio del daemon;
múltiples tabs/procesos web no pueden duplicar planning/execution; cancelación
debe dejar cero descendants y cero outcome ambiguo; el owner legado debe quedar
inaccesible.

No usar un modelo live. Stage 3 prueba ownership y recovery, no calidad del
planner ni autonomía del executor.

### Plan de ejecución recomendado

#### 1. Preflight y caracterización

1. Confirmar Git root, branch, `HEAD`, tree, `git status --short` y
   `git diff HEAD`.
2. Comparar el candidate de este handoff con el status del plan canónico.
3. Buscar evidencia sin cerrar, conflictos, worktrees o runtime state no
   inventariados.
4. Releer los routes y hosts reales; no asumir que Stage 0 sigue idéntico.
5. Congelar con tests el comportamiento productivo que debe migrarse, no el que
   debe conservarse como arquitectura.

Archivos de entrada probables, a verificar antes de editar:

```text
apps/web/src/app/api/runs/route.ts
apps/web/src/app/api/runs/[id]/route.ts
apps/web/src/app/api/runs/[id]/run-events/route.ts
apps/web/src/app/api/runs/[id]/{run,pause,resume,restart,cancel,deliver}/route.ts
apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts
apps/web/src/lib/server/runs/runner-state.ts
apps/web/src/lib/server/runs/liveness-supervisor.ts
apps/web/src/lib/server/runs/v2/{initialize-run,command-host,execution-pipeline,run-coordinator-host}.ts
apps/web/src/lib/server/daemon/local-ipc-client.ts
apps/daemon/src/daemon-kernel.ts
packages/run-engine/src/
```

#### 2. Definir outcomes y regresiones RED

Antes de mover código, escribir tests que fallen por el motivo productivo:

- create/decision/control route todavía muta fuera del daemon;
- GET detail causa reconciliación o write;
- dos clientes pueden duplicar un start;
- Next restart pierde ownership;
- daemon restart no retoma la ruta productiva fake;
- cancel puede declarar terminal antes de muerte/cleanup;
- source reachability todavía llega a `globalThis`/background runner.

Un test unitario del IPC no sustituye estos regressions productivos.

#### 3. Hacer productivo el command boundary

- Completar el comando durable de creación y su `run.created` exacto sin crear
  un segundo owner o state store.
- Enviar todas las mutaciones por el cliente IPC server-only.
- Usar command IDs estables y expected journal revision; replay idéntico debe
  retornar receipt y conflicto de contenido debe fallar.
- Mantener capability/endpoint exclusivamente del lado servidor.
- Aplicar same-origin, Fetch Metadata, anti-CSRF y JSON no-simple en la frontera
  browser-to-Next según el plan.

#### 4. Mover current planner/executor detrás del daemon

- Componer los adapters transicionales en `apps/daemon`, no en routes de Next.
- Convertir planning/execution/delivery actuales en efectos solicitados por el
  actor; no reescribir todavía su semántica Stage 4–10.
- Preservar worktree isolation, diff/scope checks, exact candidate validation,
  leases, process evidence y delivery checks existentes hasta que sus reemplazos
  posteriores estén probados.
- No introducir un segundo journal, una dual write o una representación V3.

#### 5. Separar commands y queries

- GET/list/event stream deben usar `query`/`eventsReady` y no crear actores,
  reparar caches, cancelar o disparar recovery.
- Recovery scanner/startup pertenece al daemon y entra por el actor.
- SSE puede reconectar por sequence, pero nunca inferir lifecycle desde logs.

#### 6. Cancelación física

- Persistir cancel intent antes de actuar.
- Suprimir pending effects afectados y rechazar adoption que pierda la carrera.
- Terminar cada process tree por identidad durable.
- Reconciliar cleanup y leases.
- Publicar terminal de cancelación sólo después de quiescence verificada.

#### 7. Retirar el owner legado

- Eliminar `globalThis` run ownership y background promises cuando la ruta ya no
  tenga consumers.
- Eliminar route-time liveness/recovery y process ownership de web.
- Mantener sólo readers históricos nombrados; ningún producer nuevo legado.
- Probar reachability por import, source scan y runtime, no por nombre de test.

#### 8. Verificación GR

Ejecutar un target/fake determinista por la ruta productiva real y observar:

1. crear y empezar desde UI/API real;
2. cerrar browser: el run continúa;
3. reiniciar Next: mismo actor/journal/process identity, sin duplicación;
4. reiniciar daemon en las ventanas permitidas: recovery exacto;
5. dos tabs y, si el harness lo permite, dos procesos web: un comando/efecto;
6. cancelar con child/grandchild activo: muerte física y terminal no ambiguo;
7. queries repetidas: cero eventos nuevos;
8. evidencia browser visible y persisted journal atribuida al candidate exacto.

Después ejecutar tests focales, typechecks/builds afectados, suite completa,
web production build, checks nativos, lint acotado, `git diff --check` y un único
review independiente acotado a GR. Documentar `docs/audits/stage-3/README.md`,
actualizar el status canónico y hacer un commit focal. Sólo un GR `pass`
autoriza Stage 4.

## Harness multiagente de frontera

Usar el [runbook](../agents/correctness-first-execution.md) como contrato:

- un conductor conserva ownership de interfaces compartidas, integración,
  evidencia y gate;
- máximo tres hijos concurrentes con file ownership disjunto y explícito;
- explorers son read-only; workers hacen una slice vertical TDD; verifier no
  edita durante review;
- un subagent result es una hipótesis: el conductor inspecciona el diff real y
  repite los comandos relevantes;
- no ejecutar dos pruebas físicas que compartan nombres globales de Windows
  Jobs/pipes; la colisión observada en Stage 2 muestra por qué;
- no repetir un fallo determinista sin un cambio causal;
- cerrar el gate con su definición escrita y una revisión acotada; findings
  teóricos fuera de alcance se registran como deuda, no abren una auditoría
  recursiva infinita;
- commits pequeños y atribuibles; nunca `stash`, `reset`, `clean`, push o PR sin
  autorización explícita.

## Toolchain y comandos confiables

En este checkout se evitó ejecutar pnpm como wrapper normal porque una ejecución
anterior relinkó `node_modules`. El runtime estable es:

```powershell
$node = 'C:\mh-runtime-c781-09\node-v22.22.0-win-x64\node.exe'
```

Comandos directos:

```powershell
& $node node_modules/vitest/vitest.mjs run --retry=0 <focused-tests>
& $node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
& $node node_modules/typescript/bin/tsc -p packages/run-engine/tsconfig.json --noEmit
& $node node_modules/typescript/bin/tsc -p apps/daemon/tsconfig.json --noEmit
& $node node_modules/eslint/bin/eslint.js <owned-files> --max-warnings=0
& $node node_modules/tsup/dist/cli-default.js <package-entry> --format esm,cjs --dts
Push-Location apps/web
& $node '..\..\node_modules\next\dist\bin\next' build
Pop-Location
rustfmt --edition 2021 --check native/windows-job-runner/src/main.rs
rustfmt --edition 2021 --check native/windows-ipc-acl/src/main.rs
rustc --edition=2021 -D warnings native/windows-job-runner/src/main.rs -o <temp-exe>
rustc --edition=2021 -D warnings native/windows-ipc-acl/src/main.rs -o <temp-exe>
git diff --check
git status --short
```

Si esa ruta de Node no existe en la nueva conversación, verificar versiones y
resolver un runtime equivalente antes de modificar dependencias. No usar un
install/relink como primer diagnóstico.

## Programa restante después de GR

| Stage | Gate | Resultado que falta |
|---|---|---|
| 4 | GRepo | Repository Model/View, Resource Catalog, aliases, containment, tri-state overlap y budgeted queries. |
| 5 | GP0 + GP1 | Planner semántico offline, verifier determinista, compiler directo y calidad sobre oráculos preregistrados. |
| 6 | GS | Cutover `SemanticPlan -> GraphRevision`, readiness hard y soft risk advisory; retiro de proyección/pairwise risk. |
| 7 | GA | Attempts inmutables, manifests Git-native scoped, materialización exacta, proof strategies y Evidence Matrix. |
| 8 | GLeaf | Una leaf live Codex y luego Claude bajo sandbox/custodia medidos, scope exacto y cleanup durable. |
| 9 | GI | Integración jerárquica, parent-owned resources, lowest-authority repair y parallel selection segura. |
| 10 | GDel | Matriz adversa completa y delivery CAS/reconciliado con receipt de tree/ref exacto. |
| 11 | GProd | Retiro de compatibilidad, UI/accessibility, full Evidence Matrix y elegibilidad de evaluación. |

No ejecutar benchmarks amplios, serie de cinco runs ni experimento de tesis
antes de GProd. Stage 8 permite sólo el smoke live explícito de su gate.

## Experimento, documentación final y tesis

Después de GProd, el trabajo restante debe seguir este orden:

1. preregistrar un experimento pequeño con oráculos independientes de topología,
   producto/browser, corrección, clean-clone y costo;
2. usar al menos una aplicación media (R18) y una jerarquía significativa (R19),
   sin convertir node count en métrica de éxito;
3. comparar políticas de granularidad en calidad, tokens, tiempo, reparaciones e
   integración, preservando `unknown` y muestras adversas;
4. evaluar de forma prudente las dos hipótesis: viabilidad de la arquitectura
   multiagente y utilidad de una granularidad que equilibre calidad/costo;
5. documentar primero el sistema as-built en versión técnica y en versión
   sencilla;
6. recién entonces redactar la tesis LaTeX aproximada de 50 páginas: tema y
   objetivos, arquitectura a grandes rasgos, componentes/innovación, comparación
   con orquestadores actuales, experimento, resultados/limitaciones y política
   de granularidad.

Un experimento pequeño puede aportar evidencia compatible con las hipótesis; no
autoriza afirmar causalidad rigurosa ni generalidad universal.

## Prompt optimizado para la nueva conversación

Copiar el siguiente bloque como objetivo. En la UI seleccionar el modo
**perseguir objetivo**, modelo **gpt-5.6-sol** y esfuerzo **ultra** antes de
iniciar:

```text
Quiero que continúes la implementación completa de ManyHands en:
C:\Users\franc\Documents\Proyectos\Manyhands

Trabaja en modo "perseguir objetivo" con gpt-5.6-sol, razonamiento ultra y
multiagentes proactivos. Tu objetivo persistente es completar la arquitectura
correctness-first restante, Stages 3–11 en orden, después diseñar/ejecutar el
experimento pequeño, cerrar la documentación técnica y sencilla, y finalmente
redactar la tesis LaTeX. Sin embargo, la única frontera autorizada al comenzar
es Stage 3 / GR: no avances a Stage 4 hasta que GR tenga evidencia atribuible y
un gate review GO.

Estado verificado de entrada:
- Branch: codex/correctness-first-full-implementation
- Stage 0 / G0: pass
- Stage 1 / G1: pass
- Stage 2 / GD0+GD1: pass
- Accepted Stage 2 code candidate:
  1c9c742687ec98c54b8d9330a0fe483c6d9d2ed3
- Accepted tree:
  8e21667c03d27b5f588dd4811ff2e0ab159ae2c3
- Bounded independent review: GO 3/3
- Stage 3: NOT_STARTED por corte deliberado de la conversación anterior
- La ruta productiva de apps/web todavía conserva ownership legado. El daemon
  está implementado y probado, pero aún no es el owner productivo.

Antes de editar, lee COMPLETOS y en este orden:
1. PRODUCT.md
2. AGENTS.md
3. docs/plans/2026-08-12-correctness-first-system-redesign.md
4. docs/agents/correctness-first-execution.md
5. docs/audits/stage-0/README.md
6. docs/audits/stage-0/productive-route.md
7. docs/audits/stage-0/transition-ledger.md
8. docs/audits/stage-1/README.md
9. docs/audits/stage-2/README.md
10. docs/handoffs/2026-08-12-stage-2-to-stage-3.md

Preflight obligatorio:
- Confirma Git root, branch, HEAD/tree, git status --short y git diff HEAD.
- Preserva todo cambio ajeno; nunca uses stash/reset/clean global.
- Busca marcadores de evidencia incompleta o contradicciones entre audit,
  handoff y plan. Si aparece alguno, o el candidate real no contiene el
  accepted candidate, NO
  inicies Stage 3: primero restaura una clausura atribuible de Stage 2.
- Audita nuevamente source, tests, persisted state y productive callers; una
  síntesis de otro agente no es evidencia.
- Usa Node 22.22.0. En este checkout la ruta estable fue
  C:\mh-runtime-c781-09\node-v22.22.0-win-x64\node.exe y se prefirieron
  Vitest/tsc/eslint/tsup/Next directos para no relinkear node_modules.

Ejecuta Stage 3 con ingeniería senior, TDD estricto y slices verticales:
1. Traza la ruta real POST/GET/list/SSE, decisiones, run, pause/resume/restart,
   cancel y deliver; identifica todos los writers, globalThis state, background
   promises, leases, processes y recovery side effects.
2. Escribe regressions RED por el motivo productivo: mutaciones fuera del
   daemon, GET que escribe/reconcilia, duplicación multi-client, pérdida por
   restart y cancelación físicamente ambigua.
3. Haz que run creation y todas las mutaciones sean command envelopes durables
   enviados por el BFF server-only al daemon. Browser JS nunca obtiene endpoint
   privilegiado ni capability. Aplica same-origin/Fetch Metadata/anti-CSRF.
4. Mueve current planner/executor/validator/delivery detrás de adapters del
   daemon sin implementar prematuramente Stages 4–10 ni crear dual writes.
5. Convierte GET/list/SSE en queries/event pages puras. Recovery corre sólo en
   el daemon/actor.
6. Implementa cancel intent, supresión de pending effects, muerte por identidad,
   cleanup/lease reconciliation y terminal sólo después de quiescence.
7. Retira el web-owned runner, globalThis ownership, route-time recovery y
   process ownership cuando source/runtime reachability pruebe que no tienen
   consumers.
8. Prueba la ruta productiva con executor fake determinista: cierre de browser,
   restart de Next, restart de daemon, múltiples tabs/web clients, replay y
   cancelación con child/grandchild. Conserva journal y evidencia browser real.
9. Ejecuta focales, typechecks/builds afectados, suite completa, Next production
   build, checks Rust, lint acotado y diff-check sobre el exact handoff tree.
10. Pide exactamente una revisión independiente acotada a GR. Corrige findings
    que demuestren una violación concreta del gate; registra hardening teórico
    fuera de alcance sin reabrir una auditoría infinita.
11. Documenta docs/audits/stage-3/README.md, actualiza sólo el status canónico,
    crea commits focales y termina con worktree limpio. No push/PR sin permiso.

Harness multiagente:
- Conserva un conductor para interfaces compartidas, integración y gate.
- Usa como máximo tres hijos con ownership de archivos disjunto y explícito.
- Explorers read-only; workers TDD; verifier read-only durante review.
- No ejecutes en paralelo pruebas físicas que compartan nombres globales de
  Windows Job Objects o named pipes.
- Inspecciona cada diff y repite la verificación integrada: los resultados de
  subagentes son claims, no evidencia.
- Nunca repitas un fallo determinista sin cambiar la causa o el input.

Definition of done de GR:
- La ejecución fake productiva sobrevive browser/Next/daemon restart.
- Dos clientes no duplican planning, execution ni effects.
- Cancelación deja cero descendants y cero estado ambiguo.
- Queries no producen domain events ni side effects.
- El owner productivo legado es inalcanzable y eliminado.
- GD0/GD1 siguen verdes.
- Evidencia, candidate SHA/tree, comandos, adverse outcomes y límites están
  documentados; full verification pasa; reviewer independiente devuelve GO.

No uses un modelo live antes de Stage 8. No hagas el experimento ni la tesis
antes de cerrar Stage 11/GProd. No llames "producción" a una implementación
parcial y no conviertas unit tests, node count o una opinión de modelo en
evidencia de producto.

Empieza creando el objetivo persistente, inspeccionando el repo real y
publicando un plan breve con outcomes verificables para Stage 3. Luego ejecuta
sin detenerte mientras exista trabajo seguro y autorizado dentro del stage.
```
