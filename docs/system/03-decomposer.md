# Repository Inspector, Planner y Graph Compiler

## Pipeline

```text
Goal + RunTargetContext
  -> Repository Inspector
  -> Planning Brief
  -> Planner
  -> WorkBreakdown
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

## Planning Brief

Resume objetivo, constraints del usuario, repository model, baseline, riesgos y
preguntas ya respondidas. Es la entrada común para el planner y los critics.

## Planner

Produce `WorkBreakdown` con boundaries, objetivos parciales, outputs, relaciones
candidatas, evidencia de grounding y preguntas. Debe justificar los cortes por
cohesión, integración, riesgo o verificabilidad.

Una pregunta se eleva solo si la respuesta cambia comportamiento, arquitectura,
scope, riesgo o aceptación. Preferencias locales reversibles se dejan al agente.

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
