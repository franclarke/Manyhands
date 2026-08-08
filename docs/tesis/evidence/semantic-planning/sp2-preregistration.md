# SP2 sobre el sistema rediseñado — pre-registración

> **Estado:** pre-registrado, **no ejecutado**. Fecha: 2026-08-07.
> **Alcance:** etapa 7 de
> [`../../../plans/2026-08-05-robust-graph-execution-redesign.md`](../../../plans/2026-08-05-robust-graph-execution-redesign.md).
> **Relación con [`sp2-protocol.md`](sp2-protocol.md):** el protocolo sigue
> vigente. Este documento no lo reemplaza: registra lo que se corrigió **antes**
> de congelar y define las mediciones que el protocolo nombra pero no deriva.

La regla que gobierna todo lo de abajo: cualquier cambio al target, al oráculo o
a las definiciones de medición ocurre **antes** del congelamiento y queda
escrito acá. Durante la serie no se toca ninguno de los tres.

---

## 1. Verificación de activos

El protocolo se apoya en activos que viven fuera del historial de un plan y
desaparecen sin dejar rastro. Se verificaron uno por uno antes de escribir nada:

| Activo | Estado |
|---|---|
| Template del target | Presente: `sp2-target-template/` |
| Evaluador externo | Presente: `sp2-oracle/evaluator.mjs` — **fuera** del template, ver §4.1.2 |
| Objetivo exacto y criterios | Presentes en `sp2-protocol.md` §«Objetivo exacto» y §«Criterios externos» |
| SHA base por celda | **Se crea al congelar** — el protocolo lo especifica así (`git init` sobre una copia del template) |

No falta ningún activo. El target es Node ESM puro sin dependencias, así que la
celda no depende de red ni de instalación.

---

## 2. Dos correcciones previas al congelamiento

Ambas se encontraron ejecutando el oráculo, no leyéndolo.

### 2.1 El evaluador no cubría dos de sus cinco criterios

El evaluador congelado verificaba los criterios 3 y 4 y **la mitad** del 1 y del
2:

- **Criterio 1** — «`priority` acepta sólo `standard` o `express`, con
  `standard` por defecto». Rechazaba `urgent`, pero **nunca comprobaba el
  valor por defecto**. Una implementación que no guardara prioridad alguna
  pasaba.
- **Criterio 2** — «no descarta la orden: registra un backorder positivo y la
  orden **sigue cancellable**». Comprobaba el backorder, pero **nunca la
  orden**. Una implementación que archivara el backorder y tirara la orden
  pasaba.

Es la misma falla que la etapa 5 cerró dentro del producto: una obligación
requerida sin evidencia que la cubra es el `verified` más peligroso que hay.
Tenerla en el oráculo de la tesis la vuelve incorregible después.

Las dos comprobaciones nuevas usan **sólo** las superficies que el objetivo ya
nombra —`currentOrders()`, `currentBackorders()`, `events()`—; ninguna exige un
endpoint que la tarea no haya pedido. El oráculo quedó más estricto, no más
laxo, y quedó así **antes** de que exista una celda.

### 2.2 El fixture hacía contradictorio el objetivo

`test/baseline.test.mjs` comparaba la orden entera con `deepStrictEqual`. Como
el criterio 1 exige que la prioridad sea observable, cualquier implementación
correcta agrega un campo a la orden y **rompe ese test preexistente** — mientras
el objetivo dice «Preserve existing behavior». La celda habría fallado por una
propiedad del fixture, no por la calidad del plan, y el resultado adverso no
habría sido atribuible a nada de ManyHands.

La aserción se reescribió campo por campo. Defiende exactamente el
comportamiento que su nombre declara —se reserva inventario disponible y la
orden queda `reserved`— y deja de fallar por un campo agregado. **No se relajó
ningún criterio**: los cinco siguen intactos.

### 2.3 Evidencia de que ambas correcciones son correctas

Se escribió una **solución de referencia desechable** fuera del repositorio
(nunca en el template) y se corrió el par completo:

| | Tests del target | Evaluador |
|---|---|---|
| Template intacto | pasa (1/1) | **falla** (exit 1) |
| Solución de referencia | pasa (1/1) | **PASS** |

