# Apunte técnico para presentar ManyHands

Este documento sirve para estudiar antes de la reunión. No es un guion oral. La idea
es que puedas reconstruir el modelo mental del sistema, entender qué estás afirmando
en cada slide y tener respuestas cortas para preguntas probables.

La versión corta del deck (10 slides, 10-15 min) fusiona varios conceptos que antes
eran slides separadas. Este apunte mantiene el detalle por concepto — cada sección
dice a qué slide del deck actual corresponde. Los slides 3 y 5 comparten un ejemplo
continuo (`leaf-schema`, `leaf-store`, `leaf-api`, seam `ExpenseStore`): conviene
poder contarlo de memoria de punta a punta.

Los slides 3, 4 y 5 ya incluyen pseudocódigo corto (la recursión del decomposer, la
forma de un `Contract`, el enum `AgentResultStatus`, las reglas de la wave) pensado
para que la charla necesite explicar lo mínimo posible en vivo — quien lo mira sin
contexto del proyecto puede seguir el mecanismo mirando el slide. Este apunte marca
con «ya en el slide» lo que ahora se puede simplemente señalar, y deja para acá el
detalle que no entra en el visual.

---

## Slide 1 — Qué es ManyHands

### Idea central
ManyHands es un sistema de orquestación de agentes LLM para desarrollo de software.
Toma un `goal`, lo convierte en un DAG con contratos, ejecuta hojas en worktrees
aislados, integra resultados bottom-up y deja una UI derivada de eventos persistidos.

### Modelo mental correcto
No es «un agente que programa». Es una estructura alrededor de varios agentes y del
repo para controlar ejecución, evidencia y recuperación.

### Qué afirmar con seguridad
- el input es un `goal`
- el trabajo se materializa como DAG con contratos
- las hojas corren en worktrees aislados, en waves decididas en ejecución
- la integración es bottom-up y termina en una branch (`manyhands/run-*`)
- la UI deriva de un event log persistente (JSONL, `seq` monotónico)

### El vocabulario de eventos (para leer el mapa del slide)
Las familias que caen al bus: `plan.*` (decomposición), `node.*` (ejecución de hojas),
`integration.*` / `conflict.*` (composición), `decision.*` (gates humanos), más
`run.*`, `seam.*`, `wave.*`, `world.reconciled`, `checkpoint.*`. Son ~40 tipos v1 en
`RUN_EVENT_TYPES`.

### Matices importantes
- el sistema no promete que el agente siempre acierta
- promete que hay evidencia verificable y control sobre lo que hizo
- los dos gates del mapa (aprobar plan, conflicto/presupuesto) son interrupts durables

### Archivos base
- `apps/web/src/lib/server/runs/planning-pipeline.ts`
- `apps/web/src/lib/server/runs/execution-pipeline.ts`
- `apps/web/src/lib/server/runs/run-model-event-log.ts`

### Preguntas probables
- **¿Es un IDE?** No. Es un orquestador de trabajo sobre un repo.
- **¿Es un solo agente?** No. El sistema coordina múltiples ejecuciones de hojas.

## Slide 2 — Qué problema resuelve

### Idea central
El problema no es falta de capacidad del modelo. Es falta de estructura para ejecutar
cambios grandes sobre un repo real.

### Modelo mental correcto
Sin estructura, los agentes se pisan, no dejan evidencia confiable y son difíciles de
recuperar cuando algo falla. Cada falla tiene una respuesta mecánica, no aspiracional.

### Qué afirmar con seguridad (fila por fila de la tabla)
*Ya en el slide, con lenguaje concreto (no hace falta traducirlo en vivo): «los
agentes se pisan», «el agente dice listo y no lo está», «un crash deja todo
ambiguo» son los tres síntomas; esto acá es el nombre técnico de cada uno.*
- **Interferencia** («los agentes se pisan»): existe cuando varias tareas comparten
  árbol de trabajo. Respuesta: worktree por tarea (branch `mh/<run>/<task>`) +
  `ScopeChecker`.
- **Falsa evidencia** («el agente dice listo y no lo está»): stdout no es fuente
  suficiente de verdad. Respuesta: el veredicto sale del repo (`ResultRecorder.record`
  → `AgentResultStatus`).
