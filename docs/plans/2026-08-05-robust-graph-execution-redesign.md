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
| **P1** | posee ≥1 criterio, y si es hoja declara un archivo de test entre sus `writes` | validación fantasma, criterios huérfanos |
| **P2** | sus `writes` son disjuntos de los de todas sus hermanas | outputs disputados, conflictos de integración |
| **P3** | todo `read` está en el snapshot, en los `writes` de una hermana, o en los `reads` del padre | `artifact_empty`, seams `logical` |
| **P4** | su scope entra en el presupuesto observado del ejecutor | hojas infactibles |

Ver la etapa 3 para la formulación precisa: P4 gobierna la recursión, P1–P3 son
invariantes del corte y se reparan por el mismo canal.

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
  "reads": ["..."], "writes": ["..."] }
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
| 3A | Contrato reads/writes y las cuatro propiedades | **completada** — `ab6c598` |
| 3B | Relaciones derivadas y proyección | **completada** — `e0e6f99` |
| 3C | Criterios refinados, cableado productivo y eventos | **completada** — `2d5b0a5`, `7c6ef39` |
| 3D | Utilidad como observación y retiros | pendiente |
| 3E | Verificación de la cadena | **parcial** — contrato verificado; falta la corrida end-to-end |
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

> Planificada en detalle el 2026-08-05. Al diseñarla aparecieron **dos
> correcciones al contrato de la etapa 2** que se aplican acá.

#### Corrección 1 — `reads` y `writes` en vez de `existingPaths` y `plannedPaths`

La etapa 2 heredó del sistema viejo la partición «rutas que existen» contra
«rutas que voy a crear». Esa partición **no distingue leer de escribir**: un
archivo existente que la unidad va a modificar y otro que solo necesita mirar
caen los dos en `existingPaths`.

Con esa ambigüedad P2 y P3 son incomputables. El contrato pasa a ser:

- `writes` — archivos que la unidad **crea o modifica**;
- `reads` — archivos que la unidad **necesita leer y no cambia**.

Siguen siendo cinco campos por hijo, y las dos preguntas son más naturales para
el modelo que la distinción existe/no existe. Que un `write` exista o no en el
snapshot deja de importar: crear y modificar son el mismo compromiso.

#### Corrección 2 — las propiedades son invariantes del corte, no un evaluador aparte

Al escribir los remedios se ve que **cada propiedad violada pide una acción
distinta**, y que tres de las cuatro son propiedades de un *conjunto de
hermanas*, no de una unidad aislada:

| | Propiedad | Nivel | Remedio |
|---|---|---|---|
| **P1** | toda hija que entra en el presupuesto declara al menos un archivo de test entre sus `writes` | corte | reparar el corte |
| **P2** | los `writes` de las hijas son disjuntos de a pares | corte | reparar el corte |
| **P3** | todo `read` de una hija está en el snapshot, o en los `writes` de una hermana, o en los `reads` del padre | corte | reparar el corte |
| **P4** | el scope de la unidad entra en el presupuesto del ejecutor | unidad | **cortar** esa unidad |

Es decir: **P4 gobierna la recursión y P1–P3 gobiernan la validez del corte**,
por el mismo canal de reparación que ya existe. No hace falta un evaluador
separado ni un segundo bucle.

**P1 distingue hoja de composite:** una hoja debe traer su test porque se prueba
sola; un composite prueba por integración sobre el árbol fusionado, así que le
alcanza con poseer un criterio. Una hija se sabe hoja en el momento del corte,
porque eso es P4 sobre su propia declaración.

**P3 es inductivo y por eso es local.** Caso base: los `reads` de la raíz están
en el snapshot, porque no existe otra cosa. Paso: si los `reads` de `U` son
satisfacibles, y cada hija lee solo del snapshot, de los `writes` de una hermana
o de los `reads` de `U`, entonces toda hija es satisfacible. Se verifica mirando
únicamente a las hermanas: no hace falta el árbol completo.

**Además:** la unión de los `writes` de las hijas debe **cubrir** los `writes`
del padre. Un corte no puede perder por el camino un archivo que el padre se
comprometió a producir.

#### Sub-etapas

**3A — Contrato de lecturas/escrituras y las cuatro propiedades.** Migrar el
contrato, implementar P1–P3 como invariantes del corte con diagnóstico por
propiedad, y P4 como gobierno de la recursión. Sin producción todavía.

*Aceptación:* un corte con `writes` solapados se rechaza y se repara, y nunca
llega a compilarse; un `read` colgado se rechaza con el archivo exacto; una hija
dentro del presupuesto sin test se rechaza; un corte que pierde un `write` del
padre se rechaza; cada rechazo nombra la propiedad y la hija.