Las dos direcciones importan. Que el evaluador falle sobre el template prueba
que la tarea está sin hacer y que el oráculo la detecta. Que pase sobre una
solución razonable prueba que el oráculo es **satisfacible** — sin eso, una
serie entera podría fracasar por criterios mutuamente imposibles y el fracaso
se leería como un resultado sobre ManyHands.

---

## 3. Qué se mide, y de dónde sale exactamente

El protocolo nombra cuatro medidas. Dos no tenían derivación y una estaba mal
tomada. Todas quedan definidas **antes** de la serie: una derivación escrita
después de ver los runs es una derivación ajustada a ellos.

### 3.1 Entregas verificadas repetibles

Del veredicto del protocolo: celda completa **y** los cinco criterios externos
satisfechos sobre el commit candidato exacto. `PASS` sólo con 2/2.

### 3.2 Profundidad alcanzada — corregida (D13)

Sale de `planning.granularity_strategy_selected` → `metrics.maxGraphDepth`.

Ese evento **medía el árbol de la política, no el que compiló**. Desde la etapa
3D la política de utilidad no decide nada, así que su árbol preferido no es el
que se ejecuta; el evento tomaba `metrics` de `strategy.selectedBreakdown` y
`candidateTree` del árbol compilado, de modo que un mismo evento podía describir
dos árboles distintos. Con la condición A la divergencia es total: la política
colapsa la raíz a una hoja por definición, y el journal reportaba **profundidad
0 y una hoja** para un run que compiló y ejecutó **tres**.

Corregido en esta etapa, con regresión roja previa
(`tests/planning-v2-adaptive.test.ts`). La regresión no depende de afinar un
fixture: usa la condición A, donde el colapso es una definición y no un umbral.

### 3.3 Paralelismo disponible contra ejecutado — instrumento nuevo

No existía derivación. Se agregó `observeRunParallelism`
(`packages/run-coordinator/src/parallelism-observation.ts`), con tests propios y
verificada además contra el journal real que produce el driver, no sólo contra
eventos armados a mano.

Por cada `readiness.observed`:

- **`running`** — intentos despachados y aún sin liquidar. Se lee del ciclo de
  vida de los intentos, **no** de `activeResourceNodeIds` del scheduler: ese
  conjunto es una unión que también arrastra recursos tomados desde afuera, que
  bloquean el despacho sin ser trabajo en vuelo.
- **`eligible`** — nodos con `ready` que el selector **no** difirió. Un nodo
  diferido por conflicto está `ready` pero no es paralelismo disponible: la
  restricción dice que no puede correr al lado de lo que corre.
- **`available` = `running` + `eligible`** — la concurrencia que el grafo
  ofrecía.
- **`executed` = `running` + despachados** — la que el run alcanzó.
- **`capBinding`** — `available > executed`.

La distinción es la que la etapa 7 existe para hacer. Un run serial tiene dos
causas que desde afuera se ven idénticas: **el plan no ofrecía trabajo
independiente**, o **el tope lo prohibió**. La primera es un resultado sobre la
descomposición; la segunda es un número de configuración. Reportarlas juntas
sería reportar cualquiera de las dos como la otra.

Un run cuyo journal no registró explicaciones cuenta en
`unobservedReadinessCount` y deja `peakAvailable` **ausente**, nunca en cero:
«no se observó» no es «no había». El run canónico histórico
(`../canonical-run/run-1.events.jsonl`) cae en ese caso, con 3 observaciones sin
explicaciones — es evidencia de que la distinción hace falta.

### 3.4 Assessments de utilidad

Se persisten por nodo como **observación**. No deciden nada y no entran en el
veredicto.

---

## 4. Ensayo previo, fuera de la serie

Antes de congelar se corre **una celda de ensayo** sobre una copia del template,
declarada como ensayo y **nunca contada**. Su único propósito es comprobar que
la maquinaria llega de punta a punta sobre un target `.mjs`.

Existe porque hay un antecedente exacto: la etapa 1 descubrió que
`fast-indexer.ts` no indexaba `.mjs` y que por eso el planner de SP2 había
recibido cero rutas de evidencia, invisible durante trece series. Congelar y
después descubrir que el instrumento no registra lo que dice registrar cuesta la
serie entera.

El ensayo verifica, y sólo verifica:

1. La inspección devuelve rutas de evidencia y `baselineCommands` no vacíos para
   un target `.mjs` sin lockfile.
2. El plan compila y ninguna seam ejecutable queda `logical`.
3. El journal persiste `readiness.observed` **con** `explanations`, de modo que
   §3.3 tenga de dónde leer.