- **Recuperación débil** («un crash deja todo ambiguo»): sin checkpoints y eventos,
  recuperar un run es ambiguo. Respuesta: event log append-only + checkpoints del
  grafo + gates durables.

### Matices importantes
- no plantear el problema como «el modelo es malo»
- plantearlo como «falta control operacional»
- reanudar no re-ejecuta agentes: los gates son interrupt-first

### Archivos base
- `packages/execution-core/src/worktree/manager.ts`
- `packages/execution-core/src/result/recorder.ts`
- `packages/orchestrator-graph/src/checkpointer.ts`

### Preguntas probables
- **¿No se arregla con mejor prompting?** No. El problema es estructural, no de
  instrucciones.

## Slide 3 — La unidad de trabajo (DAG, contrato, seam)

*Ya en el slide: el pseudocódigo de `decompose(nodo)` (juicio LLM recursivo
`atómico | decompose | question`) y la forma completa de `Contract { ... }`. Esas
dos cajas resuelven en vivo «¿cómo arma el árbol?» y «¿qué lleva una hoja?» sin
tener que reconstruirlas de memoria — alcanza con señalarlas. El slide también
adelanta con una frase que la pregunta de colisión entre hermanos se resuelve en
la slide 5, no acá.*

### Idea central
La unidad básica del sistema es un nodo del DAG con dependencias y, para hojas
ejecutables, un contrato con seams. Esta slide fusiona tres conceptos que antes eran
slides separadas: el DAG, el contrato de hoja y los seams.

### Modelo mental correcto
El DAG no es solo una visualización. Es la representación operativa del trabajo. El
diagrama separa dos cosas que suelen confundirse: la **estructura** (padre → hijo,
quién compone a quién) y las **dependencias de ejecución** (quién debe correr antes).
Se guardan por separado. El contrato fija la frontera de ejecución de esa hoja, y el
seam es la interfaz compartida que le permite correr en paralelo con otra sin
inventar APIs incompatibles.

### Qué afirmar con seguridad — DAG
- `TaskNode.goal` es el campo canónico de intención
- `kind` ∈ `root | composite | leaf | integrator`
- `graph.dependencies` es la fuente canónica de aristas; cada arista es
  `{ fromTaskId, toTaskId, type, inferred, rationale? }` donde `fromTaskId` es el
  prerequisito y `toTaskId` el dependiente
- el grafo se valida antes de ejecutar: `validateTaskGraph` emite ~20 códigos de issue
  (`cycle_detected`, `orphan_node`, `leaf_without_contract`,
  `dependency_sync_divergence`, …)
- `node.dependencies` existe como shortcut sincronizado, pero no manda

### Qué afirmar con seguridad — Contrato
- `objective` y `acceptance` (mínimo 1) entran a las instrucciones del executor y al
  juicio de verify/integración
- `executionScope` (`implementationPaths`, `testPaths`, `configPaths`) es guía
  advisory: salir del allow-list queda registrado, no rompe
- `forbiddenPaths` es un campo top-level (hermano de `executionScope`) y gana sobre
  cualquier allow-list: tocarlo es `scope_violation`
- `leafValidationCommands` es argv estructurado
  (`{ command, args, timeoutMs (default 60 s), cwd: worktree | repo-root }`); se
  rechazan shells como entrypoint
- `consumedInterfaces` / `producedInterfaces` contienen `InterfaceContract` completos
  (no solo ids); se scaffoldean en grounding y guían el repair del Composer
- un contrato válido por schema no siempre es ejecutable; existe
  `validateAgentTaskContractBoundary` y `validationCommandSafetyIssues`

### Qué afirmar con seguridad — Seam
- `InterfaceContract` tiene `id`, `kind` (`type | function | module`), `signature`
  (firma TS real, no un nombre), `description`, `definedAtNodeId`
- cada hoja declara `consumes` y `produces`
- en grounding, las interfaces se scaffoldean como stubs y se commitean
  (`mh-grounding: walking skeleton scaffold`); ese commit pasa a ser el `baseCommit`
  de todos los worktrees
- por eso la hoja consumidora compila contra la firma desde t0, sin esperar a la
  productora
