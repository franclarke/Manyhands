# Manual de orquestación multiagente para la migración V2

> Documento operativo para el orquestador humano. El plan técnico vinculante es [`2026-07-17-target-architecture-transition.md`](2026-07-17-target-architecture-transition.md).

## 1. Objetivo del manual

Este manual explica cómo coordinar agentes de código para transformar ManyHands sin que el paralelismo produzca una arquitectura fragmentada. El objetivo no es mantener a todos los agentes ocupados: es maximizar trabajo independiente después de congelar cada contrato compartido y conservar una rama de integración siempre verificable.

El orquestador humano conserva cinco decisiones que no se delegan:

1. fijar el SHA base de cada wave;
2. aprobar cambios de contratos compartidos;
3. asignar ownership exclusivo de archivos;
4. decidir el orden de integración;
5. abrir o cerrar cada gate arquitectónico.

## 2. Principio de orquestación

La unidad de asignación es un `WP-*`, no una fase completa ni una instrucción vaga como “continuá la migración”. Cada agente recibe:

- un único objetivo verificable;
- un SHA base exacto;
- documentación obligatoria;
- paths que puede modificar;
- paths que no puede modificar;
- precondiciones ya integradas;
- tests que deben fallar primero y pasar después;
- formato de handoff.

La regla central es:

> Primero se estabiliza el contrato compartido; después se abre el fan-out de implementaciones que lo consumen.

No se usa paralelismo para decidir simultáneamente dos versiones incompatibles del mismo schema.

## 3. Preparación obligatoria antes del primer agente

El checkout actual contiene cambios de documentación, fixtures y UI. No se debe iniciar la migración con agentes trabajando sobre ese árbol dirty compartido.

### 3.1 Crear el baseline humano

1. Revisar el diff actual y separar deliberadamente:
   - documentación objetivo y estos planes;
   - fixtures/sidebar/proto ya implementados;
   - cualquier cambio ajeno o incompleto.
2. Ejecutar la verificación correspondiente a cada grupo.
3. Crear uno o más commits humanos coherentes.
4. Crear una rama de integración, por ejemplo:

   ```powershell
   git switch -c codex/target-architecture-v2
   ```

5. Registrar el SHA:

   ```powershell
   git rev-parse HEAD
   ```

6. No asignar `WP-00` hasta que `git status --short` esté limpio en la rama de integración.

El orquestador nunca debe pedir a un agente que “ignore” cambios dirty que no conoce. Un baseline ambiguo hace imposible saber qué commit contiene qué decisión.

### 3.2 Crear el ledger

`WP-00` crea `docs/plans/target-architecture-progress.md`. Hasta entonces puede usarse una tabla temporal con:

| Campo | Uso |
|---|---|
| Packet | `WP-01`, `WP-02`, etc. |
| Owner | nombre o task del agente |
| Branch | rama exclusiva |
| Worktree | path local |
| Base SHA | commit exacto de inicio |
| Status | queued / active / review / blocked / integrated |
| Owned paths | paths exclusivos |
| Tests | comandos y resultado |
| Handoff SHA | commit final del agente |
| Integrated SHA | commit/cherry-pick en integration |
| Gate impact | G1–G6 o none |
| Notes | decisiones, deuda o blockers |

El ledger se actualiza en cada asignación, handoff, integración y reapertura.

## 4. Topología de ramas y worktrees

### 4.1 Rama de integración

`codex/target-architecture-v2` es la única rama donde se combinan packets. Debe permanecer verde. Ningún agente de implementación trabaja directamente allí.

### 4.2 Rama por packet

Convención sugerida:

```text
codex/v2-wp-00-baseline
codex/v2-wp-01-contracts
codex/v2-wp-02-repository-snapshot
...
```

Cada rama nace del SHA indicado en el prompt, no simplemente del HEAD que tenga el agente cuando comienza.

### 4.3 Worktree por agente

Ejemplo PowerShell desde la raíz del repositorio:

```powershell
$base = git rev-parse codex/target-architecture-v2
git worktree add -b codex/v2-wp-01-contracts ..\Manyhands-wp01 $base
git worktree add -b codex/v2-wp-02-repository-snapshot ..\Manyhands-wp02 $base
```

