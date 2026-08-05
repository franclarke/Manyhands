# Rediseño de descomposición y ejecución robusta

> **Para Claude:** este documento es la fuente autoritativa del rediseño. Leerlo
> entero antes de tocar código. Las decisiones ya fueron tomadas y aprobadas por
> Francisco el 2026-08-05; no se reabren sin una decisión explícita suya.

**Objetivo:** que ManyHands convierta un objetivo de software en una entrega
verificada **de forma repetible**. La política de granularidad es un medio para
demostrar una hipótesis de la tesis, no el fin. La prioridad es que el sistema
sea sólido, consistente y robusto ante fallos.

**Arquitectura resultante:** la descomposición se construye por recursión hasta
un punto fijo sobre cuatro propiedades de hoja ejecutable; las relaciones entre
unidades se derivan del repositorio en vez de pedírselas al modelo; la ejecución
despacha continuamente sobre un ready-set topológico con máximo paralelismo,
sobre workspaces aislados y desechables.

**Stack:** TypeScript, Zod, pnpm monorepo, Vitest, Node.js, Next.js, Git
worktrees, journal de eventos append-only.

---

## 1. Por qué existe este rediseño

Trece series congeladas murieron cada una por un defecto distinto, en un
subsistema distinto, sin repetirse casi ninguno.

| Serie | Murió por | Mitad del sistema |
|---|---|---|
| SP1g | caché/schema del CLI desactualizado | entorno |
| SP1h | timeout de planning sin configurar | planning |
| SP1i | el planner citó una ruta ausente | planning |
| SP1j | falso `artifact_empty` | ejecución |
| SP1k | reparación no-op tras fallo de validación | ejecución |
| SP1l | `package.json` pasado como selector de test | validación |
| SP1m | scheduler agotó falsamente el presupuesto | scheduling |
| SP1n | `artifact_empty`, segunda causa | ejecución |
| SP1o | wall clock de 30 min | ejecución |
| SP1p | `artifact_empty`, tercera causa | ejecución |
| SP1q | seam `logical` rechazada por scope guard | planning |
| SP2 | forma de `seam.interface` (6/6 candidatos) | planning |

Más `retry-8/9/10/11` (outputs duplicados, falso `artifact_cycle`, identidad Git
ausente, lifecycle colgado, sandbox) y G7 (ownership, snapshot, `candidateCount`).

### Causa raíz A — corrección total antes de ejecutar

El sistema exige demostrar **30 invariantes fail-closed** sobre un plan que un
LLM produce **de un tiro**, antes de que se escriba una línea de código: 12 en
`SemanticPlanSchema`, 11 en `graph-compiler`, 4 en `contract-compiler`, 2 en
`graph-compiler-v3`, 1 en `acceptance-allocation`. Todas terminales. Cada una se
descubre de a una, a 45 minutos por descubrimiento.

Consecuencias concretas medidas:

- **La política solo puede achicar.** `selectUnit` recorre un árbol ya generado
  y solo puede `collapseToLeaf`, conservar el corte, o rendirse
  (`semantic_replan`). Nunca crea un corte que el modelo no propuso. La
  profundidad queda topeada por lo que el modelo sostenga en una sola respuesta.
- **La fórmula está sesgada contra la profundidad.**
  `benefit = mean(contextRelief, parallelism, faultIsolation)` contra
  `cost = mean(coordination, pathOverlap, validationDuplication, uncertainty)`.
  Un grafo profundo produce por definición más coordinación, más duplicación de
  validación y más solapamiento de rutas: los tres son costo. El caso N=16 midió
  `parallelism 0.8889` y aun así `splitAdvantage −0.2584`, vetado por
  `validationDuplication 0.8947` sola.
- **Solo se divide al fracasar.** La única fuerza que empuja a dividir es
  `!leafFeasible`. En 18 evaluaciones de raíz preservadas, 17 dividieron por
  infactibilidad y una sola por utilidad.
