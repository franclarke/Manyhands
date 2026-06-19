# Quality Loop — Run E2E real por la UI web (2026-06-19)

> Bitácora del loop de calidad pedido por Francisco: ejecutar un run completo real
> usando la interfaz web, analizar activamente logs y calidad, y al detectar
> fallas detener el server, diagnosticar la causa raíz, corregir (TDD) y repetir
> hasta que el run pase y el sistema generado funcione correctamente.

## Objetivo y método

- **Modalidad:** TDD obligatorio para todo cambio funcional (red → green → refactor).
- **Fuente de verdad del resultado del run:** `git diff HEAD` / la rama
  `manyhands/run-...` en el repo target.
- **Ciclo de corrección:** detectar → detener server → diagnóstico de causa raíz
  (`systematic-debugging`) → test que reproduce → fix mínimo → rebuild package
  afectado → reiniciar server → reintentar run.

## Setup del entorno

- **Web server:** `pnpm --filter @manyhands/web dev` vía preview tools
  (puerto 3000, `autoPort`). Se cambió `.claude/launch.json` de `web:dev` (que
  arranca el launcher TUI `scripts/manyhands-dev.mjs` e interfiere con el parseo
  de logs del preview) a `next dev` plano. Los packages `@manyhands/*` resuelven
  a `dist`, por lo que tras cada fix de package hay que rebuildear y reiniciar.
- **Repo target:** `_mh_targets/string-kit` (fuera del monorepo) — librería de
  utilidades de string en JS ESM puro, con `package.json` (`"test": "node --test"`),
  `src/index.js` vacío y commit inicial en `master`. Elegido para forzar varias
  hojas independientes + integración con config compartida (escenario que expone
  los bugs P1/P2 conocidos) y validación objetiva (`node --test`).
- **Executors disponibles y autenticados:** `gemini-cli`, `claude-code-cli`.

## Feature a construir (prompt del run)

Tres funciones puras de string, cada una en su módulo con tests `node:test`,
re-exportadas desde `src/index.js`: `slugify`, `truncate`, `titleCase`.

---

## Bitácora cronológica

### Iteración 0 — Setup (2026-06-19)

- Build de packages: OK.
- Repo target creado y commiteado.
- `launch.json` ajustado a `next dev` plano.
- Pendiente: arrancar server, crear run por la UI, monitorear.

### Iteración 1 — Bug: read amplification en el historial de runs (home 86 MB)

**Síntoma.** Al abrir el Command Center (`/`), `screenshot`/`snapshot` del preview
expiraban. `GET /` devolvía **86.6 MB** de HTML. El DOM tenía solo 361 nodos: un
único `<script>` RSC de 81.7 MB era casi todo el peso.

**Diagnóstico (causa raíz, debugging sistemático).**
- El blob embebido era el contenido crudo pretty-printed (`{ "version": 1, "run": {…} }`,
  formato de `atomicWriteJson`) de **~28 run files** — casi todo el store.
- En disco, un run (`3fb733b3…`, status `interrupted`) pesaba **73 MB**, con
  `run.execution` = 73.4 MB. El store entero: **928 MB**.
- `RootLayout` (server component, `force-dynamic`) llama
  `getRunRepository().list({ limit: 10 })` en **cada** navegación. `JsonRunRecordStore.list`
  leía y parseaba **todos** los archivos del directorio y recién después aplicaba
  `slice(0, limit)`. → O(todos-los-runs × tamaño) por render.
- El prop `recentRuns` que recibe `AppSidebar` era correcto y chico (previews). Los
  28 archivos completos no eran props: eran **debug-info de React 19 dev**, que
  serializa el resultado de cada `readFile` de I/O del request (owner stacks
  `RootLayout → repository.ts`). En prod ese payload se elimina, pero la lectura+parseo
  de todos los archivos en cada render es un costo real igual.

