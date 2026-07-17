# Contratos

## Propósito

Los contratos convierten una intención en obligaciones verificables. Separan lo
que debe ser cierto de cómo un agente decide implementarlo.

## TaskContract

```ts
type TaskContract = {
  nodeId: NodeId;
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  scope: ScopeContract;
  consumes: ArtifactInput[];
  produces: ArtifactOutput[];
  seams: SeamReference[];
  validation: ValidationContract;
  constraints: string[];
  revision: number;
};
```

## ScopeContract

Declara paths permitidos por categoría, paths prohibidos y permisos especiales.
`forbidden` siempre gana. Un scope es un límite de adopción: el proceso puede
intentar escribir fuera, pero el resultado se descarta y se registra.

## SeamContract

Define la frontera observable entre siblings:

- tipos, schemas o firmas;
- semántica relevante: unidades, zona horaria, idempotencia, errores;
- producer y consumers;
- compatibility rules;
- revision y baseline artifact.

Un seam no debe convertirse en un documento enorme. Solo incluye lo que las
partes necesitan para trabajar sin coordinarse continuamente.

## ArtifactContract

Define nombre lógico, media type/kind, producer, consumer, contenido o paths
esperados, version/digest y forma de materialización. Un commit puede contener
varios artifacts; un artifact puede referenciar un subset explícito del commit.

## ValidationContract

Congela obligaciones:

- criterios obligatorios y severidad;
- capas de validación requeridas: static, unit, integration, e2e, security,
  accessibility o manual;
- política de baseline;
- evidencia aceptable;
- regresiones prohibidas;
- condiciones para `not_applicable`;
- tolerancia a flaky, normalmente cero para criterios obligatorios.

No congela necesariamente comandos exactos. `ValidationRecipeCompiler` resuelve
comandos y entornos con el repositorio vigente.

## Versionado y compatibilidad

Todo contrato tiene revisión. Cambiar firma o semántica incrementa revisión y
recalcula consumers. Cambios de copy o metadata sin efecto no invalidan inputs.

La compatibilidad se evalúa explícitamente:

- backward compatible: puede preservar consumers;
- requires regeneration: invalida consumers declarados;
- breaking/ambiguous: exige enmienda y posiblemente decisión.

## Contratos entre agentes y sistema

El prompt de un agente recibe una proyección del contrato, pero el contrato
persistido es canónico. La respuesta textual del agente no puede modificarlo. Un
descubrimiento se expresa como propuesta de enmienda.

## Validación de frontera

Se rechaza antes de ejecutar:

- criterio vacío o no demostrable;
- path inseguro o absoluto;
- producer/consumer inexistente;
- seam sin semántica suficiente para paralelizar;
- artifact requerido sin forma de materialización;
- commands no permitidos o entorno no declarado;
- revisiones inconsistentes.
