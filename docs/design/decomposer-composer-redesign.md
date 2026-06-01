# Rediseño del Decomposer y el Composer — Diseño del Sistema

> Documento de diseño para la tesis. Define la evolución y el diseño objetivo de los dos
> componentes centrales de ManyHands: el **Decomposer** (descompone una tarea en un DAG) y el
> **Composer** (integra subtareas hermanas fusionándolas en su padre).
>
> Audiencia: Francisco (autor) + tribunal de tesis. Estado: **núcleo implementado** (Fases 1-5,
> ver §9). Comunicación en español; términos técnicos, tipos y código en inglés.

---

# Parte I — Storytelling: cómo evolucionaron las decisiones de diseño

Esta sección narra el camino desde el diseño anterior hacia el nuevo. No es historia decorativa:
cada decisión surge de una limitación concreta observada en el código real, y la justificación de
cada una es lo que hace defendibles los artifacts ante el tribunal.

## El punto de partida (diseño anterior)

El sistema que existía antes de este rediseño funcionaba así:

1. **Decomposer single-pass.** `AnthropicDecomposer` hacía **una sola** llamada al LLM
   (`buildDecomposerPrompt`) que producía el DAG entero de una vez. La granularidad era un
   parámetro global — `coarse | balanced | fine` — mapeado a objetivos de *cantidad de nodos* y
   *profundidad máxima* en el prompt (`GRANULARITY_PROFILES`: coarse = 3-8 nodos / depth ≤2, fine =
   9-18 nodos / depth ≤4).

   > **Actualización posterior.** Esos objetivos de cantidad/profundidad se eliminaron: la
   > granularidad ahora es un control de **agresividad de descomposición**, no una forma fija de
   > árbol. `GRANULARITY_PROFILES` describe el *tamaño de unidad cohesiva* y la *presión a dividir*
   > por nivel; `runDecomposerGuards` ya no impone caps de profundidad ni de cantidad (solo un rail
   > anti-runaway). El árbol resultante es asimétrico: cada rama llega a la profundidad que su
   > complejidad justifica. Aplica a ambos decomposers (recursivo y single-pass baseline).

2. **Contratos con scope adivinado en planning.** El LLM emitía `allowedPaths`, `forbiddenPaths`,
   `expectedFiles` y `acceptanceCriteria` por hoja — todo **antes** de que existiera un repo real.
   Los símbolos `producedSymbols` / `consumedSymbols` existían en el contrato pero **no se usaban
   semánticamente** en ningún lado: eran decorativos.

3. **ContextPacker que lee el estado base.** En tiempo de ejecución, cada hoja recibía el contenido
   actual de sus `changedFiles` leído del worktree — es decir, el estado del repo **en el
   baseCommit**, antes de que cualquier hermana hubiera trabajado.

4. **Integrator sintáctico.** El `IntegrationAgent` hacía cherry-pick de los commits hijos sobre la
   rama del padre. Ante conflicto, un único intento de repair con Codex cuyo prompt
   (`buildRepairPrompt`) contenía **solo** los archivos en conflicto y la salida del cherry-pick.
   No incluía el goal del hijo, los acceptance criteria, ni el objetivo del padre. Era un *merge
   tool*, no un *reviewer*.

Este diseño funcionaba para el smoke test (`updateTask` en `models/task.ts` → diff real, commit,
scope check). Funcionaba porque la tarea tenía una propiedad cómoda: **las hojas eran genuinamente
independientes** — cada una tocaba su propio bloque de código sin compartir estado con sus
hermanas.

La pregunta que disparó el rediseño fue: *¿este diseño sirve para tareas de software complejas y
funcionales?* La respuesta honesta fue **no del todo**, y entender por qué fue lo que guió cada
decisión siguiente.

## Decisión 1 — De single-pass a descomposición recursiva

**Limitación observada.** El diseño single-pass forzaba **granularidad uniforme**: toda rama del
árbol se descomponía hasta aproximadamente la misma profundidad, porque el control era un objetivo
global de cantidad de nodos. Pero en software real, una rama puede ser trivial (una función) y otra
puede ser un subsistema entero. Forzar la misma profundidad en ambas produce o bien hojas
demasiado grandes en la rama compleja, o bien fragmentación artificial en la rama simple.

**La intuición de Francisco** (textual): *"una rama del árbol podría necesitar más profundidad de
descomposición que otra, por lo que no creo que sea útil definir un máximo o un objetivo de
niveles."* Esto es exactamente correcto y es incompatible con el control por cantidad de nodos.

**Decisión.** La descomposición pasa a ser **recursiva y local**: cada nodo decide por sí mismo si
conviene descomponerse, evaluando su propia complejidad. El árbol crece de forma desigual,
reflejando la complejidad real de cada sub-problema. No hay objetivo global de nodos ni de
profundidad uniforme.