Antes de crearlos, verificar que los destinos resueltos sean los esperados y no contengan trabajo del usuario. No reutilizar un worktree dirty de otra wave.

### 4.4 Quién toca archivos compartidos

Barrels, manifests y configuración central producen conflictos mecánicos:

- `packages/*/src/index.ts`
- `packages/*/package.json`
- `pnpm-lock.yaml`
- `vitest.config.ts`
- `tsconfig.json`
- `apps/web/src/lib/server/runs/schema.ts`
- `apps/web/src/lib/run-model/types.ts`

Asignar un `integration owner` por wave. Los agentes de módulos pueden dejar imports directos o un archivo `INTEGRATION_NOTES.md` temporal en su branch, pero no deben editar el mismo barrel en paralelo. El integration owner agrega exports y actualiza manifests después de cherry-pickear los módulos.

## 5. Roles recomendados

Una persona/agente puede cumplir más de un rol en waves distintas, pero no dentro del mismo packet.

### Implementer

Escribe el failing test, implementa el mínimo comportamiento, ejecuta narrow tests y entrega un commit autocontenido.

### Contract reviewer

Revisa schemas, invariantes, dependency direction y compatibilidad. No corrige directamente la rama del implementer; entrega findings concretos para una segunda iteración del mismo agente.

### Integration owner

Cherry-pickea packets en el orden aprobado, resuelve conflictos mecánicos, actualiza barrels/manifests y ejecuta consumer tests. No rediseña el packet durante la integración.

### Verification agent

Trabaja read-only sobre el SHA integrado, reproduce tests, inspecciona route tracing y busca violaciones de boundaries. No mezcla nuevas features con la verificación.

### E2E owner

A partir de `WP-19`, opera repos temporales, crash injection, cancellation y delivery. Debe estar separado de quien implementó el último fix cuando sea posible.

## 6. Formato obligatorio del pedido a un agente

Copiar esta plantilla y completar todos los campos:

```text
Trabajá únicamente en [WP-ID — nombre] del plan:
[ruta absoluta]/docs/plans/2026-07-17-target-architecture-transition.md

Base exacta:
- branch de integración: codex/target-architecture-v2
- base SHA: <SHA>
- tu branch: <BRANCH>
- tu worktree: <PATH>

Objetivo verificable:
<una oración tomada del WP>

Documentación obligatoria antes de editar:
- docs/DECISIONS.md: A<números>
- docs/system/<archivos relevantes>
- sección completa de <WP-ID>
- AGENTS.md

Precondiciones ya integradas:
- <packets/SHA>

Ownership permitido:
- <paths exactos>

No tocar:
- <paths exactos>
- no refactorizar código adyacente
- no retirar compatibilidad V1

Método:
1. inspeccioná los consumers actuales;
2. escribí el test que falle por la razón esperada;
3. implementá el cambio mínimo;
4. ejecutá los comandos del packet;
5. inspeccioná git diff y git diff --check;
6. creá un commit en tu branch.

Criterios de aceptación:
- <copiar aceptación del WP>
- <criterios específicos de la wave>

Comandos mínimos:
- <narrow tests>
- <package typecheck>

Detenete y consultá si:
- necesitás cambiar un schema/API congelado;
- necesitás tocar un path que pertenece a otro packet;
- descubrís que una precondición no está integrada;
- el failing test demuestra un comportamiento distinto al documentado;
- el cambio exige migración de datos no prevista.

Handoff requerido:
- resumen de comportamiento;
- archivos cambiados;
- failing test observado antes del fix;
- comandos ejecutados y resultado;
- SHA del commit;
- riesgos/limitaciones;
- cualquier cambio de contrato propuesto, sin implementarlo fuera de scope.
```

No usar prompts como:

- “Implementá toda la etapa 3”.
- “Revisá lo que falta y continuá”.
- “Arreglá todos los tests”.
- “Refactorizá el sistema hacia la arquitectura nueva”.

Esos pedidos amplían ownership, ocultan dependencias y hacen imposible atribuir regresiones.

## 7. Orden exacto de waves

### Wave 0 — Baseline

Asignar solo `WP-00`.