- **Las seams se preguntan en vez de derivarse.** El prompt dice *"Each seam has
  { id, producerUnitKey, consumerUnitKeys, purpose, interface, evidenceIds }"* y
  **nunca define `interface`**, mientras el validador exige un objeto anidado de
  cinco campos. Ahí murieron SP1q y los 6/6 candidatos de SP2.

### Causa raíz B — impuesto de sistema distribuido sin ser distribuido

Diez mecanismos de coordinación independientes conviven en un proceso, en una
laptop, con un usuario: `RunOperationAuthority` (fence + lease + receipt),
repository lease, `fenced-lease` del pool, `topology-lease`, `assertAuthority` +
append optimista, `mutationFence`, heartbeats, ProcessSupervisor + runner
registry, abort registry versionado, snapshot + journal + recovery.

Existen por una sola razón: las hojas corrían **en paralelo sobre un pool fijo
de 4 worktrees reciclados** (`worktree-pool.ts`, `recycled: slot.adopted ||
slot.useCount > 0`). Estado mutable compartido. Ahí murieron SP1j, SP1n y SP1p.

**La complejidad no vino de la concurrencia: vino de compartir.** Fences, leases
y receipts resuelven *múltiples dueños*. Con un solo proceso dueño y workspaces
aislados, la concurrencia es un semáforo sobre tareas independientes.

---

## 2. El diseño

### 2.1 Invariantes del nuevo sistema

Estos son los enunciados que deben ser verdaderos al final. Cualquier cambio que
los viole está mal, aunque los tests pasen.

- **I1.** Una unidad es hoja ejecutable si y solo si cumple P1–P4 (§2.2).
- **I2.** Ninguna relación entre unidades es declarada por el modelo. Todas se
  derivan de `write-set ∩ read-set`.
- **I3.** Dos nodos que pueden ejecutarse concurrentemente tienen write-sets
  disjuntos. Por lo tanto una integración nunca puede conflictuar.
- **I4.** Hay exactamente un escritor del journal por run, garantizado por
  construcción y no por consenso.
- **I5.** Ningún intento reutiliza un workspace de otro intento. Un workspace se
  crea, se usa y se destruye.
- **I6.** Todo run alcanza un estado terminal sin intervención externa.
- **I7.** Un intento se identifica por `(nodeId, baseCommit, inputsFingerprint)`.
  Reejecutar crea un intento nuevo; jamás muta uno existente.
- **I8.** El canvas nunca se recentra, enfoca ni hace fit por eventos del run.

### 2.2 Descomposición como punto fijo

Una unidad es **hoja ejecutable** si y solo si:

| | Propiedad | Qué previene |
|---|---|---|
| **P1** | posee ≥1 criterio de aceptación y existe un comando dentro de su propio scope que lo prueba | validación fantasma, criterios huérfanos |
| **P2** | su write-set es disjunto del de todas sus hermanas | outputs disputados, conflictos de integración |
| **P3** | todo archivo que lee y otra unidad escribe llega materializado como archivos en su base | `artifact_empty`, seams `logical` |
| **P4** | su scope entra en el presupuesto observado del ejecutor | hojas infactibles |

**Regla de decisión:** dividir ⟺ alguna propiedad falla **y** el modelo propone
un corte cuyos hijos la reparan. Si ninguna falla, es hoja. Si P4 falla y no hay
corte que la repare, es un **fallo reportable** de la unidad, no un replan
silencioso.

**Terminación:** cada corte reduce estrictamente el scope de sus hijos respecto
del padre, y el scope es finito.

**Por qué esto da profundidad:** cada nivel existe porque una propiedad concreta
falló en el nivel de arriba. La profundidad es emergente y justificada, no un
parámetro.

**Por qué esto da el incentivo correcto:** un corte que crea coordinación viola
P2 o P3 y es rechazado, así que el modelo queda forzado a cortar por seams
reales. El incentivo es estructural, no escalar.