**Por qué es mejor (y un argumento que sirve para la tesis).** La recursión local además **reduce
la variabilidad** del output del LLM, que es algo que queremos para experimentos reproducibles. Una
llamada single-pass que decide el árbol entero de una vez tiene una cantidad combinatoria de grados
de libertad; cada decisión local recursiva está mucho más acotada (un solo nodo, un solo criterio),
así que hay menos espacio para que el modelo divague. **Descomponer en pasos pequeños y
restringidos produce planes más estables que descomponer todo de una.**

## Decisión 2 — De "cantidad de nodos" a "umbral de atomicidad" + sesgo low/medium/high

**Limitación observada.** Si ya no hay objetivo de cantidad de nodos, ¿qué controla cuánto se
descompone? Necesitábamos un criterio de parada (*stopping criterion*) por nodo.

**Decisión.** Cada nodo se evalúa con un **criterio de atomicidad explícito**: un nodo es una hoja
(no se descompone más) cuando un agente puede implementarlo directamente, sin ambigüedad, con el
contexto disponible. El parámetro de usuario `low | medium | high` **no es un techo de
profundidad** — es un **sesgo sobre el umbral de atomicidad**:

- `low`: el agente tolera scope grande → "es atómico" se cumple antes → hojas grandes, árboles
  poco profundos.
- `medium`: umbral intermedio.
- `high`: exige máxima atomicidad → hojas chicas, árboles profundos.

**El piso absoluto** (decisión de Francisco): *"las hojas como máximo deberían ser funciones
individuales."* El criterio de atomicidad nunca descompone por debajo de una función coherente,
sin importar el nivel. Esto previene la sobre-descomposición patológica (partir una función en
"validar argumento" + "ejecutar lógica" + "retornar"), que generaría conflictos artificiales y
contaminaría el experimento.

**Por qué es mejor.** La granularidad ahora tiene un significado semántico (cuán atómica es una
unidad de trabajo) en vez de un significado puramente estructural (cuántos nodos hay). Esto conecta
directamente con la pregunta de investigación: *¿a qué nivel de atomicidad conviene descomponer?*

## Decisión 3 — El hallazgo central: el paralelismo requiere costuras explícitas

Esta es la decisión más importante del rediseño, y la que convierte al Decomposer en un artifact
con valor de tesis.

**Limitación observada (la grave).** El `ContextPacker` le da a cada hoja el estado del repo **en el
baseCommit** — antes de que sus hermanas trabajen. En tareas donde las hojas son independientes,
está bien. Pero en software real, una hoja que implementa `UserService` necesita conocer la
interfaz de `Database` que **otra hoja está implementando en paralelo**. Con el diseño anterior,
las dos hojas trabajan a ciegas: cada una inventa su propia versión de la costura entre ellas. Cada
una pasa su scope check individualmente. Y después el cherry-pick falla — no por un conflicto de
texto trivial, sino porque **diseñaron interfaces incompatibles**.

Y peor: los `producedSymbols` / `consumedSymbols` ya estaban en el contrato, insinuando esta idea,
pero no se usaban. La información existía y se tiraba.

**El insight.** El problema real de la descomposición paralela no es "cómo partir el trabajo" — es
**"cómo definir las costuras (seams) entre las piezas para que cada pieza se construya en
aislamiento y aun así compongan correctamente."** Cuando un nodo se descompone en hijos, no alcanza
con definir las sub-tareas: hay que definir **el contrato de interfaz que esos hijos comparten**.

Esto se conecta con la literatura que mencionó Francisco. SWE-agent mostró que la *agent-computer
interface* condiciona fuertemente el rendimiento del agente. Acá aplicamos la misma idea a la
**inter-agent interface**: la costura entre dos subagentes que trabajan en paralelo es una interfaz
de primera clase que hay que diseñar, no un accidente emergente.

**Decisión.** En cada paso de descomposición, el Decomposer produce — además de los hijos — un
**`sharedInterface`**: las definiciones de tipos y firmas de funciones que los hijos comparten.
Cada hijo declara qué interfaces `consume` (producidas por hermanas/ancestros) y qué interfaces
`produce` (para que las consuman sus hermanas). Estas definiciones son **reales** (firmas
TypeScript concretas), no nombres sueltos. Los `producedSymbols` / `consumedSymbols` decorativos se
convierten en `produces` / `consumes` que referencian definiciones de interfaz cargadas de
significado.

En ejecución, el `ContextPacker` inyecta en el prompt de cada hoja **no solo** el contenido actual
de los archivos, **sino también** las interfaces que consume: *"Otras tareas están produciendo
estas interfaces; construí exactamente contra ellas: {firmas}."* Así, la costura se fija **antes**
de despachar las hojas, y dos hojas paralelas se construyen contra el mismo contrato sin colisionar.

**Por qué es la contribución de tesis.** Esto es un claim medible y original: *producir un contrato
de interfaz compartido en cada paso de descomposición reduce los conflictos de integración (menor
`conflictRate`, mayor `integrationSuccessRate`) respecto a una descomposición plana, porque las
hojas paralelas se construyen contra una costura común.* Es comparable empíricamente contra el
decomposer single-pass.