- los seams no son dependencias de ejecución por sí mismos: seam = compatibilidad
  técnica; dependencia = orden necesario
- los seams se heredan durante la descomposición (`inheritedInterfaces`) y se congelan
  en grounding (evento `seam.frozen`)

### Matices importantes
- una hoja sin contrato ejecutable no debería despacharse: además del schema, corre
  `assertExecutableGraph` (guard I7) antes de crear worktrees
- hay campos V1 y V2 en el contrato por compatibilidad histórica; los paths no
  admiten absolutos ni `..`
- si el seam estaba mal diseñado existe el circuito de amendments: la firma se
  enmienda con decisión humana, se invalida el closure afectado y se re-ejecuta solo
  lo inválido

### Archivos base
- `packages/task-graph/src/index.ts`
- `packages/contracts/src/index.ts`
- `packages/execution-core/src/run/graph-guards.ts`
- `packages/decomposer/src/llm/recursive/step-schema.ts`
- `packages/execution-core/src/run/grounding-agent.ts` + `skeleton-scaffolder.ts`
- `docs/system/02-contracts.md`

### Preguntas probables
- **¿Por qué DAG y no lista?** Porque hay dependencias reales y composición bottom-up.
- **¿Qué diferencia hay entre childrenIds y dependencies?** Estructura vs orden: un
  composite compone a sus hijos; una dependencia dice que una hoja necesita el
  resultado de otra, incluso cruzando ramas del árbol.
- **¿Qué diferencia hay entre acceptance y validationCommands?** Acceptance expresa lo
  que significa «bien hecho»; validationCommands corre checks concretos.
- **¿Por qué el allow-list no es duro?** Decisión documentada (ADR-0023): el deny-list
  es la frontera de seguridad; el allow-list informa sin bloquear trabajo legítimo
  adyacente. Queda registrado como advisory.
- **¿Qué diferencia hay entre seam y dependencia?** El seam define compatibilidad
  técnica; la dependencia define orden necesario. Pueden coexistir o no.

## Slide 4 — Ejecución y verificación

*Ya en el slide: el enum completo `AgentResultStatus` (ocho estados) antes de la
lista de pasos — así queda visualmente claro que el veredicto es un tipo cerrado,
no una explicación libre. Los tres pasos de abajo están reformulados en lenguaje
llano («¿terminó bien, sin que el agente commiteara por su cuenta?») en vez de la
jerga «HEAD esperado».*

### Idea central
Una hoja corre en una cadena concreta (contrato → worktree → executor → recorder), y
su resultado no se decide por lo que dice el agente sino por lo que quedó en el repo.
Esta slide fusiona «cómo corre una hoja» y «resultado real» — son la misma historia:
ejecutar en un espacio acotado y juzgar después.

### Modelo mental correcto
El prompt orienta, pero no es frontera de seguridad; la frontera real es el worktree.
stdout se registra como traza (`node.cli.output`) y no decide nada: el diff, el scope
y la validación forman el veredicto real.

### Qué afirmar con seguridad — ejecución
- se crea un worktree por tarea: branch `mh/<run>/<task>` desde el skeleton commit
- las instrucciones salen de `buildLeafInstructions`: objetivo + criterios + scope como
  guía + forbidden duro + seams exactos + «Do not commit»
- el executor corre un CLI configurado como subprocess, con timeout (default 300 s) y
  abort; el kill de árbol de procesos es verificado (INV-2)
- eventos emitidos en el camino: `node.execution.started`, `node.cli.output`,
  `node.verify.iteration | passed | failed`, `node.execution.failed`

### Los pasos del veredicto, en orden (es el orden literal del código)
1. ¿El proceso terminó? — timeout o exit ≠ 0 → `timeout` / `executor_error`
2. ¿`HEAD` es el esperado? — el agente commiteó → `agent_committed_unexpectedly`
   (policy default `reject`)
3. Stage sin artefactos (`addAllExcluding(DEFAULT_ARTIFACT_GLOBS)`) + diff cacheado —
   sin cambios reales → `empty_diff` (salvo no-op probado contra el skeleton:
   `baselineSatisfiesContract`)