### 2.3 Contrato con el modelo

Una llamada por unidad. Al modelo se le pide **solo esto**, por hijo:

```json
{ "key": "...", "objective": "...", "criterionIds": ["..."],
  "existingPaths": ["..."], "plannedPaths": ["..."] }
```

Cinco campos. Sin seams, sin interfaces, sin objetos de verificación, sin
incertidumbres, sin señales de complejidad. Todo eso se deriva o se elimina.

La respuesta es **un objeto JSON y nada más**. Se retira el canal de
`planning.node` embebido en texto: es lo que contaminó los diagnósticos de SP2
con `Unrecognized key(s): 'type','unit'` cuatro veces por intento. El progreso lo
da la recursión — cada nodo resuelto es un evento.

Un fallo de validación se repara **en el lugar**, reenviando al modelo los
errores exactos del validador, con un tope de 2 reintentos por nodo. El error es
local y la corrección es mecánica.

### 2.4 Relaciones derivadas

Dadas las unidades con sus `existingPaths` (lectura) y `plannedPaths`
(escritura), el compilador calcula:

- **productor** de un archivo = la unidad que lo escribe (único por P2);
- **consumidores** = las unidades que lo leen;
- **materialización** = siempre `files`, porque literalmente son archivos;
- **orden** = arista productor → consumidor;
- **conflicto** = intersección de write-sets, que P2 ya impide en planning.

`logical` deja de existir como materialización de una dependencia ejecutable: se
vuelve **inexpresable**, no ilegal. Un solo tipo de relación en vez de dos
elimina el falso `artifact_cycle` de retry-10 por construcción.

### 2.5 Ejecución: despacho continuo sobre ready-set topológico

**Las waves mueren como mecanismo.** Una wave es una barrera; es estrictamente
menos paralelo, y su contabilidad mató a SP1m.

**Modelo:** un nodo está listo cuando todas sus dependencias derivadas están
satisfechas. Apenas termina un nodo, se recalcula el ready-set y se despacha
hasta el límite de concurrencia. Máximo paralelismo por construcción.

**La wave sobrevive como concepto derivado:** el nivel topológico de un nodo
(longest path desde la raíz). Es presentacional; el runtime nunca sincroniza
sobre ella.

**Un solo tipo de tarea.** Hoja y composite son nodos del mismo scheduler; solo
cambia qué hace la tarea. Un composite queda listo cuando sus hijos fueron
adoptados, así que los composites también integran en paralelo entre sí. Esto
colapsa la capa de integración separada.

**Seguridad:** P2 garantiza que dos nodos concurrentes nunca tocan el mismo
archivo, así que la integración es aplicar conjuntos disjuntos. Si el modelo no
logra un corte disjunto, P2 falla, la unidad no se divide y queda como hoja más
grande: **el sistema cambia paralelismo por seguridad nodo a nodo y nunca
produce un grafo que no pueda ejecutar sin conflicto.**

**Fallo:** si una hoja falla, sus hermanas siguen y sus dependientes nunca entran
al ready-set. El run termina cuando el ready-set se vacía; el resultado es qué
criterios quedaron probados.

**Crash:** leer el journal, recomputar el ready-set, **descartar** los workspaces
en vuelo y redespachar. Nunca adoptar estado sucio.

### 2.6 Coordinación: dos mecanismos

1. **Lock de dueño por run**, con PID, tomable si el dueño está muerto. Garantiza
   I4: un solo escritor del journal por construcción. Se van CAS, fencing y
   `mutationFence`.
2. **Supervisión de procesos hijos**, para matar árboles de proceso y detectar
   ejecutores muertos.

Se retiran: pool de worktrees, `fenced-lease`, `topology-lease`, repository
lease, takeover receipts, abort registry versionado.

### 2.7 Terminalidad dentro del producto