## Decisión 4 — De merge sintáctico a composición consciente del contrato

**Limitación observada.** El `IntegrationAgent.buildRepairPrompt` le pasaba a Codex el texto del
conflicto y nada más. Codex veía el choque de líneas pero no sabía **por qué** cada hoja tomó la
decisión que tomó, ni cuál era el objetivo del padre, ni cuál era la interfaz canónica que ambas
hojas debían honrar. Para conflictos triviales alcanzaba; para conflictos reales, la resolución
podía ser sintácticamente válida pero **funcionalmente incorrecta**.

**Decisión.** El integrator evoluciona al **Composer**: un integrador *consciente del contrato*.
Cuando integra los hijos de un composite, tiene acceso a:

- El goal y los acceptance criteria del **padre** (qué tiene que lograr el conjunto).
- El **`sharedInterface`** que se definió cuando ese composite se descompuso (la fuente de verdad
  de la costura).
- El contrato de cada hijo (goal, `produces`/`consumes`) + su diff + su resultado.

Ante un conflicto, el repair se hace con **contexto semántico completo**: *"El hijo A produce la
interfaz X, el hijo B la consume; acá está la definición canónica de X; resolvé de modo que ambos
la honren."* El conflicto deja de ser un choque aleatorio de texto y pasa a ser una *violación del
contrato de interfaz compartido*, que se resuelve **por referencia al contrato canónico** en vez de
adivinando.

**Por qué es la segunda contribución de tesis.** Claim medible: *un integrador que resuelve
conflictos por referencia al contrato de interfaz compartido logra mayor `integrationSuccessRate` y
mayor `testsPassedRate` post-integración que un resolvedor sintáctico de conflictos de merge.*
Comparable contra el `IntegrationAgent` actual.

## Decisión 5 — Conectar la verificación post-integración

**Limitación observada.** Los `parentValidationCommands` existían en el schema del contrato pero el
decomposer LLM **no los poblaba**. Resultado: un composite se integra sin verificar que funciona
como un todo. Podías tener `leafSuccessRate = 1.0` (cada hoja pasó su test individual) y un sistema
integrado roto, porque nadie verificaba la composición.

**Decisión.** Cuando el Decomposer define un composite y su `sharedInterface`, **también** define
los `parentValidationCommands` que verifican que la costura quedó bien (típicamente los tests de
integración que ejercitan la interfaz compartida). El Composer corre esa validación contra el árbol
integrado. Si los hijos honraron el `sharedInterface`, los tests pasan; si no, la integración falla
con un diagnóstico concreto.

**Por qué es mejor.** Cierra el lazo de calidad: la métrica reina del experimento
(`testsPassedRate`) pasa a medir el sistema integrado funcionando, no solo hojas aisladas.

## Decisión 6 — Reproducibilidad para experimentos: DAGs congelados

**Tensión observada.** La descomposición recursiva es no-determinística (N llamadas LLM
encadenadas). Para el experimento científico esto es un problema: si corrés `high` dos veces y
obtenés grafos distintos, no sabés si la diferencia en métricas viene del nivel de descomposición o
de la variabilidad del LLM.

**Decisión (combinación elegida por Francisco).** El **producto** usa descomposición recursiva
adaptativa (es genuinamente mejor para el usuario). Los **experimentos** usan DAGs **congelados**:
se generan una vez con ese mismo Decomposer, se guardan como fixtures versionados, y se ejecutan
múltiples veces para medir la varianza de la *ejecución*, no de la *descomposición*. Las dos cosas
se miden por separado: un estudio sobre la calidad estructural de la descomposición, y otro sobre
la calidad de la ejecución de un DAG fijo.

**Por qué es mejor.** Separa dos fuentes de varianza que de otro modo se confundirían, y hace el
experimento de granularidad estadísticamente limpio sin sacrificar la feature de producto.

## Síntesis de la evolución

| # | Antes | Después | Driver |
|---|-------|---------|--------|
| 1 | Single-pass | Recursivo, local | Ramas con complejidad desigual; menor varianza |
| 2 | Objetivo de nodos (coarse/balanced/fine) | Umbral de atomicidad + sesgo low/med/high con piso = 1 función | La granularidad debe ser semántica, no estructural |
| 3 | Símbolos decorativos; hojas a ciegas | `sharedInterface` explícito; hojas construyen contra la costura | El paralelismo requiere costuras diseñadas (contribución 1) |
| 4 | Integrator sintáctico | Composer consciente del contrato | Los conflictos son violaciones de contrato, no choques de texto (contribución 2) |
| 5 | Validación de integración desconectada | Composer verifica el árbol integrado contra la interfaz | Cerrar el lazo de calidad |
| 6 | (no aplicable) | DAGs congelados para experimentos | Reproducibilidad estadística |

