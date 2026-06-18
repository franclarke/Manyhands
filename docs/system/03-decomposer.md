# Decomposer recursivo (interface-aware)

**Archivos fuente:** `packages/decomposer/src/llm/recursive/`,
`packages/decomposer/src/`

---

## Qué Es

El decomposer recursivo transforma una feature en lenguaje natural en un
`TaskGraph` ejecutable. Lo hace de forma recursiva: visita nodos, decide si son
atómicos o si deben dividirse, y cuando los divide produce interfaces compartidas
entre los hijos.

## Responsabilidad

El Decomposer convierte intención humana en trabajo estructurado. Su salida debe
ser suficientemente concreta para que:

- el usuario pueda revisar y aprobar el plan;
- cada hoja tenga un contrato ejecutable;
- los agentes paralelos conozcan las interfaces que deben producir o consumir;
- el runtime pueda derivar dependencias, scope y validación.

## Cómo Funciona

Para cada nodo, el decomposer hace una llamada LLM que devuelve una de dos
formas:

- `decision: "atomic"` — el nodo queda como hoja ejecutable y recibe su
  `AgentTaskContract`.
- `decision: "decompose"` — el nodo se divide en hijos, dependencias internas y
  `sharedInterface`.

Si el nodo se divide, el algoritmo recursa sobre los hijos. Las interfaces se
heredan hacia abajo para que un subárbol mantenga coherencia con las costuras ya
definidas por sus ancestros.

El `depthBudget` es una baranda anti-runaway. No es una metodología de benchmark
ni una promesa de forma de árbol.

## Atomicidad

El decomposer usa una rúbrica explícita para decidir si un nodo es atómico:

1. mapea a una unidad cohesiva de implementación;
2. es verificable con criterios acotados;
3. puede ejecutarse con el contexto disponible;
4. no necesita crear abstracciones compartidas nuevas.

`low | medium | high` sesga el umbral de atomicidad:

- `low`: hojas más grandes;
- `medium`: equilibrio;
- `high`: hojas más pequeñas.

La granularidad no fija cantidad de nodos ni profundidad. La forma final del DAG
depende del problema.

## sharedInterface

Cuando un nodo se divide, el decomposer puede producir `InterfaceContract`s:
firmas TypeScript, tipos o funciones que conectan a los hijos. Esas interfaces
se copian en `consumedInterfaces` y `producedInterfaces` de los contratos de
hoja.

En ejecución, el prompt de cada hoja incluye las interfaces que debe respetar.
Esto reduce la posibilidad de que agentes paralelos inventen costuras
incompatibles.

Cada step de división se valida semánticamente antes de aceptarse: toda
`sharedInterface` definida en ese step debe figurar en el `produces` de algún
hijo. Si una costura queda definida y consumida pero sin productor, el step se
rechaza como recoverable (`graph_invalid`) y se reintenta con feedback explícito,
en lugar de dejar pasar un grafo que luego fallaría en
`validateExecutableTaskGraph` con `orphan_consumed_interface`.

La obligación de producción se propaga hacia abajo: si a un nodo se le asignó
producir una costura y ese nodo decide **descomponerse** en vez de ser atómico,
debe re-asignar esa costura al `produces` de alguno de sus hijos. Solo las hojas
cuentan como productoras en la frontera ejecutable, así que un composite que
deja caer su obligación dejaría la costura sin productor en todo el subárbol. El
step se rechaza con el mismo mecanismo recoverable hasta que la obligación llega
a una hoja real, en lugar de aceptar un plan que recién fallaría — en
descomposiciones profundas — con `orphan_consumed_interface` después de
construido el grafo completo.

## Invocación

El wrapper del decomposer (por defecto `ClaudeCodeRecursiveDecomposer` sobre
Claude Code CLI; variantes `RecursiveDecomposer` sobre el SDK Anthropic y
`CodexRecursiveDecomposer` sobre Codex CLI):

1. construye el prompt con goal, nivel de granularidad, interfaces heredadas y
   rúbrica;
2. invoca el modelo Claude en modo de planificación;
3. parsea JSON con Zod;
4. reintenta o falla con error accionable si la salida no cumple el schema.

## Interfaces

**Recibe:** una `FeatureRequest`, hints del workspace y configuración de modelo.

**Produce:** `TaskGraph`, contratos de tarea e interfaces.

**Selección:** `pickDecomposer()` en `apps/web/src/lib/decomposer-policy.ts`.

## Nota Histórica

Antes existió una narrativa de comparación experimental contra un decomposer
single-pass. Esa comparación no forma parte del roadmap actual. El single-pass
puede seguir existiendo como compatibilidad o herramienta de desarrollo, pero no
define una evaluación vigente.