**Pedido:** caracterizar, no cambiar producción.

**Gate:** narrow tests verdes, ledger creado, integración limpia.

**No abrir Wave 1 si:** el fixture V1 no carga, los tests actuales no son reproducibles o todavía existen cambios sin dueño en integration.

### Wave 1 — Entradas estables

Asignar en paralelo:

- agente A: `WP-01 Contracts V2`;
- agente B: `WP-02 RepositorySnapshot`.

No comparten ownership. Ambos nacen del SHA posterior a `WP-00`.

**Orden de integración:** WP-01, suite consumer de contracts; WP-02, suite consumer de repository-index. Si WP-02 necesita un tipo de contracts todavía no integrado, no copiarlo: esperar o proponerlo.

**Review:** contract reviewer inspecciona revision identity, Zod boundaries y provenance legacy.

### Wave 2 — Forma semántica y forma ejecutable

Después de integrar Wave 1, asignar en paralelo:

- agente A: `WP-03 GraphRevision + relations`;
- agente B: `WP-04 WorkBreakdown`.

**Orden de integración:** WP-03 antes de WP-04 si el planner importa tipos finales de graph; de lo contrario pueden integrarse independientemente. Nunca permitir que WorkBreakdown exponga accidentalmente el GraphRevision ejecutable.

**Gate parcial:** typed relations y semantic breakdown verdes.

### Wave 3 — Compiler y dominio del run

Asignar:

- agente A: `WP-05 Graph Compiler`;
- agente B: `WP-06 RunCoordinator kernel`.

Pueden trabajar en paralelo porque el coordinator consume el `GraphRevision` ya integrado de Wave 2 y el compiler no importa el coordinator.

**Orden de integración:** WP-05; review de G1; congelar schemas; WP-06; review de event vocabulary y boundaries.

**Gate G1:** no abrir packets de scheduler/execution si contracts o relations siguen cambiando en cada review.

### Wave 4 — Historia canónica

Asignar solo `WP-07 Event store + snapshots`.

Es un packet de alto riesgo porque toca persistencia, fencing y migración. Requiere implementer y verification agent distintos.

**Gate:** reconstrucción desde events, stale fencing rejection y Windows lock tests verdes.

### Wave 5 — Primer slice productivo y exactitud

Asignar en paralelo con ownership muy explícito:

- agente A: `WP-08 Planning vertical slice`;
- agente B: `WP-09 Artifact registry + fingerprints`.

El agente A no toca domain artifact/attempt files. El agente B no toca routes/hosts de planning.

**Orden de integración:** WP-09 primero si WP-08 referencia event types agregados allí; en caso contrario WP-08 puede entrar primero. Ejecutar siempre planning consumer suite después del segundo cherry-pick.

**Gate G2:** crear y aprobar un run V2 debe funcionar desde la ruta real.

### Wave 6 — Readiness y base física

Asignar en paralelo:

- agente A: `WP-10 Scheduler readiness V2`;
- agente B: `WP-11 ExecutionBaseBuilder`.

Ambos consumen fingerprints/artifacts congelados de Wave 5, pero trabajan en paquetes distintos.

**Review específico:**

- scheduler: un seam no ordena;
- base builder: no filtra artifacts después de haberlos aplicado; nunca deben entrar al worktree.

**Gate G3 parcial:** exact base manifest y readiness reasons reproducibles.

### Wave 7 — Ejecución productiva V2

Asignar solo `WP-12`.

Este packet conecta coordinator, scheduler, execution-core, LangGraph adapter y web host. No abrir recovery/evidence hasta demostrar:

- wave persistida antes del dispatch;
- decisión local no bloqueante;
- attempt adopted solo fresh;
- proceso tardío rechazado por fencing.

### Wave 8 — Recovery y evidence

Asignar en paralelo:

- agente A: `WP-13 Failure recovery + amendments`;
- agente B: `WP-14 ValidationRecipe + EvidenceMatrix`.

Paths bajo `execution-core` deben dividirse: A solo `src/run/amendments-engine.ts`; B solo `src/validation/**`. El integration owner modifica `src/index.ts`.