Hoy la detección de dueño muerto vive en el driver del experimento
(`run-experiment.mjs`, `stalledOwner` + `cancelAbandonedRun`): el producto
depende del arnés experimental para no colgarse. Se invierte: heartbeat vencido
+ proceso ausente ⇒ transición terminal, dentro del sistema.

### 2.8 Validación derivada del repositorio

Los comandos de validación se leen de los scripts del target. El modelo no
inventa comandos. Esto elimina la clase de SP1l.

### 2.9 UI: un canvas, dos layouts

Mismo grafo, mismas identidades de nodo, un toggle de layout:

- **Pertenencia** — árbol padre → hijo, como se genera.
- **Flujo** — DAG topológico con aristas de dependencia derivadas y bandas por
  nivel; ahí se ve la wave.

No son dos vistas con estado propio: son dos proyecciones de relaciones ya
tipadas. El toggle es acción del usuario; I8 se mantiene.

### 2.10 La política de utilidad

Se conserva y se sigue calculando y persistiendo por nodo, **como observación**.
Deja de decidir. Cuesta cero mantenerla y le da a la tesis su resultado más
interesante: por qué un escalar no servía para decidir. Retira
`minimumAdvantage = 0.15` de los parámetros provisionales del manuscrito.

---

## 3. Plan por etapas

> **Regla de cierre:** una etapa cierra solo con su evidencia de verificación y
> su commit local. Nunca hay push. TDD para todo cambio conductual: regresión
> roja **por la razón correcta** antes del fix.

### Estado de ejecución

| Etapa | Objetivo | Estado |
|---|---|---|
| 1 | Arnés de planning en proceso | **completada** — `d508b7b` |
| 2 | Contrato mínimo y descomposición recursiva | **completada** — `d111bd1`, `25be9c7` |
| 3 | Punto fijo P1–P4 y relaciones derivadas | pendiente |
| 4 | Scheduler de ready-set y workspace por intento | pendiente |
| 5 | Terminalidad total y validación derivada | pendiente |
| 6 | UI: dos layouts | pendiente |
| 7 | Celdas de medición | pendiente |

---

### Etapa 1 — Arnés de planning en proceso

**Por qué primero:** sin esto cada hipótesis cuesta 45 minutos y un servidor. Los
13 defectos que vivieron en planning y compilación habrían sido tests unitarios.

**Qué se construye**

- Un banco de repos-fixture chicos en `tests/fixtures/planning/`, cada uno un
  árbol de archivos en memoria o en disco temporal, con su `package.json` y sus
  scripts, sin dependencias externas.
- Un runner en proceso que ejecuta **inspección → descomposición → compilación**
  contra un fixture, con un modelo inyectado, sin servidor, sin worktrees, sin
  HTTP, en milisegundos.
- Tres modos de modelo: **stub** (respuestas escritas a mano para invariantes),
  **replay** (transcripciones reales grabadas una vez) y **live** (CLI real,
  solo bajo bandera explícita).
- Un grabador que persiste las respuestas reales del CLI a JSON para alimentar
  el modo replay.

**Aceptación**

- El arnés reproduce, como test rojo, **al menos tres** de los defectos
  históricos ya conocidos: la seam `logical` de SP1q, la forma de
  `seam.interface` de SP2, y los outputs disputados de `contested-planned-output`.
- El arnés completo corre en menos de 5 s sin red.
- Ninguna transcripción de replay se edita a mano para hacer pasar un test.

**Fuera de alcance:** ejecución, worktrees, integración, UI.

**Cerrada el 2026-08-05 en `d508b7b`.** 8/8 tests, 2,53 s de ejecución (5,3 s de
reloj con arranque de vitest). Los cuatro defectos quedan marcados con `it.fails`,
que pasa mientras el comportamiento sigue roto y **se pone rojo al arreglarlo** —
esa es la señal para borrar el marcador. Se comparte un repositorio por fixture
porque planning solo lee; eso bajó el arnés de 14,4 s a 2,5 s.