4. `metrics.maxGraphDepth` coincide con la profundidad del grafo compilado.

Si algo de eso falla, se arregla y se vuelve a ensayar. El congelamiento ocurre
después.

---

## 4.1 Enmiendas que produjo el ensayo

El ensayo del 2026-08-07 (run `1bb2b66b`) encontró dos cosas que ningún test
podía encontrar. Las dos cambian el protocolo **antes** del congelamiento.

### 4.1.1 El gate de seams `logical` es vacuo por construcción

`sp2-protocol.md` §Procedimiento paso 2 manda marcar `FAIL` de planning si
alguna seam `api`, `type` o `command` tiene materialización `logical`.

En el sistema rediseñado `SeamContractSchema` es `.strict()` y **no tiene campo
`materialization`**. Leer `seam.materialization` compara `undefined` contra
`"logical"` y da verdadero para cualquier plan, seguro o no. El gate no protege
nada y se lee como si lo hiciera — que es peor que no tenerlo.

La propiedad que SP1p perseguía sigue siendo la correcta, pero ahora vive en
otro lado: desde la etapa 3B las relaciones se derivan de `reads ∩ writes` y
cruzan como artefactos. **Enunciado de reemplazo, verificable y falsable:**

> Toda seam ejecutable debe cruzar como un artefacto **materializado** que el
> consumidor espera en fase `execution`. Ninguna requirement de ejecución puede
> resolver a un artefacto sin materialización, y ningún par
> productor→consumidor declarado por una seam puede quedar sin cubrir.

Verificado sobre el plan del ensayo: 4 seams, 3 requirements de ejecución, todas
con `materialization: "files"` y rutas concretas, cero pares sin cubrir.

### 4.1.2 El oráculo estaba dentro del alcance del run

`evaluator.mjs` vivía dentro del repositorio del target. El ensayo mostró tres
consecuencias, y las tres son sobre la validez del resultado, no sobre el
sistema:

1. **Escritura.** Quedó en `allowedPaths` del scope de la raíz y en los
   `expectedPaths` de su artefacto de salida. El run podía editar el evaluador
   que lo juzga; «el evaluador pasó» dejaba de ser evidencia. El daño es
   silencioso: un `PASS` sobre un oráculo modificado se ve idéntico a uno real.
2. **Lectura.** El indexador lo tomó como uno de los 5 archivos del target, así
   que entró como evidencia del planner. El run planificaba y ejecutaba **con
   el test de aceptación a la vista**, y podía satisfacer sus aserciones exactas
   en vez del objetivo. Para una afirmación sobre producir software correcto,
   eso la debilita mucho más que el punto 1.
3. **Ruido.** Un archivo que no es parte del sistema bajo prueba entró en el
   grafo de decisión del corte.

**Corrección: el oráculo sale del repositorio del target.** Vive en
[`sp2-oracle/`](sp2-oracle/), fuera del template. Se evalúa así:

1. Checkout del commit candidato exacto en un árbol descartable.
2. Copiar el oráculo congelado dentro de ese árbol.
3. Correr los tests propios del target y después `node evaluator.mjs`.

Así el evaluador no se indexa, no se lee y no se escribe. No hace falta comparar
hashes: el archivo no existe en el árbol que produce el run, de modo que la
condición se satisface por construcción en vez de por vigilancia.

---

## 4.2 Resultado del ensayo del 2026-08-07

Run `1bb2b66b-7032-41a0-8849-23ff1ee1878f`, `claude-code-cli`/`haiku` en las tres
etapas, condición C, `maxParallel: 4`, target creado desde el template en
`57661c72`. **No es una celda y no cuenta.**

### Lo que quedó establecido

| Verificación | Resultado |
|---|---|
| Inspección de un target `.mjs` sin lockfile | **PASS** — 5 archivos indexados y `baselineCommands=[npm test]`. Es D11 comprobada contra un target real, no un fixture |
| Plan compilado, seams ejecutables materializadas | **PASS** — 4 nodos, 3 hojas, 3 requirements de ejecución, todas `files`, cero pares sin cubrir |
| El run no puede escribir el oráculo | **FAIL** → enmienda §4.1.2 |
| `readiness.observed` con explicaciones | **PASS** — 3/3; el instrumento de §3.3 tiene de dónde leer |
| Profundidad persistida = árbol compilado | **PASS** — profundidad 1, 3 hojas, iguales |