---

# Parte II — El diseño nuevo

## 1. Visión general y flujo de datos

```
                    Feature (lenguaje natural) + aggressiveness {low|medium|high}
                                          │
                                          ▼
        ┌──────────────────────── RECURSIVE DECOMPOSER ────────────────────────┐
        │  decomposeNode(node, depthBudget, aggressiveness):                    │
        │    1. Una llamada LLM: ¿atómico? → leaf | composite + sharedInterface │
        │    2. Si composite: define hijos, sharedInterface, deps, parentValid. │
        │    3. Recursa por hijo, pasando el sharedInterface heredado           │
        │  → produce un TaskGraph donde cada hoja tiene un contract enriquecido  │
        │    con consumedInterfaces / producedInterfaces                         │
        └────────────────────────────────┬─────────────────────────────────────┘
                                          │  (DAG; congelado como fixture para experimentos)
                                          ▼
        ┌─────────────────────────── RUN EXECUTOR ─────────────────────────────┐
        │  Por hoja, en batches (maxParallel=3):                                 │
        │    WorktreeManager.create → ContextPacker(archivos + consumedInterfaces)│
        │    → Codex exec → git diff (D5) → ScopeChecker → orquestador commitea  │
        │  Bottom-up por composite:                                              │
        └────────────────────────────────┬─────────────────────────────────────┘
                                          ▼
        ┌──────────────────────────── COMPOSER ─────────────────────────────────┐
        │  Por composite (bottom-up):                                            │
        │    cherry-pick hijos (camino limpio = igual que hoy)                   │
        │    conflicto → repair con contexto semántico (sharedInterface canónico,│
        │               goal del padre, intención de cada hijo)                  │
        │    → valida el árbol integrado contra parentValidationCommands         │
        └────────────────────────────────┬─────────────────────────────────────┘
                                          ▼
                          GranularityVector (17 métricas) + evidencia
```

Lo que **se conserva** del sistema actual (decisiones cerradas, no se renegocian): Codex CLI como
único executor (D4), `git diff` como verdad (D5), el orquestador commitea (D6), cherry-pick como
mecanismo de integración del camino limpio (D8), `maxParallel=3` (D9), timeouts (D10), sin fallback
silencioso (D3).

Lo que **cambia**: cómo se genera el DAG (recursivo + interfaces), qué lleva el contrato de cada
hoja (interfaces de costura), qué contexto recibe Codex (interfaces consumidas), y cómo el Composer
resuelve conflictos (semántico, no sintáctico) y verifica (post-integración).

## 2. Modelo de datos: el `InterfaceContract`

La pieza nueva que atraviesa todo el sistema. Es lo que hace que las costuras sean explícitas.

```ts
interface InterfaceContract {
  id: string;                       // estable, p.ej. "TaskStore", "createSession"
  kind: "type" | "function" | "module";
  signature: string;                // la firma/definición TS real (no solo el nombre)
  description: string;              // qué hace y qué garantías ofrece
  definedAtNodeId: string;          // qué paso de descomposición lo definió (trazabilidad)
}
```

- Un **composite**, al descomponerse, produce `sharedInterfaces: InterfaceContract[]` — las
  costuras entre sus hijos.
- Cada **hijo** declara `consumes: string[]` y `produces: string[]` (ids de interfaces).
- El Decomposer **cablea** consumes/produces entre hermanos y a través de niveles.
- El contrato de una **hoja** recibe los `InterfaceContract` completos de todo lo que consume
  (inyectados en el prompt) y de todo lo que produce (declarado como su obligación).

Esto reemplaza los `producedSymbols` / `consumedSymbols` decorativos por definiciones de interfaz
cargadas de significado. En el `AgentTaskContract` (V2) se agregan dos campos opcionales,
backward-compatible:

```ts
// nuevos campos en AgentTaskContractSchema (V2, opcionales)
consumedInterfaces?: InterfaceContract[];   // costuras que esta hoja debe respetar
producedInterfaces?: InterfaceContract[];   // costuras que esta hoja debe exponer
```

## 3. El Recursive Decomposer

### 3.1 Algoritmo

```
decomposeNode(node, depthBudget, aggressiveness, inheritedInterfaces):
    # Una sola llamada LLM que juzga Y actúa (más barato y coherente que 2 llamadas)
    response = LLM.decomposeStep({
        node,                       # goal, título, acceptance criteria heredados
        aggressiveness,             # sesga el umbral de atomicidad
        inheritedInterfaces,        # interfaces que ancestros/hermanas ya fijaron
        depthRemaining: depthBudget # solo como señal de "ya estás muy profundo"
    })

    if response.decision == "atomic" OR depthBudget == 0:
        return makeLeaf(node, response.leafContract, inheritedInterfaces)

    # response.decision == "decompose"
    sharedInterfaces = response.sharedInterfaces      # costuras entre los hijos
    children = response.children                       # cada uno con consumes/produces
    parentValidation = response.parentValidationCommands

    childNodes = []
    for child in children:
        # cada hijo hereda las interfaces que consume (de este nivel + de arriba)
        childInherited = inheritedInterfaces
                       + sharedInterfaces.filter(i => child.consumes.includes(i.id))
        childNodes += decomposeNode(child, depthBudget - 1, aggressiveness, childInherited)

    return makeComposite(node, childNodes, sharedInterfaces, parentValidation,
                         response.dependencies)
```