> **Defecto nuevo, encontrado por el arnés en su primera corrida.**
> `fast-indexer.ts` declara `SOURCE_EXTENSIONS = { .ts, .tsx, .js }`. El template
> de SP2 es **enteramente `.mjs`**, así que su planner recibió **cero rutas de
> evidencia**: no podía citar ningún archivo existente y solo podía declarar
> `plannedPaths`. Nadie lo había visto en trece series. **La etapa 2 debe indexar
> `.mjs` y `.cjs`.**

Nota de gates: `pnpm typecheck` (raíz) ya estaba rojo antes de esta etapa con 95
errores, todos en tests históricos que importan `.mjs` sin declaraciones. El
conteo es idéntico con y sin este cambio; los archivos nuevos no aportan ninguno.
Ese comando no forma parte de la lista de gates del proyecto.

---

### Etapa 2 — Contrato mínimo y descomposición recursiva

**Qué se construye**

- El nuevo contrato de nodo (§2.3), en Zod, con los cinco campos por hijo más
  un `rationale` por corte. El `rationale` es un solo string y es lo que hace
  explicable la profundidad en la tesis; sin él el árbol no se puede defender.
- El descompositor recursivo: una llamada por unidad, parent-first, con
  reparación local acotada a 2 reintentos usando los errores exactos del
  validador.
- Salida estructurada: un objeto JSON por llamada. Se retira el canal de
  progreso embebido y su parser.
- Eventos de dominio nuevos: un nodo resuelto es un evento; un reintento de
  reparación es un evento con su diagnóstico.
- **Fix del indexador**: `.mjs`, `.cjs`, `.mts`, `.cts` y `.jsx`.

**Refinación decidida el 2026-08-05 (durante la ejecución de la etapa):** la
recursión de esta etapa se gobierna con **P4 solamente** — el scope de la unidad
contra el presupuesto del ejecutor — porque P4 ya es medible sin la maquinaria
de la etapa 3. La etapa 3 agrega P1–P3 y la derivación de relaciones. Así cada
etapa es verificable por separado y ninguna depende de la siguiente para tener
sentido. **El modelo nunca decide hoja contra composite**: eso es responsabilidad
de la política, y mezclarlo sería repetir el error de origen.

**Estado terminal de un nodo:** `leaf`, `composite` o `unresolved`. `unresolved`
es lo que hace que un fallo en profundidad 3 no invalide 0–2: el nodo que falla
queda marcado en su lugar, con su diagnóstico, y sus hermanos y ancestros
sobreviven.

**Aceptación**

- Con modelo stub, el descompositor produce un árbol de profundidad ≥3 sobre un
  fixture que lo requiere.
- Un fallo de forma en el nivel 3 no invalida los niveles 0–2: los nodos ya
  resueltos se conservan.
- La reparación local convierte un draft inválido en válido en ≤2 reintentos en
  el caso registrado de SP2.
- Un fallo tras agotar reintentos produce un diagnóstico atribuible al nodo
  exacto.

**Fuera de alcance:** las propiedades P1–P4 todavía no deciden; esta etapa solo
produce el árbol que el modelo propone, nodo a nodo.

**Cerrada el 2026-08-05.** Fix del indexador en `d111bd1`; planner en `25be9c7`.

- `RecursivePlanner` + `UnitProposalSchema` + `CutProposalSchema` +
  `buildCutPrompt` en `packages/decomposer/src/planner/recursive-planner.ts`.
- 7/7 en `tests/recursive-planner.test.ts`, en 13 ms. Aceptación cubierta:
  profundidad 4 con stub, `unresolved` aislado que preserva ancestros y
  hermanos, reparación de una respuesta con `children` en prosa dentro de 2
  intentos, y diagnóstico atribuible al nodo exacto tras agotarlos.
