# Planner, Graph Compiler e Integrator

> **Documento histórico.** `WorkBreakdown` ya no es una salida productiva. El
> contrato vigente es `SemanticPlanDraft -> SemanticPlan -> ExecutionCut`; véase
> [`../system/03-decomposer.md`](../system/03-decomposer.md).

## Por qué se separan

“Descomponer” mezclaba tres problemas distintos: comprender la intención, elegir
una arquitectura de trabajo y fabricar estructuras ejecutables. La arquitectura
vigente los separa para que cada salida pueda validarse.

```text
goal + repository model
  -> Planner: WorkBreakdown
  -> Graph Compiler: GraphRevision + contracts
  -> Critics: findings / approval candidate
  -> execution
  -> Composite Integrator: parent artifacts
```

## Planner

El Planner responde:

- ¿qué resultado observable debe existir?;
- ¿qué fronteras reales tiene el repositorio?;
- ¿qué capacidades compartidas habilitan otros cambios?;
- ¿qué incrementos pueden verificarse de forma independiente?;
- ¿qué ambigüedades requieren una decisión humana?

No debe inventar paths exactos si el índice no los sustenta ni optimizar por una
cantidad objetivo de nodos.

## WorkBreakdown

La salida intermedia contiene objetivos, boundaries, outputs esperados,
relaciones candidatas, preguntas y evidencia de grounding. Es revisable sin
mezclar IDs, waves o detalles de persistencia.

## Graph Compiler

Convierte el breakdown en:

- árbol de ownership `root/composite/leaf`;
- `ArtifactRequirement` para disponibilidad real;
- `SeamBinding` para compatibilidad paralela;
- `ConflictConstraint` para scheduling;
- contratos de scope, interfaces, artefactos y validación;
- revisiones y fingerprints iniciales.

Debe rechazar ciclos, producers inexistentes, criteria sin validación, scopes
imposibles, outputs sin consumer/propósito y hojas demasiado ambiguas.

## Atomicidad óptima

Una hoja es atómica si un agente puede:

1. comprenderla con contexto acotado;
2. modificar un conjunto cohesivo de archivos;
3. producir un output identificable;
4. demostrar criterios sin depender de integración futura desconocida;
5. reintentarse o descartarse sin invalidar trabajo no relacionado.

No se exige que toque una sola capa o un solo archivo.

## Integrator

El Composite Integrator recibe una base, manifests hijos y contrato del padre.

Camino:

1. valida que cada input esté vigente y sea alcanzable;
2. ordena solo por requirements reales;
3. aplica artefactos explícitos y registra qué incorporó;
4. clasifica conflictos;
5. ejecuta una reparación semántica acotada si corresponde;
6. valida el composite en un sandbox limpio;
7. registra un nuevo artefacto o una falla explicable.

Un conflicto textual limpio puede requerir validación conductual. Una reparación
que compila pero no satisface el contrato sigue siendo falla.

## Enmiendas

Cuando ejecución o integración descubre una omisión, propone una enmienda con:

- causa y evidencia;
- cambio de grafo/contrato;
- impacto proyectado;
- intentos y artefactos que quedarían stale;
- trabajo preservado;
- opciones para el usuario si requiere juicio.

La aprobación crea una nueva revisión. No edita la historia anterior.
