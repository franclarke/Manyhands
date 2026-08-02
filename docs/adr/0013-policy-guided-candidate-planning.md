# ADR 0013 — Planning guiado por política y selección de candidatos válidos

## Contexto

El flujo histórico pedía un único `WorkBreakdown` al planner y recién después
aplicaba la política de granularidad. Esa secuencia no permite comparar cortes
semánticos: una política puede puntuar o reformar el árbol recibido, pero no
puede recuperar un corte que el planner no propuso. La evidencia de G6 es
histórica y no se modifica con esta decisión.

Además, los `acceptanceIntentIds` y los `CandidateSeam` existentes expresan
referencias, pero no una matriz explícita de ownership ni la compatibilidad y
validación requeridas de cada seam. Una puntuación de utilidad no puede
compensar una omisión de ese tipo.

## Decisión

El planning productivo evoluciona hacia esta frontera:

```text
goal + repository snapshot
  -> PlanningEnvelope determinista
  -> 2–3 CandidatePlan semánticos del planner
  -> validación fail-closed de ownership, seams, scope y obligaciones
  -> selección determinista entre candidatos válidos
  -> GraphRevision, contratos y ejecución inmutables
```

`PlanningEnvelope` contiene versión de política, snapshot, digest del objetivo,
presupuesto de candidatos y límites de ejecución. No contiene unidades, paths ni
seams: inventarlos corresponde al planner semántico y validarlos al compiler.

Un `CandidatePlan` debe acompañar su breakdown con una matriz tipada de
`AcceptanceOwnership` (`local`, `seam`, `global`) y con especificaciones de seam
que declaren compatibilidad y validación. Un candidato inválido queda fuera de la
comparación; no recibe una penalidad compensable. Si ninguno pasa, se emite un
diagnóstico de replan estructurado y acotado.

Con el mismo envelope, conjunto de candidatos, configuración y versión de
política, la selección es reproducible; los empates se resuelven por
`candidateId` estable. Los eventos y snapshots deberán retener el envelope,
hashes de candidatos, diagnósticos de rechazo, evaluación y ganador para
reconstruir la decisión sin volver a invocar al LLM.

## Alternativas descartadas

- Dividir mecánicamente por paths o capas: sustituye semántica por estructura y
  puede violar alcance y contratos.
- Aceptar un único árbol y sólo variar la fórmula: no crea alternativas
  comparables ni resuelve defects estructurales.
- Penalizar seams u ownership incompletos: una ganancia de paralelismo no debe
  compensar un contrato ausente.
- Replan ilimitado: oculta el costo, impide auditoría y hace la recuperación
  dependiente del azar del modelo.

## Consecuencias

El planner conserva la responsabilidad de proponer unidades semánticas. La
política fija restricciones y selecciona; el Graph Compiler verifica y compila;
el scheduler no reinterpreta intención. Los adaptadores del planner deben
producir el artefacto tipado completo, no inferir ownership a posteriori.

La compatibilidad con runs ya preservados se limita a lectura de sus eventos y
contratos existentes. No se reescriben ni reclasifican decisiones históricas.

Esta decisión no afirma que un candidato estructuralmente válido sea correcto
para el producto: la validación de ejecución y la evaluación experimental
siguen siendo necesarias.

## Riesgos y seguimiento

La actual captura de fallos de ejecución puede perder el hecho terminal si falla
la propia escritura de `run.failed`; esa resiliencia de persistencia requiere un
receipt durable y reconciliación separados. No se debe fabricar un éxito ni un
terminal no persistido para ocultar ese fallo.