Notas de diseño:

- **Una llamada por nodo visitado.** El juicio de atomicidad y la descomposición van en la misma
  llamada: el LLM devuelve `"atomic"` + contrato de hoja, o `"decompose"` + hijos + interfaces.
  Esto es más barato (mitad de llamadas) y más coherente (la decisión y la acción se razonan
  juntas) que separar `shouldDecompose` de `decompose`.
- **`depthBudget` es una baranda de seguridad, no la variable experimental.** Se setea generoso
  (p.ej. 5-6) solo para evitar recursión infinita / costo desbocado. La variable de control real es
  `aggressiveness`. Esto respeta la posición de Francisco: ninguna rama tiene un techo uniforme; el
  LLM decide por rama cuán profundo ir.
- **Las interfaces se heredan hacia abajo.** Un hijo recibe como contexto fijo las interfaces que
  consume, definidas por su padre o ancestros. Cuando ese hijo a su vez se descompone, sus propios
  hijos heredan tanto las de arriba como las nuevas de este nivel. Así la costura es coherente en
  todo el subárbol.

### 3.2 La rúbrica de atomicidad (el corazón del prompt)

El LLM aplica esta rúbrica para decidir `atomic` vs `decompose`. Un nodo es **átomico (hoja)**
cuando se cumplen **todas**:

1. **Unidad cohesiva única.** Mapea a una sola unidad de implementación coherente (su tamaño máximo
   depende de `aggressiveness`, ver abajo).
2. **Verificable focalizadamente.** Sus acceptance criteria se pueden verificar con un test
   acotado.
3. **Auto-contenido dado el contexto.** Se puede implementar con solo: su goal, sus
   `consumedInterfaces`, y el contenido actual de sus archivos objetivo.
4. **No introduce abstracciones compartidas nuevas.** Si para implementarlo hay que definir una
   abstracción de la que dependerían tareas hermanas, esa abstracción pertenece al `sharedInterface`
   del padre y el nodo **debe** descomponerse (y exponer esa abstracción como costura).

El parámetro `aggressiveness` modula **solo el criterio 1**:

| Nivel | "unidad cohesiva única" significa | Efecto |
|-------|-----------------------------------|--------|
| `low` | un módulo/archivo entero | árboles poco profundos, hojas grandes |
| `medium` | un grupo chico de funciones relacionadas | intermedio |
| `high` | **una sola función** | árboles profundos, hojas atómicas |

**Piso absoluto** (invariante, independiente del nivel): una hoja **nunca** es más chica que una
función coherente. La rúbrica prohíbe explícitamente partir una función en sub-pasos. Esto
garantiza *"las hojas como máximo deberían ser funciones individuales"* y evita la
sobre-descomposición que generaría conflictos artificiales.

### 3.3 Robustez y baja variabilidad del prompt

Para que la descomposición sea de máxima calidad y mínima varianza (requisito de Francisco):

- **Temperature baja** (0 o cercana) en las llamadas de descomposición.
- **Salida estructurada** validada por Zod (ya existe el patrón en `output-schema.ts`).
- **Rúbrica explícita** en el system prompt: el LLM no responde sí/no a ojo, sino que evalúa cada
  criterio de la rúbrica y justifica (`reasoning`), lo que ancla la decisión.
- **Alcance local.** Cada llamada razona sobre **un** nodo, no sobre el árbol entero → menos grados
  de libertad → menos varianza (argumento de la Decisión 1).
- **Few-shot anclado al dominio**: ejemplos de "esto es atómico" / "esto debe descomponerse" para
  cada nivel, en el system prompt.

### 3.4 Costo

Una llamada LLM por nodo visitado. Un árbol con K composites = K llamadas (las hojas no generan
llamada adicional; se resuelven en la llamada del padre que las declara). Para los tamaños de la
tesis (K ~ 3-10) son segundos y centavos. Se mide y se reporta como parte del estudio de
descomposición.

## 4. El contrato de hoja enriquecido

El `AgentTaskContract` de una hoja se enriquece con las interfaces de costura. El `ContextPacker`,
en ejecución, arma el prompt de Codex con:

1. **Objetivo + acceptance criteria** (como hoy).
2. **Scope permitido/prohibido** (como hoy; `executionScope` + `forbiddenPaths`).
3. **Contenido actual de los archivos objetivo** (como hoy; `expectedOutput.changedFiles` leídos
   del worktree).
