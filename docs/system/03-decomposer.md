# GeminiRecursiveDecomposer

**Archivos fuente:** `packages/decomposer/src/llm/recursive/`,
`packages/decomposer/src/`

---

## Qué Es

El `GeminiRecursiveDecomposer` transforma una feature en lenguaje natural en un
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

## Invocación

El wrapper de Gemini:

1. construye el prompt con goal, nivel de granularidad, interfaces heredadas y
   rúbrica;
2. invoca Gemini CLI en modo de planificación;
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

