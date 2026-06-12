# Decomposer y Composer — Diseño Actual

> Estado: documento técnico vigente. Reemplaza la narrativa anterior centrada en
> “artifacts de tesis” y experimentos de granularidad. El diseño sigue siendo
> importante para el producto, pero no define una metodología de evaluación
> activa.

---

## Objetivo

ManyHands necesita partir un objetivo de software en tareas ejecutables y luego
volver a componer los resultados. Dos componentes sostienen ese ciclo:

- **Decomposer:** convierte intención en un `TaskGraph` con contratos e
  interfaces.
- **Composer:** integra commits hijos en composites padres con cherry-pick,
  validación y repair semántico.

El valor del diseño no está en producir más nodos. Está en fabricar fronteras de
trabajo suficientemente claras para que agentes aislados puedan construir en
paralelo y luego componer.

## Decomposer

### Responsabilidad

El Decomposer toma una feature y produce:

- nodos `root`, `integrator` y `leaf`;
- dependencias entre nodos;
- `AgentTaskContract` por hoja;
- `executionScope` y `forbiddenPaths`;
- acceptance criteria y comandos de validación;
- `InterfaceContract`s cuando hay costuras compartidas.

### Recursión Local

El decomposer visita nodos de forma recursiva. Cada llamada decide:

- si el nodo ya es atómico;
- o si debe dividirse en hijos con interfaces compartidas.

Esto evita asumir que todo el árbol necesita la misma profundidad. Una rama
simple puede quedar shallow y una rama compleja puede dividirse más.

### Atomicidad

`low | medium | high` controla agresividad de descomposición:

- `low`: tolera unidades más grandes;
- `medium`: punto intermedio;
- `high`: busca unidades más pequeñas.

No hay objetivo de cantidad de nodos ni profundidad fija.

### sharedInterface

Cuando un composite se divide, puede producir un `sharedInterface`: firmas de
tipos/funciones que los hijos deben respetar. Esas interfaces se inyectan en los
prompts de hojas mediante `consumedInterfaces` y `producedInterfaces`.

Esto convierte la coordinación paralela en un problema de contrato explícito:
los agentes no tienen que adivinar la forma de la frontera compartida.

## Composer

### Responsabilidad

El Composer recibe resultados de hijos y produce una rama integrada para el
composite padre.

### Camino Limpio

1. Ordena hijos por dependencias.
2. Aplica commits con `git cherry-pick`.
3. Ejecuta validaciones del padre si existen.
4. Persiste `IntegrationResult`.

### Repair Semántico

Si un cherry-pick falla, el repair recibe:

- goal del composite padre;
- `sharedInterface` canónico;
- objetivo/intención de cada hijo;
- diff y salida real del conflicto;
- diagnósticos pre-merge cuando existen.

El repair busca honrar el contrato del composite, no solo borrar marcadores de
conflicto.

### Validación

El resultado integrado puede fallar aunque el repair haya aplicado. Por eso el
Composer corre validaciones del padre y puede producir `validation_failed`.

## Grounding y Amendments

El grounding prepara un walking skeleton para que las hojas ejecuten contra
costuras existentes desde el inicio. Si un seam cambia durante el run, el motor
de amendments deriva blast radius y vuelve obsoletos solo los nodos afectados.

## Qué Se Retiró Del Diseño

Estas ideas pertenecen a etapas anteriores y no son roadmap activo:

- definir el éxito del sistema como experimento de tesis;
- usar DAGs congelados como matriz experimental;
- comparar B0-B4 como plan oficial;
- tratar `GranularityVector` como instrumento académico central;
- documentar `benchmarks/expression-calculator` o `benchmarks/task-manager-api`
  como fixtures existentes;
- usar `G3/G6/G9` o cantidad de hojas como variable experimental.

La evaluación futura se diseñará desde cero cuando el producto esté completo.

## Puntos De Implementación

- `packages/decomposer/src/llm/recursive/` contiene la descomposición recursiva.
- `packages/contracts/src/index.ts` define `InterfaceContract` y contratos de
  tarea.
- `packages/execution-core/src/run/executor.ts` construye instrucciones de hojas
  con interfaces consumidas/producidas.
- `packages/execution-core/src/integration/agent.ts` implementa el Composer.
- `packages/execution-core/src/run/amendments-engine.ts` maneja invalidación por
  cambios de seams.