4. **[NUEVO] Interfaces consumidas.** *"Otras tareas (paralelas o previas) están produciendo estas
   interfaces. Construí exactamente contra estas firmas; no inventes una versión propia:"* seguido
   de las `signature` + `description` de cada `InterfaceContract` en `consumedInterfaces`.
5. **[NUEVO] Interfaces a producir.** *"Tu trabajo debe exponer estas interfaces exactamente con
   esta forma, porque otras tareas dependen de ellas:"* seguido de las de `producedInterfaces`.
6. **Definition of done** (como hoy).

El punto 4 es el mecanismo concreto que hace funcionar el aislamiento paralelo: la costura llega al
agente como contexto fijo, no como algo a descubrir.

## 5. El Composer

Sucesor del `IntegrationAgent`. Conserva el camino limpio por cherry-pick (D8) y agrega conciencia
de contrato.

### 5.1 Algoritmo

```
compose(composite, childResults, sharedInterfaces, parentValidationCommands):
    # 1. Camino limpio: cherry-pick en orden topológico (igual que hoy)
    for child in topologicalOrder(childResults):
        outcome = git.cherryPick(child.commitSha)
        if outcome.ok: continue

        # 2. Conflicto → repair SEMÁNTICO (no sintáctico)
        if repairAlreadyAttempted: return codex_repair_failed   # 1 repair/integración (ADR-0025)
        repair = semanticRepair(composite, child, outcome, sharedInterfaces)
        if not repair.ok: return codex_repair_failed

    # 3. Verificación post-integración contra el árbol integrado
    if parentValidationCommands:
        validation = run(parentValidationCommands, integratedWorktree)
        if not validation.passed: return validation_failed

    return success | codex_repair_success
```

### 5.2 El repair semántico

La diferencia central con `buildRepairPrompt` actual. El prompt de repair incluye:

- **El objetivo del padre** y sus acceptance criteria (qué tiene que lograr el conjunto).
- **El `sharedInterface` canónico** relevante al conflicto — la fuente de verdad de la costura.
- **La intención de cada hijo involucrado**: su goal, qué `produces` / `consumes`.
- El diff en conflicto y la salida del cherry-pick (lo único que ya estaba).

El mensaje conceptual: *"El hijo A produce la interfaz `X` (acá está su definición canónica). El
hijo B la consume. Hay un conflicto en estos archivos. Resolvé de modo que el resultado honre
exactamente la definición canónica de `X` y cumpla el objetivo del padre."* El conflicto se resuelve
**por referencia al contrato**, no adivinando qué quería cada lado.

### 5.3 Verificación post-integración

Si el composite tiene `parentValidationCommands` (poblados por el Decomposer en Decisión 5), el
Composer los corre contra el worktree integrado del composite. Esto verifica que la costura quedó
bien — típicamente tests de integración que ejercitan la interfaz compartida. Conecta el lazo de
calidad: `testsPassedRate` mide el sistema integrado, no solo hojas aisladas.

## 6. Mapeo a la tesis: dos artifacts medibles

| Artifact | Claim falsable | Cómo se mide |
|----------|----------------|--------------|
| **Interface-Aware Recursive Decomposer** | Producir un `sharedInterface` en cada paso de descomposición reduce `conflictRate` y aumenta `integrationSuccessRate` vs. descomposición plana/single-pass | Ejecutar DAGs del nuevo decomposer vs. del single-pass sobre el mismo fixture; comparar las métricas |
| **Contract-Aware Semantic Composer** | Resolver conflictos por referencia al `sharedInterface` logra mayor `integrationSuccessRate` y `testsPassedRate` post-integración que un repair sintáctico | Ejecutar el mismo conjunto de DAGs con el Composer nuevo vs. el `IntegrationAgent` sintáctico; comparar tasas de repair exitoso |

Y la **pregunta central** (granularidad óptima) se vuelve interpretable: `aggressiveness` controla
la profundidad/atomicidad; las métricas muestran dónde se optimiza el trade-off entre **aislamiento**
(hojas chicas, fáciles para un agente) y **composición** (hojas chicas → más costuras → más costo de
integración). El óptimo es el punto que minimiza la suma de los dos costos. Esa es la curva de la
tesis.

## 7. Diseño del experimento bajo el sistema nuevo

- **Variable independiente:** `aggressiveness ∈ {low, medium, high}` → genera 3 DAGs de profundidad/
  atomicidad creciente para el mismo goal. Congelados como fixtures (Decisión 6).
- **Condiciones de ejecución:** `{sequential, parallel+compose}`.
- **Baseline de control:** un agente único (equivalente a `aggressiveness` tan baja que el root es
  atómico).
- **Variables dependientes (GranularityVector):** sobre todo `conflictRate`,
  `integrationSuccessRate`, `testsPassedRate`, `leafSuccessRate`, `totalCostUsd`, `totalDurationMs`.