**Fix (TDD).** `tests/run-record-repository.test.ts`: nuevo test que cuenta
`readFile` (`vi.mock`) y exige que `list({ limit: 2 })` lea **≤ 2** archivos (rojo:
leía 6). `JsonRunRecordStore.list` ahora ordena candidatos por `mtime` (sin leerlos),
lee perezosamente y corta al alcanzar `limit` registros. `mtime` lo fija el mismo
write atómico que `updatedAt`, así que es proxy fiel de recencia; el orden final
exacto se mantiene con el sort por `updatedAt`. 13/13 tests verdes.
Archivo: [repository.ts](../../apps/web/src/lib/server/runs/repository.ts).

**Decisión — datos viejos.** El store tenía 928 MB de runs de dogfood, incluido el
patológico de 73 MB. Para correr y observar limpio, se archivaron de forma
**reversible** a `.manyhands/_archive_old_runs/` (no se borró nada; `.manyhands/`
está fuera de git). El fix hace que la app tolere igualmente muchos/grandes runs.

**Pendiente de verificar.** Por qué `run.execution` llegó a 73 MB (¿runaway en un run
`interrupted`?). Se observará el tamaño del record del run nuevo como chequeo: si un
run normal no infla, fue un caso patológico; si infla, hay bug más profundo.

### Iteración 2 — El run real se traba: `barrel-export` empty-diff + deps invertidas

Run `88589e6f` (string-kit, supervisado) llegó a `paused`/`exec failed`. Análisis:

- **Grounding "walking skeleton".** Antes de ejecutar hojas, el GroundingAgent
  escribe un esqueleto compilable (commit `mh-grounding: walking skeleton scaffold`):
  implementaciones como stubs (`throw new Error("Not implemented: <name>")`) y los
  **seams completos** (el barrel `src/index.js` con sus re-exports ya escritos).
- **Causa del fallo.** La hoja `barrel-export`/`index-barrel` no tiene nada que
  hacer (el grounding ya dejó el `index.js` correcto) → el agente sale limpio sin
  cambios → `recorder.ts` marca **`empty_diff`** (fallo deliberado) → repair inútil
  → el run pausa **antes** de correr los módulos.
- **Defectos de dependencias (TDD).**
  1. El decomposer recursivo arma `graph.dependencies` pero **nunca sincroniza**
     `node.dependencies` (los deja `[]`) → viola el invariante de CLAUDE.md.
  2. El LLM emite el edge **invertido** respecto de su propio rationale
     (`{from: barrel, to: slugify}` con rationale "slugify debe existir primero"),
     así que el scheduler agenda el barrel en la wave 1. **Consistente entre runs.**

**Decisión (consultada con Francisco).** Fix de raíz en el core para empty-diff
con sentinel de stub estable, + sincronizar `node.dependencies`. NO convertir
globalmente todo empty-diff en success (eso ocultaría agentes que no trabajaron).

**Fix B — sync de `node.dependencies` (TDD).**
`tests/decomposer-recursive.test.ts` exige `node[to].dependencies = [from]` (rojo:
`[]`). `recursive-decomposer.ts`: helper `syncNodeDependencyShortcuts(nodes, deps)`
llamado en ambos sitios de ensamblado del grafo. 9/9 verdes.

**Fix A — empty-diff = éxito no-op cuando el baseline ya satisface el contrato (TDD).**
Cambio de dos capas, seguro por diseño (falla por defecto; solo es éxito si lo prueba):
- Sentinel único de stub: [grounding-stub.ts](../../packages/execution-core/src/run/grounding-stub.ts)
  (`GROUNDING_STUB_MARKER = "Not implemented"`). El scaffolder determinístico lo
  emite y el prompt del fallback LLM lo exige.
- `GitRunner.showFile({cwd, ref, path})` nuevo (interfaz + `SimpleGitRunner` +
  `FakeGitRunner`) para leer el archivo del baseline sin stagear.