**Orden de integración:** WP-14 puede entrar primero; WP-13 después. Ejecutar tests de attempt freshness y validation luego de ambos.

**Gate G4:** no existe success V2 sin criterion-level evidence.

### Wave 9 — Integración

Asignar solo `WP-15`.

El agent debe preservar operation journal y real-git tests. Un reviewer debe rastrear un composite completo: child artifact IDs -> integration manifest -> parent evidence -> parent artifact.

### Wave 10 — Resultado y delivery

Asignar solo `WP-16`.

Separar review en dos preguntas:

1. ¿El exact candidate ya estaba validado cuando apareció `result_ready`?
2. ¿El target solo cambió después de aprobación y quedó respaldado por receipt?

**Gate G5:** si cualquiera es no, no abrir UI final.

### Wave 11 — UI V2

`WP-17` puede dividirse en tres subassignments solo si se congeló el event/query contract:

- `WP-17A`: reducer, selectors y SSE adapter;
- `WP-17B`: graph/decision components;
- `WP-17C`: result/evidence/delivery surfaces.

Integrar en ese orden. `17B` y `17C` pueden trabajar en paralelo después de `17A` si sus component paths son disjuntos. Un solo integration owner toca `run-workspace-surfaces.client.tsx`.

**Review manual obligatorio:** viewport, keyboard modal, narrow width, long decision text, uncovered evidence y failed delivery.

### Wave 12 — Retiro legacy

No lanzar los cuatro `WP-18*` sobre el mismo SHA y luego intentar un mega-merge. Usar secuencia corta:

1. `WP-18A` graph/contracts;
2. rebase de integración;
3. `WP-18B` planning/core;
4. rebase;
5. `WP-18C` persistence/events;
6. rebase;
7. `WP-18D` UI.

Puede haber análisis paralelo, pero las eliminaciones se integran secuencialmente porque los consumers cambian después de cada una.

**Gate G6:** searches legacy en cero y route trace V2 completo.

### Wave 13 — Migración y E2E

Asignar `WP-19` a un E2E owner. Los fixes encontrados se crean como packets de remediation separados; no convertir la rama E2E en una rama de cambios indiscriminados.

Ejemplo:

```text
WP-19-R1 — Reject stale result after cancellation crash window
WP-19-R2 — Preserve viewport after decision.resolved replay
```

Cada remediation vuelve a la misma disciplina: failing regression, fix mínimo, verification, commit, integración y rerun del escenario.

## 8. Protocolo de review e integración

### 8.1 Handoff del implementer

No aceptar “hecho” sin:

- SHA del commit;
- `git status --short` limpio;
- lista de archivos;
- test que falló primero;
- comandos ejecutados con resultado;
- riesgos y cambios de contrato.

### 8.2 Review read-only

El reviewer responde en este formato:

```text
Verdict: accept | changes_requested | blocked

Contract compliance:
- ...

Behavioral evidence:
- command -> result

Findings:
- [P0/P1/P2/P3] file:line — problema y efecto observable

Scope check:
- cambios fuera de ownership: sí/no

Gate impact:
- gate satisfecho o razón concreta por la que sigue abierto
```

Prioridades:

- P0: corrupción, pérdida de datos, unsafe delivery, security boundary.
- P1: lifecycle/fingerprint/evidence incorrecto, ruta productiva rota.
- P2: bug acotado o compatibilidad incompleta.
- P3: claridad/mantenibilidad sin efecto inmediato.

P0/P1 bloquean integración. P2 se corrige en el mismo packet salvo que esté explícitamente fuera de scope. P3 puede registrarse, pero no justificar refactor adyacente.

### 8.3 Corrección por el mismo agente

Enviar findings al implementer original con `follow-up` acotado. No asignar un segundo implementer salvo ausencia/bloqueo, porque dos autores simultáneos suelen ampliar el diff.

### 8.4 Cherry-pick controlado

En la rama de integración:

```powershell
git switch codex/target-architecture-v2
git status --short
git cherry-pick <HANDOFF_SHA>
```

Luego ejecutar:

1. tests del packet;
2. tests de consumers directos;
3. package typecheck;
4. `git diff --check HEAD^ HEAD`.

