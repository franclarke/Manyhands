# Repository Inspector, Planner y Graph Compiler

## Pipeline

```text
Goal + RunTargetContext
  -> Repository Inspector
  -> PlanningEnvelope
  -> Planner
  -> WorkBreakdown candidate set
  -> selected frontier
  -> Graph Compiler
  -> GraphRevision
  -> Critics
  -> Approval candidate
```

## Repository Inspector

Lee el commit objetivo sin modificarlo. Produce:

- paquetes, módulos y dependencias;
- public APIs, schemas y símbolos relevantes;
- comandos y suites de validación;
- convenciones y límites arquitectónicos;
- estado git y restricciones operativas;
- digest/freshness del modelo.

Los datos desconocidos se marcan como unknown. No se fabrican paths o comandos
para completar el schema.

## PlanningEnvelope y candidatos semánticos

`PlanningEnvelope` es el contrato previo a la generación. Fija la versión de
política, el presupuesto acotado de candidatos, los límites de ejecución de las
hojas y los gates de ownership, materialización, validación local y compilación.
No contiene nodos ni sustituye al `WorkBreakdown`: describe las condiciones bajo
las cuales se generan y comparan cortes semánticos contra el mismo snapshot.

El Planner puede producir un conjunto acotado de candidatos (hasta tres en el
piloto). Todos deben estar grounded en el snapshot y conservar el objetivo y
los criterios de aceptación. Un pedido de aclaración detiene el planning; no se
responde automáticamente. Los candidatos se canonizan por hash, se evalúan con
la estrategia determinista de granularidad y se compilan de forma independiente.
Los fallos de estructura, estrategia o compiler dejan evidencia diagnóstica y
excluyen sólo ese candidato. Sólo la frontera del candidato seleccionado llega
al `Graph Compiler` y se persisten las evaluaciones de todos los candidatos.

Resume objetivo, constraints del usuario, repository model, baseline, riesgos y
preguntas ya respondidas. Es la entrada común para el planner y los critics.

## Planner

Produce `WorkBreakdown` con boundaries, objetivos parciales, outputs, relaciones
candidatas, evidencia de grounding y preguntas. Debe justificar los cortes por
cohesión, integración, riesgo o verificabilidad.

Una pregunta se eleva solo si la respuesta cambia comportamiento, arquitectura,
scope, riesgo o aceptación. Preferencias locales reversibles se dejan al agente.

Este flujo es el sucesor productivo del trabajo de G6; no modifica G6, sus
fórmulas, oráculos, estímulos, preregistro ni evidencia histórica.

## Graph Compiler

Asigna identidad estable, compila relaciones tipadas, contratos, scopes,
validation obligations y revisions. La compilación debe ser determinista en las
partes mecánicas y rechazar ambigüedad no resuelta.

## Critics

| Critic | Pregunta |
|---|---|
| Completeness | ¿Todo criterio del objetivo tiene owner y evidencia? |
| Atomicity | ¿Cada hoja es cohesiva y descartable? |
| Graph | ¿Las relaciones son válidas y sin ciclos? |
| Contracts | ¿Seams y artifacts permiten implementar sin adivinar? |
| Scope | ¿Los límites son posibles y seguros? |
| Validation | ¿Se puede demostrar el resultado? |
| Risk | ¿El paralelismo propuesto es defendible? |

Un finding contiene severidad, evidencia, nodo/contrato afectado y reparación
propuesta. Los errores bloquean aprobación. Los warnings se muestran con
impacto; no se esconden en logs.

## Fallos

- Error/timeout del modelo: falla accionable o retry transitorio según causa.
- Output inválido: un repair de schema puede solicitar corrección al mismo
  modelo sin inventar contenido.
- Repo no inspeccionable: decisión de entorno o fail; nunca plan sin grounding
  presentado como confiable.
- Graph no ejecutable: vuelve al compiler/planner con findings.

## Aprobación

La aprobación refiere una revisión exacta. Editar goal, node boundaries,
contratos o criterios crea una nueva revisión e invalida la aprobación anterior.

## Que no se concluye

La validación puede comprobar que las dependencias declaradas por un
`WorkBreakdown` son coherentes con la evidencia disponible, los contratos y los
gates del compiler. No puede demostrar que un LLM haya revelado cada
dependencia semántica latente del objetivo o del repositorio.