4. ¿El diff respeta el scope? — `forbiddenPaths` → `scope_violation`; fuera de
   allow-list → advisory registrado
5. Commit del orquestador: `mh: <task>` — el agente nunca firma
6. `leafValidationCommands` — fallan → `validation_failed` → 1 auto-repair (host web)
   → gate humano; pasan → `success`, candidata a integración

(el deck condensa estos seis pasos en tres para la versión corta; acá está el detalle
completo por si preguntan)

### Qué afirmar con seguridad — veredicto
- `AgentResultStatus` completo: `success | empty_diff | scope_violation |
  validation_failed | executor_error | timeout | agent_committed_unexpectedly |
  internal_error`
- el commit ocurre **antes** de la validación: el repair trabaja sobre estado
  commiteado y auditable
- en repair, `expectedHead` se actualiza para seguir detectando commits inesperados

### Matices importantes
- «`git diff HEAD`» es una simplificación conceptual; la implementación usa staging +
  `git diff --cached` (captura archivos nuevos) o diff por rango
- la allow-list de scope es advisory; forbidden paths es la frontera dura
- fallar también deja evidencia: timeout y cancelación emiten eventos
- los defaults (`maxParallel` 6, leaf timeout 300 s, integration timeout 600 s) son
  overrideables por `executionConfig` del run

### Archivos base
- `packages/execution-core/src/worktree/manager.ts`
- `packages/execution-core/src/run/executor.ts`
- `packages/execution-core/src/executor/` (CLI, perfiles, kill)
- `packages/execution-core/src/result/recorder.ts`
- `packages/execution-core/src/scope/checker.ts`
- `packages/execution-core/src/git/runner.ts`

### Preguntas probables
- **¿Por qué worktrees y no ramas comunes?** Porque el aislamiento físico por tarea
  reduce interferencia y facilita evidencia y limpieza (GC preserva branches con
  evidencia).
- **¿Qué CLI corre?** El perfil configurado (Claude Code / Codex); el routing por
  complejidad puede elegir tier por nodo, o `fixed` clava la selección.
- **¿Qué pasa si el agente commitea?** Se detecta (`HEAD !== expectedHead`) y la policy
  por defecto es reject.
- **¿Y si la validación no existe en el contrato?** La hoja puede quedar `success` sin
  verificación real: la validación vale lo que valgan los comandos (límite explícito
  del slide 6).

## Slide 5 — Paralelismo e integración

*Ya en el slide: las cuatro reglas de `selectScopeAwareWave` como lista numerada
corta (riesgo alto/bloqueante → nunca comparten wave; scope superpuesto →
serializa; falta contrato/scope → conservador; todo bloqueado → de a una). Es la
respuesta directa, ya escrita, a «¿cómo saben que dos hojas no van a chocar?».*

### Idea central
El scheduler decide qué corre junto (paralelismo); el integrador decide cómo se
combina lo que corrió (integración). Fusiona dos slides previas porque son las dos
mitades de la misma pregunta: cómo el sistema coordina trabajo concurrente.

### Modelo mental correcto
Planning puede estimar batches (`scheduleTasks` es preview), pero la wave real sale de
la frontera actual, del riesgo y del scope disponible, en cada superstep. Del otro
lado, no hay merge ingenuo de ramas: hay integración controlada por composite,
cherry-pick por hijo, en orden, dentro del worktree de integración del composite.

### Qué afirmar con seguridad — paralelismo
- la frontera de nodos listos se calcula en ejecución (`executionFrontier`;
  `dependencySatisfied` refleja `childSettled`: fallos aceptados también desbloquean)
- `selectScopeAwareWave` elige un subconjunto seguro:
  - pares con riesgo `blocking`/`high` nunca comparten wave
  - overlap de scopes serializa; `configPaths` y archivos de coordinación (≥3 tareas)
    quedan fuera del cálculo de overlap
  - sin contrato o sin scope ⇒ selección conservadora
  - la frontera nunca se muere: si todo queda bloqueado, se serializa de a uno
- `run.scheduling.wave_selected` se persiste **antes** del dispatch (append required:
  si no se puede escribir, no hay dispatch)