Si hay conflicto semántico, abortar el cherry-pick y devolver el packet para rebase sobre el SHA actual. El integration owner solo resuelve conflictos mecánicos inequívocos (barrel, lockfile, imports).

### 8.5 Cuándo exigir rebase

Exigir rebase y reverificación si:

- cambió un schema consumido por el packet;
- la rama tiene más de una wave de atraso;
- el conflicto toca lógica de dominio;
- los consumer tests actuales no existían en su base;
- otro packet retiró la compatibilidad usada.

No exigir rebase por un cambio documental no conflictivo.

## 9. Protocolo para cambios de contrato

Después de G1, un agente no puede cambiar unilateralmente:

- nombres/semántica de relaciones;
- contract revision rules;
- event types/envelopes;
- `InputFingerprint` fields;
- lifecycle target;
- EvidenceMatrix states;
- delivery eligibility.

Debe entregar un change proposal:

```text
Change proposal ID: CP-<n>
Discovered in: WP-<n>
Current contract:
Observed counterexample:
Why an adapter cannot solve it:
Proposed change:
Affected packets/branches:
Data migration impact:
Tests that would prove the new rule:
```

El orquestador:

1. pausa solo packets dependientes;
2. pide review técnico independiente;
3. decide accept/reject;
4. actualiza primero docs/plan si acepta;
5. asigna un packet de contract change;
6. rebasea consumers afectados;
7. reabre fan-out.

No aceptar que varios agentes agreguen campos opcionales distintos “para desbloquearse”; eso recrea el agregado ambiguo que la migración busca eliminar.

## 10. Protocolo de blockers

Un agente está bloqueado solo cuando no puede avanzar dentro de su ownership sin una decisión externa. Debe informar:

```text
Blocker:
Evidence:
Exact file/API involved:
Why current contract is insufficient:
Safe work still possible:
Decision needed from orchestrator:
```

El orquestador clasifica:

- **precondition missing:** integrar/rebasear el packet previo;
- **ownership collision:** reasignar path o secuenciar;
- **contract ambiguity:** usar change proposal;
- **existing regression:** crear remediation separado si no pertenece al packet;
- **environment issue:** registrar command/error y mover verification a un entorno válido;
- **scope expansion:** rechazar y conservar el packet original.

Nunca responder “hacé lo que creas mejor” a un blocker de schema, persistencia, delivery o lifecycle.

## 11. Estrategia de tests por nivel

### Nivel 1 — Inner loop del implementer

- 1–4 test files del packet.
- package typecheck.
- `git diff --check`.

### Nivel 2 — Integración del packet

- tests del packet;
- consumers directos enumerados en el plan;
- typecheck de paquetes tocados y web si corresponde.

### Nivel 3 — Gate

- todos los packets de la wave;
- architecture/boundary tests;
- route tracing de slice vertical;
- build de paquetes cuando cambian exports.

### Nivel 4 — Release candidate

```bash
pnpm test
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm lint
pnpm build
pnpm web:build
```

No ejecutar la suite completa en cada microiteración Git-heavy; sí ejecutarla al cerrar gates G2–G6 y obligatoriamente en WP-19.

## 12. Prompts iniciales listos para usar

### Prompt para WP-00

```text
Implementá únicamente WP-00 del plan docs/plans/2026-07-17-target-architecture-transition.md.

Tu objetivo es capturar el baseline actual mediante characterization tests y crear el ledger; no podés modificar producción. Trabajá desde <BASE_SHA> en la rama codex/v2-wp-00-baseline y worktree <PATH>.

Leé AGENTS.md, docs/DECISIONS.md y la sección WP-00 completa. Tu ownership se limita a:
- tests/architecture-baseline.test.ts
- tests/run-current-flow-characterization.test.ts
- tests/fixtures/current-run-record-v1.json
- docs/plans/target-architecture-progress.md

Primero inspeccioná la ruta real y escribí tests que pasen contra el comportamiento actual. Ejecutá los comandos de WP-00, git diff --check y commiteá. Entregá SHA, archivos, comandos/resultados y cualquier diferencia entre el plan y el comportamiento observado. No corrijas esas diferencias en este packet.
```

### Prompt para WP-01