El plan que produjo es exactamente el vertical slice que
[`next-run.md`](next-run.md) recomendaba: Domain → Application → API más un
composite de integración, con las seams cruzando como artefactos.

Primera medición de paralelismo sobre un journal productivo: `available=1`,
`executed=1`, `cap=4`. **El tope no ató**; la cadena domain→application→api no
ofrece trabajo independiente. Es el resultado que el instrumento existe para
distinguir, y con el oráculo viejo se habría reportado como «sin paralelismo» sin
poder decir por qué.

### El defecto que habría invalidado las dos celdas

La hoja de dominio corrió, gastó 184.739 tokens de entrada y **no cambió nada**:
`changedFiles: []`, `candidateCommit` igual al commit base. Aun así quedó
`validation.completed → verified`, criterio `satisfied`, y su artefacto fue
**adoptado**. El run recién se rompió dos nodos después, cuando el consumidor no
pudo materializar el artefacto vacío — y esa falla se clasificó `unclassified`,
porque para entonces ya nadie podía nombrar la causa.

La causa está en `ResultRecorder`. Un diff vacío se acepta como no-op legítimo
cuando «el baseline ya satisface el contrato», y la evidencia que pedía era que
los archivos existieran y no tuvieran el marcador de stub del scaffolder. La
rama fue escrita para el walking skeleton, donde el propio run escribe esos
archivos. **Nada en el repositorio construye ese scaffolder**, así que ningún
archivo lleva nunca el marcador y la condición la cumple todo archivo
preexistente de un target brownfield: es decir, siempre.

Un agente que no hizo nada quedaba indistinguible de uno que no tenía nada que
hacer, y el run afirmaba lo segundo.

Corregido: el no-op exige ahora evidencia positiva de que **este run** escribió
esos archivos (`groundingScaffoldedPaths`). Ausente —el caso de todos los
llamadores actuales— un diff vacío es `empty_diff`, una falla.

### Lo que el ensayo **no** estableció

El run quedó parado en `waiting_for_input` con una decisión pendiente —
correctamente, no colgado — así que **nunca llegó a integración ni a entrega**.
El camino más allá de la primera hoja sigue sin verificarse de punta a punta.
Hace falta un segundo ensayo antes de congelar.

### Deuda que dejó abierta

`artifact_empty` se clasifica `unclassified`. La causa es perfectamente
nombrable —el productor no produjo nada— y la etapa 5 afirma que toda falla mapea
a exactamente una causa. Es una laguna de la taxonomía y necesita su propia
regresión; no bloquea el ensayo porque su causa raíz acaba de cerrarse, pero la
clase sigue siendo la equivocada si vuelve a aparecer por otra vía.

---

## 5. Congelamiento

Se registra al ejecutar, y no se cambia entre celdas:

- Commit de ManyHands.
- Hash de cada archivo del template y SHA base de cada celda.
- Objetivo exacto (el de `sp2-protocol.md`, sin editar), modelo, esfuerzo,
  presupuesto, `maxParallel` y condición de granularidad.
- Este documento.

`maxParallel` se registra explícitamente porque §3.3 puede atribuirle el límite:
un tope no registrado vuelve ininterpretable la mitad del resultado.

---

## 6. Veredicto

Sin cambios respecto de `sp2-protocol.md` §«Veredicto». `PASS` sólo con 2/2
celdas completas y los cinco criterios externos satisfechos; en cualquier otro
caso `PARTIAL` o `FAIL` **con la causa observada**.

Nunca reemplazar una celda fallida por un retry, ampliar scopes para compensar
un plan incorrecto, ni modificar template, protocolo, evaluador o definiciones
de medición durante la serie.

---

## 7. Qué no se mide

- Superioridad entre políticas de granularidad. La fórmula de utilidad es
  observación desde la etapa 3D.
- Comparación con la evidencia histórica SP1, G6, G7 o Warehouse. No se
  reinterpreta ni se reejecuta.
- Wall-clock como resultado. El despacho continuo reemplazó las barreras de
  wave, pero dos celdas no sostienen una afirmación de rendimiento.
- `maxScopePaths` (D8) no se ancla acá. La serie **produce** la medición que
  permitiría anclarlo; anclarlo con estos datos y después medir con él sería
  circular.