- payload del evento: `waveIndex`, `readyTaskIds`, `selectedTaskIds`,
  `blockedTaskIds`, `blockedReasons` (con `relatedTaskIds`), `riskSummary`,
  `fallbacks`, `warnings`
- tope de concurrencia: `maxParallel` (default 6)

### Qué afirmar con seguridad — integración
- se elige el composite integrable más profundo (`nextIntegrableComposite`, sort
  `depth desc`), uno por superstep
- se cherry-pickean los commits validados de sus hijos (solo commits que pasaron por
  el recorder)
- si hay conflicto: repair con contexto real — goal del padre, `sharedInterfaces`,
  `childIntents`, diffs de hermanos, findings pre-merge y conflictos predichos
- presupuesto: 4 repairs por integración (`DEFAULT_MAX_REPAIRS_PER_INTEGRATION`),
  2 pasadas por conflicto (`MAX_REPAIR_PASSES`); un gate de sintaxis re-inyecta
  diagnósticos del compilador
- presupuesto agotado ⇒ conflict gate humano, preservando el commit parcial
- después de cherry-picks: validación del parent con los comandos de su contrato, y
  commit; el composite integrado pasa a ser hijo sintético del nivel superior

### Matices importantes
- la wave no es una opinión de UI; es una decisión auditada que la UI después muestra
- la risk matrix viene de `conflict-risk` (overlap de files/paths/símbolos,
  producer-consumer, rutas críticas) + señales estáticas del índice del repo
- el Composer no «adivina»; usa contexto estructurado y presupuesto acotado
- nada se descarta en silencio: el parcial queda commiteado y el gate lo explicita
- ese «pasa a ser hijo del nivel superior» es lo que hace la integración recursiva

### Archivos base
- `packages/scheduler/src/index.ts`
- `apps/web/src/lib/server/runs/scheduling-audit-events.ts`
- `packages/conflict-risk/src/index.ts`
- `packages/execution-core/src/integration/agent.ts`
- `packages/orchestrator-graph/src/nodes/execution-nodes.ts`
- `packages/execution-core/src/integration/pre-merge.ts`

### Preguntas probables
- **¿Cómo sabe el sistema si dos tareas chocan?** Usa dependencias, scope y señales de
  conflicto del repo (risk matrix por pares).
- **¿Qué pasa si el evento de wave no se puede persistir?** No hay dispatch. La
  auditoría es precondición, no logging.
- **¿Qué pasa si el repair no puede resolver?** Se preserva el parcial y decide el
  humano.
- **¿Y al final del todo?** Validación a nivel run (comandos del root sobre su worktree
  integrado) y `applyFinalPatch` deja la branch `manyhands/run-<id>-<slug>`.

## Slide 6 — Garantías y límites

*Ya en el slide: una línea de cierre explícita («esto es lo construido — lo que
sigue es la propuesta para cerrar la tesis») que hace de transición literal hacia
la Parte II. No hace falta inventar una frase puente en vivo.*

### Idea central
El sistema ya garantiza cosas fuertes, pero sus límites actuales son parte del modelo.

### Modelo mental correcto
Esto no es «todo resuelto». Es una plataforma con garantías concretas — cada una con su
mecanismo — y límites explicitados.

### Garantías (fila por fila de la tabla)
- aislamiento por tarea → worktree + `ScopeChecker` deny-wins
- veredicto desde el repo → `ResultRecorder` (HEAD → diff → scope → commit)
- paralelismo auditado → `wave_selected` required antes del dispatch
- integración con contexto → cherry-pick bottom-up + repair con presupuesto 4·2
- UI sin estado inventado → JSONL → reducer → selectors, SSE con replay
- recuperación → checkpoints por thread + `reconcileExecutionWorld` al reanudar
  (INV-3, evento `world.reconciled`)

### Límites (decirlos igual de claro)
- depende de CLIs externos autenticados; el runtime del agente no se controla, se
  contiene
- la persistencia hoy es single-machine (JSON/JSONL en disco)
- la validación vale lo que valgan los `leafValidationCommands` (el decomposer puede
  omitirlos)