```text
Implementá únicamente WP-01 — Contratos V2 versionados. Base <BASE_SHA>, branch codex/v2-wp-01-contracts, worktree <PATH>.

Leé AGENTS.md, docs/DECISIONS.md A5–A8, docs/system/02-contracts.md y WP-01. Podés tocar solo packages/contracts/**, tests/contracts-v2.test.ts y tests/contracts-v1-compatibility.test.ts. No cambies task-graph, decomposer, web ni consumers actuales.

Empezá con tests fallidos de schemas/revisions y compatibilidad V1 -> V2. Implementá los cinco contratos y un adapter con provenance explícita. Conservá exports V1 deprecados. No inventes V2 -> V1 lossless.

Ejecutá los tests/typecheck indicados, inspeccioná el diff, creá un commit y entregá handoff completo. Detenete si necesitás decidir semántica de relación de grafo.
```

### Prompt para WP-02

```text
Implementá únicamente WP-02 — RepositorySnapshot inmutable. Base <BASE_SHA>, branch codex/v2-wp-02-repository-snapshot, worktree <PATH>.

Leé AGENTS.md, docs/DECISIONS.md A4/A10, docs/system/14-repository-index.md y WP-02. Ownership: packages/repository-index/** y los dos tests nuevos del packet. No cambies planning/web/scheduler.

Escribí tests de identidad estable, freshness y snapshot parcial antes de implementar. Reutilizá el indexador actual; no agregues una segunda inspección paralela. Un fallo de inspección debe quedar complete/partial/unavailable, no oculto.

Ejecutá narrow tests y package typecheck, commiteá y entregá handoff completo.
```

### Prompt de verification agent para G1

```text
Revisá read-only el SHA <INTEGRATION_SHA> para decidir Gate G1. No modifiques archivos.

Leé docs/DECISIONS.md A3–A8 y los WP-01, WP-03, WP-04, WP-05. Verificá:
1. contracts tienen identidad/revisión y boundary schemas;
2. GraphRevision no duplica relaciones ni usa dependency genérica;
3. SeamBinding no impone orden;
4. WorkBreakdown no contiene detalles ejecutables prematuros;
5. GraphCompiler produce determinísticamente contracts/relations/obligations;
6. V1 compatibility tiene provenance y no inventa evidence.

Ejecutá las suites de esos packets y sus typechecks. Entregá verdict, evidence, findings por prioridad, scope check y decisión recomendada para G1.
```

## 13. Handoffs entre packets

Además del commit, algunos packets producen contratos que el siguiente debe citar:

| Producer | Handoff requerido | Consumers |
|---|---|---|
| WP-01 | contract schemas y revision semantics | WP-03, 04, 05, 06 |
| WP-02 | snapshot identity/capabilities/disposition | WP-04, 05 |
| WP-03 | GraphRevision y relation query API | WP-05, 06, 10, 13 |
| WP-05 | compiler input/output + critic findings | WP-08 |
| WP-06 | event vocabulary, lifecycle y ports | WP-07–17 |
| WP-07 | append/CAS/fencing/snapshot API | WP-08, 09, 12 |
| WP-09 | fingerprint canonicalization/adoption rule | WP-10–15 |
| WP-10 | readiness reasons/wave selection | WP-12, 17 |
| WP-11 | base manifest/attempt execution contract | WP-12–15 |
| WP-14 | EvidenceMatrix/outcome eligibility | WP-15–17 |
| WP-15 | integration manifest/root artifact | WP-16 |
| WP-16 | result_ready/delivery commands/events | WP-17 |

Guardar el handoff importante en el ledger con links a tipos/archivos; no copiar documentación paralela que pueda divergir.

## 14. Control de scope y conflictos

Antes de aceptar un handoff:

```powershell
git diff --name-only <BASE_SHA>...<HANDOFF_SHA>
git diff --check <BASE_SHA>...<HANDOFF_SHA>
```

Comparar la lista con ownership. Si un agente tocó un path no permitido:

- si es un import/export mecánico imprescindible, el integration owner puede extraerlo a un commit separado;
- si cambia comportamiento, devolverlo al agente para dividir el commit;
- si es cleanup adyacente, eliminarlo del packet sin discutir su mérito.