**3B — Relaciones derivadas y proyección.** Derivar las dependencias de
`reads ∩ writes`, con materialización `files` por construcción. Proyectar el
árbol a `SemanticPlan` y compilar con el compilador existente. La fórmula de
utilidad pasa a observación.

*Aceptación:* los tres `it.fails` del arnés se ponen rojos y se convierten en
tests normales; `logical` no aparece nunca en la salida derivada.

**3A cerrada en `ab6c598`** — 9/9 en `cut-properties.test.ts` y 9/9 en
`recursive-planner.test.ts`.

> **Hallazgo de 3A: el presupuesto mínimo realista es 4 rutas.** Una hoja honesta
> lee un archivo, escribe su fuente y escribe su test: eso ya cuesta tres. Con un
> presupuesto de dos, la cobertura de `writes` del padre y P1 se vuelven
> incompatibles y ninguna hoja es satisfacible. El valor no se ajustó a un
> resultado: salió de construir el primer árbol de profundidad cuatro.

> **Hallazgo de 3A: la granularidad alcanzable está acotada por la granularidad
> de los criterios.** Una unidad sobre presupuesto que posee un solo criterio no
> se puede particionar. Se reporta `unresolved` con ese diagnóstico exacto, en
> vez de inventar un corte para satisfacer el presupuesto. Es un resultado real
> del método y es accionable: el objetivo debe declarar criterios más finos.

**3B cerrada en `e0e6f99`** — 9/9 en `derived-relations.test.ts`, 12/12 en el
arnés, y regresión amplia de 67/68 archivos y 495 tests. El único rojo sigue
siendo el hash de `dist` congelado, preexistente.

> **Decisión de 3B: se deriva un criterio de integración por composite.** Todo
> nodo necesita al menos un outcome y todo criterio necesita exactamente un
> dueño; si un composite tomara prestado un criterio que un descendiente ya
> prueba, quedaría poseído dos veces. El criterio derivado hace explícita la
> obligación real del composite, que es integrar.

**Movido a 3C:** *la fórmula de utilidad como observación.* Necesita los perfiles
de contexto del repositorio que arma el host, así que se cablea junto con el
planner en vez de duplicar esa construcción en el paquete.

> Nota de diseño: se **reusa** `compileGraphRevision` en vez de escribir un
> compilador nuevo. Sus doce invariantes dejan de ser loterías y pasan a
> cumplirse por construcción — los criterios están poseídos exactamente una vez
> porque el corte particiona, las seams tienen productor y consumidor porque se
> derivan, y la materialización ejecutable es `files` porque son archivos. Es
> también el argumento de la tesis: **el mismo invariante que antes rechazaba
> planes ahora es un teorema del método de construcción.**

#### Corrección 3 — los criterios se refinan, no se particionan

Descubierta al cablear 3C. `runPlanningV2` recibe `acceptanceCriteria` sólo
desde un candidato experimental; **un run productivo normal no declara
ninguno**, así que la raíz queda con un único criterio derivado del objetivo. Con
la regla de partición de 3A, toda raíz sobre presupuesto sería `unresolved`. El
camino nuevo estaría muerto al nacer.

La corrección es la que el diseño ya pedía sin haberlo dicho: **descomponer el
trabajo y descomponer la aceptación son la misma operación**.

- Cada hija declara **su propio criterio**, una frase, con id derivado de su key.
- Los criterios del padre **se quedan con el padre**, y son exactamente lo que su
  outcome de integración prueba sobre el árbol fusionado.
- Se retira la regla de partición: no había nada que partir.

Sigue habiendo cinco campos por hija — `criterionIds` se reemplaza por
`criterion`. Y las tres garantías se conservan: toda unidad posee al menos un
criterio, cada criterio tiene exactamente un dueño porque su id sale de una key
única, y el objetivo se prueba en la raíz por integración de todo el árbol.

Es también más honesto: que las hijas cubran el criterio del padre no es algo
que un validador pueda afirmar de antemano; lo prueba la integración, que es
donde el diseño ya decidió mover la validación.

**3C — Cableado productivo y eventos durables.** Reemplazar la rama de
`PlanningModule` en el host, emitir los eventos de journal, y **recién entonces**
retirar `planning-envelope.ts`, `work-breakdown.ts`, el canal de progreso
embebido y la decisión de `strategy-selector`.

*Aceptación:* un run productivo planifica con el camino nuevo; el journal
registra nodo resuelto, corte propuesto, reparación intentada y nodo sin
resolver.

