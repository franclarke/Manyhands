# GeminiRecursiveDecomposer

**Archivos fuente:** `packages/decomposer/src/llm/recursive/`, `packages/decomposer/src/`

---

## Qué es

El `GeminiRecursiveDecomposer` es el componente que transforma una feature en lenguaje natural en un `TaskGraph` ejecutable. Lo hace de forma recursiva: visita cada nodo del árbol emergente, decide si es suficientemente atómico para ejecutarse directamente o si conviene dividirlo más, y cuando lo divide produce las costuras de interfaz que los hijos paralelos necesitan para no colisionar.

---

## Responsabilidad

El Decomposer tiene una responsabilidad doble. La primera es obvia: convertir una descripción vaga en un plan estructurado de trabajo. La segunda es menos obvia pero más importante para la tesis: garantizar que los agentes que trabajan en paralelo puedan hacerlo sin interferir — definiendo explícitamente qué tipos y funciones compartidas deben respetar, antes de que arranquen.

---

## Cómo funciona

### El algoritmo recursivo

El corazón del Decomposer es `decomposeNode()`. Para cada nodo que visita, hace **una sola llamada al LLM** que toma dos decisiones a la vez: ¿este nodo es atómico? y si no lo es, ¿cómo se divide?

El LLM devuelve una respuesta con estructura discriminada (`DecomposeStepOutputSchema`):

- **`decision: "atomic"`** — el nodo es una hoja ejecutable. Se completa con su `AgentTaskContract` final.
- **`decision: "decompose"`** — el nodo debe dividirse. La respuesta incluye los hijos, el `sharedInterface` (las costuras entre ellos), sus dependencias internas, y los `parentValidationCommands`.

Si el nodo se divide, el Decomposer recursa sobre cada hijo con el `sharedInterface` como contexto heredado. Cuando ese hijo a su vez se divide, sus propios hijos heredan tanto las interfaces de arriba como las nuevas de este nivel. Las costuras son coherentes en todo el subárbol.

La recursión tiene un `depthBudget` como baranda de seguridad (no como variable experimental): se setea generoso para evitar recursión infinita, pero la variable que realmente controla la profundidad es `aggressiveness`.

### La rúbrica de atomicidad

El LLM no decide "sí o no" arbitrariamente. Aplica una rúbrica explícita con cuatro criterios para declarar un nodo atómico:

1. **Unidad cohesiva única:** el nodo mapea a una sola unidad de implementación (módulo, archivo o función, según el nivel de `aggressiveness`).
2. **Verificable focalizadamente:** sus acceptance criteria se pueden verificar con un test acotado.
3. **Auto-contenido dado el contexto:** se puede implementar con solo su goal, sus interfaces consumidas, y el contenido actual de sus archivos objetivo.
4. **No introduce abstracciones compartidas nuevas:** si para implementarlo hay que definir un tipo del que dependerán hermanos, ese tipo pertenece al `sharedInterface` del padre — no a esta hoja.

El criterio 1 es el único que varía con `aggressiveness`:
- **`low`:** una unidad cohesiva puede ser un módulo o archivo entero → árboles poco profundos, hojas grandes
- **`medium`:** un grupo chico de funciones relacionadas → profundidad intermedia
- **`high`:** una sola función → árboles profundos, hojas muy atómicas

El piso absoluto (invariante a cualquier nivel): una hoja nunca puede ser más pequeña que una función coherente. El Decomposer tiene un guard que detecta hojas sospechosamente pequeñas y las rechaza.

### El sharedInterface: la contribución central

Cuando el Decomposer divide un nodo en hijos, produce junto con ellos un `sharedInterface` — una lista de `InterfaceContract` con las definiciones TypeScript concretas que conectan a los hijos. Por ejemplo, si está descomponiendo "implementar un parser de expresiones matemáticas" en tokenizer + parser + evaluator, produce los tipos `Token` y `Ast` que definen exactamente la frontera entre cada etapa.

Estos `InterfaceContract` se distribuyen a los hijos: el tokenizer recibe `producedInterfaces: [Token]`, el parser recibe `consumedInterfaces: [Token], producedInterfaces: [Ast]`, y el evaluator recibe `consumedInterfaces: [Ast]`. Cuando los tres agentes ejecutan en paralelo, cada uno construye contra las mismas firmas. No pueden inventar interfaces incompatibles porque las firmas llegaron como contexto fijo.

### Invocación de Gemini

El `GeminiRecursiveDecomposer` envuelve un `RecursiveDecomposer` genérico con un `GeminiStepClient`. Para cada llamada de descomposición:

1. Construye el prompt completo con el goal del nodo, el nivel de `aggressiveness`, las interfaces heredadas, y la rúbrica de atomicidad.
2. Invoca `gemini --approval-mode plan` enviando el prompt por stdin. El `--approval-mode plan` es read-only: Gemini puede leer archivos del repo para fundamentar sus decisiones de scope e interfaz, pero no puede hacer cambios.
3. Parsea el JSON de salida con `DecomposeStepOutputSchema` (validación Zod). Si el LLM produce JSON inválido, se reintenta con un mensaje de error descriptivo.

### Los baselines

El `AnthropicSinglePassDecomposer` se conserva como baseline experimental: hace una sola llamada al LLM que produce el DAG entero de una vez. Es menos preciso (más varianza, profundidad uniforme), pero sirve para comparar contra el decomposer recursivo en los experimentos de granularidad.

---

## Interfaces

**Recibe:** una `FeatureRequest` con el objetivo en lenguaje natural, el nivel de `aggressiveness`, y opcionalmente un repo provisionado para grounding.

**Produce:** un `TaskGraph` completo con nodos `root`, `integrator` y `leaf`, donde cada hoja tiene su `AgentTaskContract` con `consumedInterfaces`/`producedInterfaces` cableados.

**Selección:** `pickDecomposer()` en `apps/web/src/lib/decomposer-policy.ts` decide qué decomposer usar según `MANYHANDS_DECOMPOSER` (default: `GeminiRecursiveDecomposer`).

---

## Decisiones de diseño

La recursión local (una llamada por nodo) tiene menor varianza que el single-pass (una llamada para todo el árbol) porque acota los grados de libertad del LLM: en vez de decidir el árbol entero de una vez, cada llamada decide exactamente una cosa sobre exactamente un nodo. Esto es importante para la reproducibilidad de los experimentos de tesis.

El `sharedInterface` es el mecanismo que convierte la descomposición de un ejercicio estructural en una coordinación real entre agentes. Sin él, los agentes paralelos trabajan a ciegas y producen interfaces incompatibles que el cherry-pick no puede resolver.