Los conflictos se resuelven por ownership, no por “último writer gana”.

## 15. Cómo evaluar progreso real

No medir avance por cantidad de paquetes modificados o tipos agregados. Medir por slices verificables:

| Hito | Demostración observable |
|---|---|
| H1 | Planner V2 crea GraphRevision aprobable desde API real |
| H2 | Event log reconstruye el run y rechaza writer stale |
| H3 | Dos siblings con seam corren en paralelo y un consumer espera artifact real |
| H4 | Decision local aparece y trabajo independiente continúa |
| H5 | Attempt stale termina pero no se adopta |
| H6 | Cada criterio final muestra evidence honesta |
| H7 | Composite se reconstruye desde IntegrationManifest |
| H8 | Result ready no modifica target; delivery aprobado sí y produce receipt |
| H9 | UI replay produce estado idéntico sin modos legacy ni auto-recenter |
| H10 | Ruta productiva no importa core ni semántica V1 |

Un packet “completo” que no acerca o protege uno de estos hitos debe revisarse por sobreingeniería.

## 16. Stop conditions

Pausar fan-out de una wave si ocurre cualquiera:

- suite de integración roja por una causa no atribuida;
- schema compartido cambia sin proposal;
- event snapshot no coincide con fold de events;
- un stale lease logra persistir;
- un attempt stale se integra;
- un test marca criterio satisfied sin evidence;
- un delivery test modifica target antes de aprobación;
- más de dos agentes necesitan editar el mismo archivo central;
- la rama de integración permanece dirty o sin un SHA identificable;
- se detecta pérdida de una garantía listada en 3.3 del plan técnico.

La acción correcta es estabilizar integration y reducir concurrencia, no abrir más ramas.

## 17. Política de rollback

- Cada packet debe ser revertible por commit.
- No mezclar data migration irreversible con activación de código.
- El migrator de `WP-19` es dry-run por defecto y crea backup explícito.
- Un feature slice V2 puede mantenerse desactivado para runs nuevos hasta pasar su gate, pero no debe alternarse durante una operación activa.
- Si un packet integrado rompe un gate y la corrección no es inmediata, revertir ese packet completo; no parchear consumers para convivir con una API incorrecta.

## 18. Checklist diario del orquestador

Al iniciar:

- [ ] `git status --short` limpio en integration.
- [ ] SHA actual anotado.
- [ ] packets activos parten de un SHA permitido.
- [ ] ownership no se solapa.
- [ ] gates abiertos/cerrados visibles en ledger.

Antes de asignar:

- [ ] packet tiene todas sus precondiciones integradas.
- [ ] prompt incluye paths permitidos/prohibidos.
- [ ] tests y aceptación son observables.
- [ ] no existe otro agente editando el mismo contrato.

Al recibir handoff:

- [ ] branch limpia y commit único/coherente.
- [ ] failing test reportado.
- [ ] narrow tests y typecheck verdes.
- [ ] diff dentro del ownership.
- [ ] review independiente si afecta gate.

Al integrar:

- [ ] cherry-pick sobre integration limpia.
- [ ] consumer tests verdes.
- [ ] ledger actualizado.
- [ ] nuevo SHA comunicado a próximos agentes.
- [ ] worktree anterior no se reutiliza dirty.

Al cerrar una wave:

- [ ] demostración del hito observable.
- [ ] gate review documentado.
- [ ] ningún blocker oculto como TODO.
- [ ] ninguna compatibilidad retirada antes de tiempo.

## 19. Criterio final de buena orquestación

La orquestación fue correcta si, al terminar:

- cada comportamiento importante puede rastrearse a un packet, test, commit y gate;
- los agentes trabajaron en paralelo solo donde los contratos ya eran estables;
- los conflictos fueron excepcionales y mayormente mecánicos;
- la rama de integración se mantuvo ejecutable;
- ninguna decisión arquitectónica emergió accidentalmente de resolver un merge;
- el sistema llegó a una sola implementación V2, no a dos caminos permanentes;
- el resultado final satisface los E2E de `WP-19` y la documentación objetivo sigue describiendo el código real.
