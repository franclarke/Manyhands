# TaskGraph y TaskNode

**Archivos fuente:** `packages/task-graph/src/index.ts`

---

## Qué es

El `TaskGraph` es el modelo de datos central de ManyHands: representa el plan de trabajo como un grafo dirigido acíclico (DAG) de tareas jerárquicas. Contiene todos los nodos del plan y el mapa de dependencias entre ellos.

---

## Responsabilidad

El `task-graph` tiene una sola responsabilidad: modelar *qué hay que hacer* y *en qué orden*. No ejecuta tareas, no toma decisiones de scheduling, y no habla con agentes. Es la fuente de verdad estructural del plan — el punto de partida del que todo lo demás se alimenta.

---

## Cómo funciona

### Los tres tipos de nodo (NodeKind)

Todo nodo en el grafo es uno de tres tipos:

- **`root`:** el objetivo raíz de la feature. Siempre hay exactamente uno por run. Representa la intención completa del usuario en lenguaje natural. No tiene contrato de ejecución porque no se ejecuta directamente — su objetivo se logra cuando todos sus hijos integran.

- **`integrator`:** un nodo compuesto con hijos. Representa un sub-objetivo que se logra componiendo el trabajo de múltiples hojas. El `IntegrationAgent` lo utiliza como contexto cuando integra sus hijos: el goal y acceptance criteria del integrator son la fuente de verdad de qué debe lograr el conjunto.

- **`leaf`:** la unidad atómica ejecutable. Es el único tipo de nodo que tiene un `AgentTaskContract` completo. Un agente LLM recibe su contrato y ejecuta exactamente lo que describe.

### La anatomía de un TaskNode

Cada nodo tiene:
- **`id`:** identificador único (UUID)
- **`title`:** nombre corto del sub-objetivo
- **`goal`:** descripción completa de qué debe lograr este nodo (el campo canónico; nunca `intent`)
- **`kind`:** root | integrator | leaf
- **`granularity`:** auto | low | medium | high — el nivel de agresividad de descomposición aplicado a este nodo
- **`status`:** el estado actual del nodo en el ciclo de vida del run
- **`prompt`:** texto adicional de contexto (optional)
- **`acceptanceCriteria`:** lista de criterios verificables que definen qué significa "terminado"
- **`dependencies`:** shortcut de lectura que refleja las dependencias del nodo (el registro canónico está en `graph.dependencies`)

### Las dependencias: dos registros, una fuente de verdad

El `TaskGraph` tiene un `dependencies` propio que es un `Map<nodeId, Set<nodeId>>` — el mapa canónico de quién depende de quién. Cada `TaskNode` también tiene un campo `dependencies` que es simplemente una copia sincronizada para conveniencia de lectura.

**La regla es simple:** nunca se modifica `node.dependencies` directamente. Toda mutación de dependencias pasa por los helpers `addDependency()`, `removeDependency()` y `syncNodeDependencies()`, que mantienen ambos registros coherentes. Esta separación existe porque el mapa del grafo es más eficiente para los algoritmos de traversal (topo sort, cycle detection), mientras que el array del nodo es más cómodo para serialización y acceso rápido.

Las aristas D1 tienen semántica de ejecución `ordering_only`: bloquean el
dispatch/readiness de la tarea dependiente hasta que su predecesora se resuelve,
pero no copian ni materializan el commit del predecesor en su worktree. Todas
las hojas parten del mismo `TaskGraph.baseCommit`; la integración bottom-up
compone sus commits después. Si una tarea necesita archivos concretos producidos
por otra, ese trabajo debe quedar en una sola tarea o expresarse como una
compatibilidad explícita mediante `sharedInterface`, no como herencia implícita
de una dependencia.

### Validación del grafo

`validateTaskGraph()` verifica que el grafo es estructuralmente correcto:
- **Ciclos:** ningún nodo puede depender de sí mismo, directa o transitivamente.
- **Nodos huérfanos:** todo nodo (excepto root) debe ser alcanzable desde root.
- **Dependencias rotas:** no puede haber un edge que apunte a un nodeId inexistente.
- **Constraints de kind:** solo las hojas pueden tener `AgentTaskContract`; la raíz no puede tener dependencias entrantes.

`validateExecutableTaskGraph()` es la frontera más estricta usada por producto
cuando un plan puede aprobarse o ejecutarse. Además de la estructura del DAG,
valida cada contrato de hoja con `validateAgentTaskContractBoundary()` y
bloquea contratos faltantes, `taskId` desalineado, paths inseguros, schemas
inválidos y costuras consumidas sin productor o producidas por múltiples hojas.
Warnings como `missing_execution_scope` o `missing_expected_changed_files`
quedan explícitos para permitir fallback conservador, no paralelismo ambiguo.

### Orden topológico y readiness

`getTopologicalOrder()` produce la lista de nodos ordenada de tal forma que los antecesores siempre aparecen antes que sus dependientes. El `BatchScheduler` consume este orden para saber qué hojas se pueden ejecutar en cada batch.

`getLeafReadiness()` determina si una hoja específica está lista para ejecutarse: lo está cuando todos sus nodos antecesores (directos e indirectos) están en estado `done` o `integrated`. Una hoja con dependencias pendientes permanece bloqueada hasta que sus predecesores completen.

`aggregateTaskStatus()` sube el estado desde las hojas hasta la raíz: el estado de un nodo compuesto es una función del estado de sus hijos. Si todas las hojas son `done`, el composite puede avanzar a `integrated`.

---

## Interfaces

**Produce:** el `TaskGraph` completo que el `RunExecutor` y el `BatchScheduler` consumen para planificar la ejecución.

**Lo consumen:** `BatchScheduler` (topo sort + readiness), `IntegrationAgent` (goals y contratos de los composites), `GranularityVector` (estructura del árbol para métricas pre-ejecución), `RunGraphViewModel` (transformación para el canvas).

**Lo genera:** el decomposer recursivo construye el grafo nodo a nodo durante la descomposición. El usuario puede editarlo desde la web app antes de aprobar, pero las fronteras de approval/replan/execution vuelven a validar el grafo ejecutable.

---

## Decisiones de diseño

El mapa de dependencias vive en el grafo y no solo en los nodos porque los algoritmos de traversal (ciclos, topo sort, readiness) son más eficientes y legibles sobre estructuras de grafo explícitas. Duplicar la información en `node.dependencies` es un trade-off deliberado de conveniencia de lectura versus complejidad de escritura — los helpers lo administran.

El campo `goal` reemplazó a `intent` porque semánticamente es más preciso: describe el *objetivo alcanzable* del nodo, no la *intención abstracta* del usuario.