### Matices importantes
- no hablar de benchmark ni de escalabilidad distribuida como si estuvieran resueltos
- remarcar que la fortaleza es que los límites no están escondidos: estados tipados,
  gates durables, advisories en el log

### Profundidad adicional: cómo deriva la UI (por si preguntan)
La versión corta del deck ya no tiene una slide dedicada a esto; la fila «UI sin
estado inventado» de la tabla de garantías la resume. Si preguntan el detalle:

- los eventos viven en JSONL por run, append-only, con `seq` bajo write-chain lock
- SSE hace replay + vivo con cursor (`?after=seq` / `Last-Event-ID`); ante un gap,
  full replay (INV-7)
- el reducer hace fold idempotente (`seq <= cursor` ⇒ no-op)
- los selectors derivan todo lo visible: `gated` ⇐ decisión bloqueante pendiente
  (`hasPendingBlockingDecision`); `stale` ⇐ el nodo corrió contra una revisión
  anterior de un seam cuya **firma** cambió (`selectFreshness`); `wavefront`,
  `phase`, `health`, `attention` ⇐ plegados del log
- `gated` y `stale` no existen como flags: se recalculan en cada render
- Archivos: `apps/web/src/lib/server/runs/run-model-event-log.ts`,
  `apps/web/src/lib/run-model/reducer.ts`, `apps/web/src/lib/run-model/selectors.ts`

### Archivos base
- `docs/presentation/afirmaciones-no-verificadas.md`
- `apps/web/src/lib/server/runs/lifecycle.ts`
- `packages/orchestrator-graph/src/checkpointer.ts`
- `packages/execution-core/src/run/world-reconciler.ts`

### Preguntas probables
- **¿Escala a varias máquinas?** Hoy no, no en la implementación actual.
- **¿Qué pasa si el proceso muere en medio del run?** Checkpoints + reconciliación del
  mundo físico antes de reanudar; el run queda `interrupted` reanudable.
- **¿Cómo saben que la UI no miente?** Porque el mismo log persistido siembra el
  estado inicial y alimenta el stream vivo, y los selectors son puros.
- **¿Dónde está implementado eso?** `docs/presentation/evidencia-tecnica.md` tiene el
  mapa completo concepto → archivo → símbolo → test; ya no es una slide del deck
  corto, pero cubre 21 conceptos con tests de referencia.

---

## Errores comunes al explicar ManyHands

- Presentarlo como si fuera «un agente que programa mejor».
- Decir que stdout o el texto del agente son evidencia suficiente.
- Confundir seams con dependencias de ejecución.
- Explicar la UI como si tuviera estado propio separado del event log.
- Hablar del scheduler como si decidiera una vez en planning y listo.
- Mostrar demasiados paquetes o rutas demasiado temprano.
- Presentar el Composer como magia y no como repair con contexto y presupuesto.
- Olvidar el skeleton: sin él, «hojas paralelas contra interfaces compartidas» suena a
  promesa; con él, es un commit que existe antes de que las hojas arranquen.

## Preguntas difíciles y respuesta corta

- **¿Por qué LangGraph?**
  Porque el modelo de interrupts y checkpoints encaja con gates humanos reanudables.

- **¿Qué pasa si una hoja toca algo fuera de scope?**
  Si es `forbidden`, falla duro (`scope_violation`). Si es solo fuera de allow-list,
  queda registrado como advisory (ADR-0023).

- **¿Cómo saben que dos hojas paralelas no quedan incompatibles?**
  Por seams con firma concreta compartida, scaffoldeados y commiteados antes de que
  las hojas corran.

- **¿Qué decide el resultado final de una hoja?**
  El recorder: HEAD esperado, diff staged sin artefactos, scope y validación. Ocho
  estados tipados posibles.

- **¿Qué pasa si el proceso muere en medio del run?**
  Hay checkpoints y reconciliación del mundo físico antes de reanudar.

- **¿Dónde entra el humano?**
  En gates durables: plan, conflicto, hoja, presupuesto o clarificación. El canal de
  decisiones unifica toda intervención.

- **¿Cuánto cuesta un repair descontrolado?**
  No existe: 4 repairs por integración, 2 pasadas por conflicto, y el budget de
  tokens/costo del run se chequea entre waves (budget gate).