- Validación más allá del schema, con los dos hechos que solo el padre conoce:
  el corte **particiona** los criterios del padre, y un `existingPath` debe
  existir en el snapshot. Los diagnósticos vuelven al modelo textualmente.
- El prompt muestra la forma JSON **literal**. Un test lo verifica campo por
  campo, precisamente porque SP2 murió en un campo nombrado y nunca formado.
- Regresión amplia sobre indexación y planning: 64/65 archivos, 464 tests PASS.
  El único rojo es `wide-graph-oracle-contract`, el hash de `dist` congelado,
  preexistente y preservado sin reconciliar.

**Movido a la etapa 3, con razón:**

- *Retirar el canal de progreso embebido y su parser.* El planner nuevo no lo
  usa: su contrato es un objeto JSON por llamada. Pero el parser sigue vivo
  porque lo usa la ruta vieja, y esa ruta se retira en la etapa 3. Borrarlo
  antes rompería producción sin reemplazo.
- *Eventos de dominio en el journal.* La etapa 2 entrega la superficie de
  observador (`onUnitResolved`, `onCutProposed`, `onRepairAttempted`,
  `onUnitUnresolved`). Los eventos durables se emiten cuando el planner se
  cablea al host productivo, y eso ocurre en la etapa 3: cablearlo antes
  significaría correr producción decidiendo solo con P4 y sin derivación de
  relaciones, o sea un sistema **peor** que el actual.

---

### Etapa 3 — Punto fijo P1–P4 y relaciones derivadas

**Qué se construye**

- Evaluador de P1–P4 por unidad, determinista, con diagnóstico por propiedad.
- El bucle de punto fijo: dividir mientras alguna propiedad falle y exista corte
  que la repare; hoja si ninguna falla; fallo reportable si P4 falla sin corte.
- Derivación de relaciones (§2.4) desde write-sets y read-sets.
- La fórmula de utilidad pasa a observación: se calcula y persiste por nodo y no
  participa de ninguna decisión.
- **Cableado productivo del `RecursivePlanner`** en el host de planning, con sus
  eventos durables de journal: nodo resuelto, corte propuesto, reparación
  intentada y nodo sin resolver.
- **Retiros:** `planning-envelope.ts`, `work-breakdown.ts` y la mitad de
  `schema.ts` que los sostiene; `strategy-selector` deja de decidir; el canal de
  progreso embebido y `parseWorkBreakdownProgressLine`, que quedan sin
  consumidor una vez retirada la ruta vieja.

**Aceptación**

- Un fixture con un corte que solapa write-sets **no** produce conflict
  constraints: produce un re-corte local o una hoja más grande.
- Una dependencia ejecutable no puede representarse como `logical`: no existe el
  valor en el tipo derivado.
- La profundidad del árbol resultante varía con el fixture, y cada nivel tiene un
  diagnóstico de qué propiedad lo motivó.
- Los assessments de utilidad siguen persistiéndose con la misma forma que hoy,
  para no perder comparabilidad de la medición.

**Fuera de alcance:** ejecución.

---

### Etapa 4 — Scheduler de ready-set y workspace por intento

**Qué se construye**

- Scheduler de despacho continuo (§2.5): ready-set topológico, límite de
  concurrencia configurable, recálculo tras cada nodo terminado.
- Un solo tipo de tarea: hoja y composite en el mismo scheduler.
- Workspace por intento: se crea fresco desde el commit base, se usa, se
  destruye. Caché de dependencias desacoplada del estado git.
- Lock de dueño por run con PID y toma si el dueño murió.
- **Retiros:** `worktree-pool.ts`, `fenced-lease.ts`, `topology-lease.ts`,
  repository lease, takeover receipts, `mutationFence`, abort registry
  versionado, y la capa de integración separada.

**Aceptación**

- Un grafo con N hojas independientes ejecuta con concurrencia real y termina
  con las N adoptadas, sin ninguna lease entre tareas.