**Cerrada en `2d5b0a5` y `7c6ef39`.** 4/4 en `planning-v2-recursive.test.ts`
sobre el host real, más 59/60 archivos y 396 tests en la regresión amplia.

> **Decisión de eventos: se reusan los que ya existen.** Una unidad resuelta *es*
> el hecho durable que `planning.node_discovered` ya describe, y un corte
> rechazado *es* `planning.attempt_failed` con el diagnóstico del validador
> textual. Inventar eventos paralelos para decir lo mismo habría repetido el
> error que este rediseño existe para corregir. El único evento nuevo es
> `planning.unit_unresolved`, porque ninguno existente puede describir un nodo
> que no es ni hoja ni composite.

**3D — Utilidad como observación y retiros.** La fórmula se calcula y persiste
por nodo sin decidir, y recién entonces se retiran `planning-envelope.ts`,
`work-breakdown.ts`, el canal de progreso embebido y la decisión de
`strategy-selector`.

*Aceptación:* los assessments se persisten con la misma forma que hoy; ningún
módulo retirado queda alcanzable.

**Fuera de alcance:** ejecución.

> **Regla de retiro:** no se borra código todavía alcanzable. Los retiros de 3C
> ocurren después de que el camino nuevo esté probado en producción, nunca antes.

---

### Etapa 3E — Verificación de la cadena

> Insertada el 2026-08-06. Después de 3C había mucho construido sobre dos
> supuestos no verificados, y seguir a la etapa 4 sin comprobarlos repetía el
> patrón que produjo trece freezes: construir, congelar, descubrir al final.

**Supuesto 1 — ¿un modelo real contesta el contrato de cinco campos?**
**VERIFICADO.** El arnés gana modelos live, grabador y replay para el
`CutModel`, y el suite reproduce offline una transcripción real de Claude Haiku.

> Haiku contestó **al primer intento, sin ninguna reparación**, con un corte de
> tres hojas domain → service → API, cada una con su criterio, escrituras
> disjuntas y su propio test. De ahí se derivaron tres dependencias, las tres
> `files`. Sobre el mismo modelo y el mismo target, SP2 había fallado 6/6
> candidatos con el contrato viejo. El argumento central del rediseño deja de
> ser hipótesis.

Grabar de nuevo:
`MANYHANDS_HARNESS_LIVE=1 pnpm vitest run tests/planning-cut-transcript.test.ts`

**Revisión crítica de lo implementado — 2026-08-06.** Encontró tres defectos
reales en `RecursivePlanner`, los tres corregidos con regresión roja previa:

1. **La raíz podía quedar como hoja sin escribir nada.** El host la construye
   con lecturas y `writes: []`; si entraba en el presupuesto se aceptaba como
   hoja, y el plan compilaba con una única unidad que no prometía ninguna
   salida — un run que sólo podía terminar en «leaf produced no diff». Ahora una
   hoja es `fitsBudget && escribe un test`, así que la raíz siempre se corta.
   **Un test propio certificaba el defecto** y fue reescrito.
2. **El límite de profundidad devolvía una hoja en silencio.** `depth >= maxDepth`
   aceptaba como hoja una unidad sobre presupuesto, violando P4 y P1 sin decirlo.
   Ahora es `unresolved` con su diagnóstico.
3. **Las keys sólo eran únicas dentro de un corte.** Dos primos con la misma key
   colapsan en un nodo y fusionan sus scopes. Ahora la unicidad se sigue en todo
   el árbol.

El primer fix destapó una tensión que el propio rediseño había introducido: la
regla de achicamiento estricto hace insatisfacible un corte motivado por P1,
porque una hoja que lee un archivo y escribe su test ya cuesta lo mismo que el
padre. El achicamiento ahora se exige **sólo cuando el corte lo motiva P4**; el
corte motivado por P1 termina por P1 misma, porque toda hija que entra debe
traer un test y queda hoja.

**Verificado además:** las dependencias derivadas **sí** gobiernan la ejecución.
`semantic-plan-projection.ts:24` convierte cada seam no-`logical` en
`candidateArtifact`, y de ahí sale un `artifactRequirement` con
`requiredFor: "execution"` que `getExecutableReadinessV2` exige. Sobre la
transcripción real quedó la cadena `domain -> service -> api`. Funciona
**porque** la materialización es siempre `files`: un `logical` habría sido
filtrado ahí y el orden se habría perdido en silencio, que es exactamente la
clase de defecto de SP1q.