- **Variables derivadas (medidas, no controladas):** estructura del DAG resultante (`leafCount`,
  `avgLeafDepth`, `maxLeafDepth`, distribución de profundidades por rama).

Matriz: 3 niveles × 2 modos + baseline ≈ 7 celdas, con ~2 repeticiones = ~14 corridas. Tractable en
tokens (≈1-1.5 h con `reasoning=low`, según el smoke real medido: ~116 s/hoja).

Comparaciones que responde:

| Comparación | Pregunta |
|-------------|----------|
| baseline vs. cualquier descomposición | ¿Descomponer mejora la calidad vs. un agente solo? |
| `low` vs `medium` vs `high` (en parallel+compose) | ¿Qué atomicidad maximiza la calidad? ← pregunta central |
| sequential vs parallel+compose (mismo nivel) | ¿El paralelismo mejora la velocidad? ¿A qué costo de conflicto? |
| Decomposer nuevo vs single-pass (mismo nivel) | Validación del Artifact 1 |
| Composer nuevo vs IntegrationAgent sintáctico | Validación del Artifact 2 |

## 8. Capa de producto (post-core, recomendaciones)

Estas features usan el mismo core y son las que Francisco planteó para una etapa posterior. Se
diseñan en detalle cuando se llegue a esa etapa; acá quedan ancladas:

1. **Selección de modelo por nodo.** Cada nodo lleva un `model` opcional en su contrato; el executor
   y el Composer lo respetan. Default configurable: p.ej. un modelo fuerte (`gpt-5.5 high`) para
   integración y nodos complejos, uno barato para hojas simples. El Decomposer puede *sugerir* el
   modelo según la complejidad que evaluó en la rúbrica de atomicidad.
2. **Ejecución individual de nodos.** Disparar un subagente para un nodo puntual; si el nodo tiene
   hijos, ejecutar las hojas de ese subárbol hasta completar el nodo pedido. Reusa el `RunExecutor`
   con un sub-DAG. Requiere materializar el estado parcial (qué hojas ya corrieron).
3. **Re-descomposición interactiva.** Seleccionar un nodo ya generado y descomponerlo en más
   subtareas → el grafo sigue editable/expandible después de generado. Es exactamente
   `decomposeNode` aplicado a un nodo existente, re-cableando interfaces con los hermanos.
4. **Grounding en repo real.** Si hay un repo provisionado disponible en planning, el Decomposer
   puede leer archivos relevantes para anclar sus decisiones de scope e interfaz en la realidad (en
   vez de definir interfaces abstractas desde el goal). Invierte el orden actual (plan→provision
   pasa a provision→plan); se ofrece como opt-in para no romper la reproducibilidad del experimento.
5. **Workspace local real.** Apuntar un run a una carpeta existente de la computadora (o crear los
   archivos realmente en un workspace) para ver los cambios en vivo / correr el proyecto localmente.
   Extiende el `RepoProvisioner` con un `kind: "localPath"` (hoy solo `kind: "fixture"`).

**Recomendaciones adicionales** que surgen del diseño y vale considerar:

- **Vista de la costura en la UI.** Mostrar el `sharedInterface` de cada composite como un panel:
  es la evidencia visual de por qué las hojas pueden correr en paralelo. Refuerza la narrativa de
  tesis y es útil para el usuario.
- **"Dry-run" de descomposición.** Generar el DAG y mostrar las interfaces sin ejecutar, para que el
  usuario edite las costuras antes de gastar tokens de ejecución.
- **Detección de costura faltante.** Si una hoja en ejecución necesita un símbolo que ningún
  `sharedInterface` declaró, marcarlo como "costura no anticipada" — es señal de una descomposición
  imperfecta y un dato valioso para la tesis.

## 9. Qué cambia en el código (mapa de impacto) — **IMPLEMENTADO**

Fases entregadas (cada una en su commit, verde de forma independiente; 407 tests passing, todos los
typechecks limpios, 14 packages build OK):

| # | Paquete / archivo | Cambio | Estado |
|---|-------------------|--------|--------|
| 1 | `packages/contracts/src/index.ts` | `InterfaceContractSchema` + `InterfaceContractKindSchema`; campos `consumedInterfaces?` / `producedInterfaces?` en `AgentTaskContractSchema` (opcionales, backward-compatible) | ✅ |
| 2 | `packages/decomposer/src/llm/recursive/` | `RecursiveDecomposer` (orquestador), `step-schema.ts` (discriminated atomic\|decompose), `step-prompt.ts` (rúbrica de atomicidad + síntesis de interfaz). El single-pass se conserva como baseline | ✅ |
| 3 | `packages/execution-core/src/run/executor.ts` (`buildLeafInstructions`) | Inyecta `consumedInterfaces` / `producedInterfaces` en el prompt de la hoja (decisión: van acá, no en el packer — son datos estáticos del contrato, como `executionScope`) | ✅ |
| 4 | `packages/execution-core/src/integration/agent.ts` | Composer consciente del contrato: `buildRepairPrompt` recibe `parentGoal` + `sharedInterfaces` + `childIntents`; `writeInstructions` inyectable; `parentValidationCommands` ya conectados | ✅ |
| 5 | `packages/execution-core/src/run/executor.ts` (`integrateBottomUp`) | Pasa `parentGoal` + seams del composite + intención por hijo al Composer | ✅ |
| 6 | `apps/web/src/lib/decomposer-policy.ts` | `RecursiveDecomposer` como default del producto; single-pass detrás de `MANYHANDS_DECOMPOSER=single-pass` | ✅ |
| 7 | `benchmarks/expression-calculator/` | Fixture rico: pipeline tokenize→parse→evaluate, costuras reales, 42 tests de integración, arquitectura interna libre. `task-manager-api` se conserva como smoke fixture | ✅ |