- Una hoja que falla no impide que sus hermanas terminen; sus dependientes nunca
  entran al ready-set.
- Matar el proceso a mitad de run y reanudar: el ready-set se recomputa desde el
  journal, los workspaces en vuelo se descartan y el run llega a terminal.
- El nivel topológico se persiste por nodo y ninguna decisión del runtime lo lee.

**Fuera de alcance:** UI.

---

### Etapa 5 — Terminalidad total y validación derivada

**Qué se construye**

- Supervisor de liveness dentro del producto: heartbeat vencido + proceso
  ausente ⇒ transición terminal.
- Derivación de comandos de validación desde los scripts del target.
- Taxonomía de fallo cerrada y total: cada fallo mapea a exactamente una causa
  con recuperación definida.
- **Retiro:** la detección de dueño muerto sale del driver del experimento.

**Aceptación**

- Un run cuyo ejecutor es matado externamente llega a terminal **sin** driver.
- Un target sin script `test` produce un diagnóstico explícito, no un comando
  inventado ni un `verified` silencioso.
- Ninguna causa de fallo cae en un cajón genérico.

---

### Etapa 6 — UI: dos layouts

**Qué se construye**

- Layout de pertenencia y layout de flujo sobre el mismo grafo y las mismas
  identidades de nodo, con toggle de usuario.
- Bandas por nivel topológico en el layout de flujo.

**Aceptación**

- Cambiar de layout preserva selección y estado; no hay estado duplicado.
- I8 se mantiene: ningún evento del run recentra, enfoca ni hace fit.
- WCAG 2.2 AA y `prefers-reduced-motion`.

---

### Etapa 7 — Celdas de medición

**Qué se construye**

- Congelar una serie nueva sobre el sistema rediseñado, con el target chico de
  SP2 y su evaluador externo.
- Medir: entregas verificadas repetibles, profundidad alcanzada, paralelismo
  disponible contra paralelismo ejecutado, y los assessments de utilidad como
  observación.

**Aceptación**

- 2/2 celdas completas con todos los criterios externos satisfechos, o un
  resultado adverso atribuible con causa observable.

---

## 4. Qué se borra y qué se preserva

**Se borra del producto:** `planning-envelope.ts` (600), `work-breakdown.ts`
(579) y su mitad de `schema.ts`, `worktree-pool.ts` + `fenced-lease.ts` +
`topology-lease.ts` (~1.600), la capa de integración separada, el parser del
canal de progreso embebido, y la mayor parte del fencing. Estimado: 4.000–5.000
líneas menos, de 30 compuertas pre-ejecución a 4 propiedades, y de 10 mecanismos
de coordinación a 2.

**Se preserva sin tocar:** toda la evidencia histórica bajo `docs/tesis/`. Las
series SP1, SP2, G6, G7 y `retry-*` quedan como evidencia cerrada del proceso de
descubrimiento de estos defectos. No se reinterpretan, no se reejecutan, no se
borran. La fórmula de utilidad se conserva en el código como observación.

---

## 5. Riesgos declarados

- **La suite estará roja por diseño durante la transición.** Hay ~230 archivos de
  test y muchos están atados a los módulos que se retiran. Cada etapa debe dejar
  verde su propio conjunto afectado; el gate raíz completo se exige recién al
  cerrar la etapa 5.
- **Sin comparabilidad con las series históricas.** Es una consecuencia aceptada
  de la decisión del 2026-08-05.
- **P2 puede ser demasiado estricto** para repositorios donde varias unidades
  legítimamente tocan un archivo compartido (un barrel de exports, un
  `package.json`). Si aparece, la salida correcta es un nodo de integración que
  posea ese archivo, **no** relajar P2.
- **El punto fijo depende de que el modelo proponga cortes que reparen la
  propiedad violada.** Si no lo hace, el sistema devuelve una hoja más grande o
  un fallo reportable; en ningún caso inventa un corte ni afloja una propiedad.