- `recorder.ts`: ante empty-diff, `baselineSatisfiesContract` → éxito `noOp:true`
  **solo si** todos los impl-path files concretos existen y **ninguno** contiene el
  sentinel; si falta scope o queda un stub → sigue siendo `empty_diff` (fallo).
- Schema: `AgentExecutionResult.noOp?: boolean`.
- `integration/agent.ts`: los hijos `noOp` se **saltean** en el guard de
  missing-commit, en `validateChildCommits` y en el loop de cherry-pick (su
  deliverable ya está en el base de grounding). El invariante "success ⇒ commitSha"
  se mantiene para el resto.

**Validación.** Suite completa: **1168 passed / 0 failed** (3 skipped). `pnpm
build:packages` OK. Tests específicos: recorder 19/19, integración 20/20,
decomposer 9/9, run-record-repository 13/13.

### Run E2E exitoso — `aaeb1bf7` (string-kit, supervisado, claude-code/sonnet)

Tras los fixes y el rebuild, run nuevo por la UI con repo target reseteado al
skeleton inicial:

- Planning OK → `needs_review`; `node.dependencies` **sincronizado** (verificado en
  el record); planningCritic `clean` + backfill run-level `npm run test`.
- Aprobé el plan por la UI. Ejecución:
  `[exec:result] leaf succeeded (no-op: grounding baseline already satisfies the
  contract) task=index-barrel` ← **el fix actuó**; luego los 3 módulos en paralelo.
- `integrationResults: root:success`; validación run-level **`passed: true`**.
- Estado terminal **`completed`**, `finalApplicationStatus: applied`, rama
  `manyhands/run-aaeb1bf7-…`. La UI muestra "RUN FINALIZADO · completado
  exitosamente" y todos los nodos **Verificados**.

**Verificación independiente del sistema generado (no confiar solo en `completed`):**
- `node --test` en el repo target: **26 tests, 26 pass, 0 fail**.
- Pruebas manuales contra la spec: **7/7** (slugify con símbolos/espacios múltiples y
  ya-slug; truncate dentro/fuera de límite con `…`; titleCase con mayúsculas
  mezcladas y string vacío). El código es correcto y limpio.

### Hallazgos / riesgos pendientes

1. **Deps invertidas del LLM (consistente).** El LLM intercambia `from`/`to` respecto
   de su rationale en el patrón barrel→módulos, serializando la wave (barrel primero).
   No rompe el run gracias al fix de no-op, pero degrada el paralelismo y es
   semánticamente incorrecto. Hardening posible (no hecho, requiere diseño): validar
   en `normalize` que la dirección del edge no contradiga su rationale, o reforzar el
   prompt con un ejemplo direccional explícito. **Documentado, no corregido.**
2. **Cobertura del sentinel en grounding LLM.** El no-op se detecta por ausencia del
   marcador "Not implemented". Es seguro (un stub remanente con el marcador → falla),
   pero si un stub LLM usara otra redacción podría enmascararse. Mitigado: el prompt
   ahora exige el marcador exacto y el scaffolder determinístico lo emite siempre.
3. **`validationCommands` por hoja vacío.** El decomposer no adjunta comandos por
   hoja; el critic backfillea `npm run test` a nivel run (red de seguridad). Ver
   [[decomposer-validation-commands-gap]].
4. **`[DEP0190]` shell-spawn.** `spawn(cmd, args, {shell: win32})` en
   `availability.ts:52`, `readiness.ts:240`, `preflight.ts:200`, `run-titler.ts:113`
   (args controlados; riesgo bajo). No bloquea; pendiente de migrar a `shell:false`
   con resolución explícita del shim `.cmd` en Windows.
5. **Run patológico de 73 MB (`3fb733b3`, `interrupted`).** `run.execution` infló a
   73 MB en un run viejo interrumpido. El run nuevo NO infló, así que fue un caso
   patológico (probable runaway en interrupción), no sistémico. Archivado, no
   re-investigado a fondo.
