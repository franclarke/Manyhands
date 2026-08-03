# Repository Inspector, Planner y Graph Compiler

## Pipeline

```text
Goal + RunTargetContext
  -> Repository Inspector
  -> Planning protocol + frozen context
  -> SemanticPlanDraft receipts
  -> canonical SemanticPlan
  -> bounded-cohesion ExecutionCut
  -> Graph Compiler
  -> GraphRevision
  -> durable terminal commit
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

## PlanningModule

`start/resume/replay` es la interfaz externa. El módulo carga el objetivo,
criterios, constraints, decisiones resueltas, snapshot y protocolo congelados.
Solicita receipts por slot mediante `SemanticProposalPort` y los confirma con
`PlanningRecordPort` bajo la lease del run.

El modelo devuelve `SemanticPlanDraft`: boundaries con handles locales,
superficies del repositorio, outcomes con owner y verificación, y seams que
mantienen participantes, compatibilidad, materialización y prueba en una sola
estructura. El draft no contiene identidad persistente ni comandos.

ManyHands normaliza paths y orden, rechaza ambigüedad sin inventar decisiones y
deriva snapshot/digests/IDs/hashes. Una incertidumbre no resuelta vuelve insegura
esa propuesta. Replay usa receipts persistidos y no llama un modelo vivo.

Una pregunta se eleva solo si la respuesta cambia comportamiento, arquitectura,
scope, riesgo o aceptación. Preferencias locales reversibles se dejan al agente.

## Graph Compiler

Consume exclusivamente `SemanticPlan + ExecutionCut + RepositorySnapshot` en la
ruta productiva. Proyecta composites cohesivos seleccionados como hojas
ejecutables, retargetea seams sin modificar el plan canónico y compila
`SeamBinding`, `ArtifactRequirement`, conflicts, contract bundles, scopes y
validation obligations. La compilación es determinista.

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
- Output inválido: rechaza sólo ese receipt; producto puede continuar con otra
  propuesta segura y experimento aplica su quorum estricto.
- Repo no inspeccionable: decisión de entorno o fail; nunca plan sin grounding
  presentado como confiable.
- Graph no ejecutable: vuelve al compiler/planner con findings.

## Aprobación

La aprobación refiere una revisión exacta. Editar goal, node boundaries,
contratos o criterios crea una nueva revisión e invalida la aprobación anterior.

## Compatibilidad histórica

Los eventos con `PlanningEnvelope`, `CandidatePlan` o `WorkBreakdown` siguen
siendo legibles e inmutables. Ningún evento productivo nuevo ni input del
compiler semántico puede contener esos formatos.