**Decisiones de implementación que se apartaron del plan original** (y por qué):

- **Las interfaces se inyectan en `buildLeafInstructions` (executor), no en `context/packer.ts`.** El
  packer lee archivos del disco; las interfaces son datos estáticos del contrato. Ponerlas junto a
  `executionScope`/`forbiddenPaths` (que ya viven en `buildLeafInstructions`) es más coherente.
- **`normalize.ts` no se tocó.** El `RecursiveDecomposer` construye sus propios contratos
  directamente (con las interfaces cableadas); no reusa el `normalize` del single-pass, que sigue
  sirviendo al baseline.
- **Los `sharedInterfaces` del composite se guardan en `contract.producedInterfaces`** del nodo
  composite (en vez de un campo nuevo en task-graph), de donde el Composer los lee. Evita tocar el
  modelo de nodos.

Principios respetados: cambios aditivos y opcionales para back-compat; Zod solo en boundaries; un
archivo, una responsabilidad; tests verdes antes y después de cada commit; el single-pass decomposer
y el repair sintáctico se **conservan** como baseline de comparación experimental.

## 10. Cuestiones abiertas y limitaciones honestas

- **Grounding vs. pureza.** El Decomposer define interfaces abstractas desde el goal (reproducible)
  pero sin leer el repo real puede equivocarse en tareas que dependen fuertemente de estructura
  existente. El grounding (8.4) lo mitiga pero invierte el orden plan/provision. Para la tesis se
  usa el modo puro; el grounding queda como extensión de producto documentada.
- **Calidad de la interfaz depende del LLM.** Si el LLM define una mala costura, el aislamiento
  falla aunque el mecanismo sea correcto. Esto es parte de lo que el experimento mide: cuán seguido
  el decomposer produce costuras que efectivamente evitan conflictos.
- **Fixture suficientemente rico.** ✅ Resuelto: `benchmarks/expression-calculator` aporta la
  estructura jerárquica con costuras reales (`Token[]` entre tokenizer y parser, `Ast` entre parser
  y evaluator) y profundidad desigual natural (el parser de precedencia es profundo, el tokenizer
  shallow). Fija solo la interfaz pública (`calculate(expr): CalcResult`) vía 42 tests de
  integración; la arquitectura interna la diseña el decomposer — lo que prueba el Artifact 1. Para
  demos visuales libres (calculadora React, sudoku) se usa el camino prompt-only sin fixture.
- **Costo de N llamadas en planning.** Tractable para los tamaños de tesis, pero crece con el
  tamaño del árbol; se mide y reporta.
- **El piso "una función" es un juicio del LLM**, no una garantía mecánica. La rúbrica lo instruye
  pero un modelo puede violarlo; conviene un guard post-hoc que detecte hojas sospechosamente chicas.

---

## Apéndice — ADRs derivados (a crear)

Este documento de diseño se descompone en ADRs atómicos siguiendo el patrón del repo
(`docs/adr/0001`–`0028`):

- **ADR-0029** — Descomposición recursiva local (reemplaza el control por cantidad de nodos).
- **ADR-0030** — `aggressiveness {low|medium|high}` como sesgo de atomicidad con piso = 1 función.
- **ADR-0031** — Síntesis de `sharedInterface` en cada paso de descomposición (Artifact 1).
- **ADR-0032** — Composer consciente del contrato + verificación post-integración (Artifact 2).
- **ADR-0033** — DAGs congelados como fixtures de experimento (reproducibilidad).

> Estado de este documento: **núcleo implementado** (Fases 1-7 de §9). Lo que queda fuera del núcleo
> y se difiere a etapas posteriores: los ADRs derivados (0029-0033, arriba), el harness de
> experimentos con DAGs congelados (Etapa F), y la capa de producto de §8 (selección de modelo por
> nodo, ejecución individual de nodos, re-descomposición interactiva, grounding, workspace local).
> Verificación pendiente de tokens: una descomposición recursiva real contra Anthropic + una
> ejecución end-to-end desde la UI (el núcleo está cubierto por tests con LLM mockeado).
