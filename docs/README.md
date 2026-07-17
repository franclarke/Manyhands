# Documentación de ManyHands

## Estado y alcance

Esta carpeta describe la **arquitectura objetivo** de ManyHands. Es la referencia
normativa para diseñar la transición del producto. No implica que el código
actual ya implemente todos los comportamientos descritos.

Cuando exista una diferencia entre estos documentos y la implementación, debe
registrarse como una brecha de transición. No se debe rebajar la arquitectura
objetivo para hacerla coincidir silenciosamente con el estado actual.

## Orden de autoridad

1. [`PRODUCT.md`](../PRODUCT.md): usuarios, propósito y principios de producto.
2. [`DECISIONS.md`](DECISIONS.md): decisiones arquitectónicas vigentes.
3. [`system/`](system/): contratos técnicos de punta a punta.
4. [`design/`](design/): experiencia, interacción y sistema visual.
5. [`adr/`](adr/): contexto, alternativas y consecuencias de las decisiones.
6. Código y tests: evidencia del estado de implementación, no definición del
   objetivo futuro.

## Recorrido recomendado

| Necesidad | Documento |
|---|---|
| Entender el producto | [`PRODUCT.md`](../PRODUCT.md) |
| Ver la arquitectura completa | [`development/architecture.md`](development/architecture.md) |
| Entender el flujo de un run | [`system/README.md`](system/README.md) |
| Entender el modelo del grafo | [`system/01-task-graph.md`](system/01-task-graph.md) |
| Entender dependencias y contratos | [`system/02-contracts.md`](system/02-contracts.md) |
| Entender ejecución e integración | [`system/04-run-executor.md`](system/04-run-executor.md) |
| Entender validación y entrega | [`system/08-result-pipeline.md`](system/08-result-pipeline.md) |
| Entender la experiencia del usuario | [`design/interaction-model.md`](design/interaction-model.md) |
| Entender el workspace centrado en el grafo | [`design/agent-first-redesign.md`](design/agent-first-redesign.md) |
| Preparar una demostración | [`design/golden-fixtures.md`](design/golden-fixtures.md) |
| Implementar la transición | [`plans/2026-07-17-target-architecture-transition.md`](plans/2026-07-17-target-architecture-transition.md) |
| Orquestar agentes de implementación | [`plans/2026-07-17-multi-agent-orchestration.md`](plans/2026-07-17-multi-agent-orchestration.md) |

## Lenguaje normativo

- **Debe**: requisito de la arquitectura objetivo.
- **Puede**: decisión local permitida sin alterar el contrato.
- **Actual**: comportamiento verificado en el código al momento de documentar.
- **Objetivo**: comportamiento que debe alcanzar la transición.
- **Histórico**: material sin autoridad normativa.

Los nombres de frameworks, clases o paquetes no son decisiones arquitectónicas
salvo que el documento lo diga expresamente. LangGraph, React Flow, JSON o un
executor CLI pueden ser implementaciones actuales sin formar parte del contrato
conceptual.

## Material no normativo

- `docs/otras tesis/` contiene bibliografía y ejemplos externos.
- `docs/tesis/propuesta/` conserva una propuesta académica previa; su README
  aclara su relación con la arquitectura objetivo.
- Los fixtures de `/proto` son demostraciones y regresiones del modelo de UI. No
  prueban por sí solos que el backend real implemente el comportamiento.

## Política de actualización

Un cambio arquitectónico debe actualizar, en la misma revisión:

1. la decisión en `DECISIONS.md`;
2. el contrato técnico afectado en `system/`;
3. la experiencia afectada en `design/`, si corresponde;
4. un ADR cuando cambien alternativas, trade-offs o límites relevantes;
5. el [plan de transición](plans/2026-07-17-target-architecture-transition.md) y
   su ledger operativo cuando el cambio modifique paquetes, orden o gates.

No se agregan bitácoras de implementación, auditorías temporales ni planes
cerrados a la documentación normativa. Esos artefactos deben vivir fuera del
recorrido principal y declarar fecha y estado.