**Supuesto 2 — ¿un plan del camino nuevo es ejecutable?** Abierto. La corrida
end-to-end sobre el target SP2 es el próximo paso. Su objetivo no es medir: es
encontrar dónde se rompe la costura entre planning nuevo y ejecución vieja.

Esa primera transcripción real ya destapó **D9**, que hay que tener presente al
leer la corrida: el paralelismo va a estar serializado por una razón conocida.

---

### Etapa 4 — Scheduler de ready-set y workspace por intento

**Qué se construye**

- Scheduler de despacho continuo (§2.5): ready-set topológico, límite de
  concurrencia configurable, recálculo tras cada nodo terminado.
- **El modelo de conflicto se reemplaza junto con el scheduler que lo consume**
  (D9): sólo los escritores conflictúan, así que bajo P2 el conjunto de
  conflictos es siempre vacío y las hermanas corren en paralelo por
  construcción. Se retira el `it.fails` de `planning-cut-transcript.test.ts`.
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
(579) —el planner, no el schema—, `worktree-pool.ts` + `fenced-lease.ts` +
`topology-lease.ts` (~1.600), la capa de integración separada, el parser del
canal de progreso embebido, y la mayor parte del fencing. Estimado: 4.000–5.000
líneas menos, de 30 compuertas pre-ejecución a 4 propiedades, y de 10 mecanismos
de coordinación a 2.

**Se preserva sin tocar:** toda la evidencia histórica bajo `docs/tesis/`. Las
series SP1, SP2, G6, G7 y `retry-*` quedan como evidencia cerrada del proceso de
descubrimiento de estos defectos. No se reinterpretan, no se reejecutan, no se
borran. La fórmula de utilidad se conserva en el código como observación.

---

## 4.1 Deuda técnica registrada

Se anota acá a medida que aparece, para que todo se cierre dentro de este plan.

| # | Deuda | Dónde se salda |
|---|---|---|
| ~~D1~~ | ~~El host productivo todavía planifica con `PlanningModule`.~~ Saldada en `7c6ef39`. | — |
| D2 | La fórmula de utilidad todavía decide en `strategy-selector`. | 3D |
| D3 | `planning-envelope.ts`, `work-breakdown.ts` y el canal de progreso embebido siguen alcanzables. | 3D |
| D4 | Las caracterizaciones `it.fails` del camino viejo en `planning-harness.test.ts` se borran junto con ese camino. | 3D |
| D5 | **La raíz lee todo el snapshot.** Hoy el arnés arma la raíz con *todas* las rutas indexadas. En un repo grande eso es ilimitado y hace que el primer corte se decida sobre ruido. Hace falta una estrategia de grounding que acote las lecturas de la raíz a lo relevante para el objetivo. | etapa nueva antes de 7 |
| D6 | **Un run no puede declarar criterios de aceptación.** `runPlanningV2` sólo los recibe desde un candidato experimental, así que el objetivo entra como un único criterio implícito. Funciona con refinamiento, pero el objetivo real queda sin enunciar. | 3D o etapa 7 |
| D7 | `wide-graph-oracle-contract` compara el hash de `dist` contra un freeze histórico y queda rojo con cualquier cambio de producto. Hay que decidir si se declara oráculo histórico y se retira del suite. | 3D |
| D8 | El presupuesto de scope (`maxScopePaths`) es un parámetro sin anclar, igual que `minimumAdvantage` lo era. Debe salir de una medición del ejecutor, no de un número elegido. | etapa 7 |
| D10 | El host cuenta unidades resueltas en el campo `attempt` de `planning.node_discovered`, que semánticamente es un número de intento. No rompe nada, pero el journal miente sobre qué mide. | 3D |
| D9 | **El compilador declara conflicto entre unidades que sólo *leen* el mismo archivo.** `compileScopeConflicts` cruza el scope completo, así que el corte real de Haiku produjo 2 conflict constraints con escrituras disjuntas, y `wave-selector-v2` **impide seleccionar dos nodos en la misma wave** cuando hay un constraint entre ellos: los lectores compartidos se serializan. Bajo P2 sólo los escritores pueden conflictuar, así que el número correcto es siempre cero. Se intentó el retrofit y **no es expresable en el compilador viejo**: un `plannedPath` no puede nombrar un archivo existente, y su review *exige* un conflict constraint por cada solapamiento de scope. No tiene forma de decir «modifico este archivo existente» distinto de «lo leo» — la misma ambigüedad que la corrección 1 encontró en el contrato del planner. Marcado `it.fails` en `planning-cut-transcript.test.ts`. | etapa 4, junto con el scheduler que lo consume |

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
