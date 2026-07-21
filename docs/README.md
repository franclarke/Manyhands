# Documentación de ManyHands

## Estado y alcance

Esta carpeta describe la **implementación vigente** de ManyHands y la semántica
que debe preservar. La guía principal parte del objetivo del producto y recorre
componentes, datos, estrategias y garantías sin requerir conocimiento de
versiones o migraciones previas. Código, tests y journals son la evidencia de la
implementación concreta.

Cuando exista una diferencia entre estos documentos y la implementación, debe
registrarse como drift o brecha operativa. No se cambia una decisión normativa
para justificar silenciosamente un comportamiento accidental.

## Orden de autoridad

1. [`PRODUCT.md`](../PRODUCT.md): usuarios, propósito y principios de producto.
2. [`DECISIONS.md`](DECISIONS.md): decisiones arquitectónicas vigentes.
3. [`system/`](system/): contratos técnicos de punta a punta.
4. [`design/`](design/): experiencia, interacción y sistema visual.
5. [`adr/`](adr/): contexto, alternativas y consecuencias de las decisiones.
6. Código, tests y persistencia: evidencia del comportamiento implementado.

## Recorrido recomendado

| Necesidad | Documento |
|---|---|
| Entender el producto | [`PRODUCT.md`](../PRODUCT.md) |
| Entender el sistema completo | [`development/architecture.md`](development/architecture.md) |
| Entender cada estrategia y su evidencia | [`development/problem-solving-strategies.md`](development/problem-solving-strategies.md) |
| Entender el uso de librerías | [`development/library-usage.md`](development/library-usage.md) |
| Entender el flujo de un run | [`system/README.md`](system/README.md) |
| Entender el modelo del grafo | [`system/01-task-graph.md`](system/01-task-graph.md) |
| Entender dependencias y contratos | [`system/02-contracts.md`](system/02-contracts.md) |
| Entender ejecución e integración | [`system/04-run-executor.md`](system/04-run-executor.md) |
| Entender validación y entrega | [`system/08-result-pipeline.md`](system/08-result-pipeline.md) |
| Entender la experiencia del usuario | [`design/interaction-model.md`](design/interaction-model.md) |
| Entender el workspace centrado en el grafo | [`design/agent-first-redesign.md`](design/agent-first-redesign.md) |
| Preparar una demostración | [`design/golden-fixtures.md`](design/golden-fixtures.md) |

## Lenguaje normativo

- **Debe**: requisito de la arquitectura vigente.
- **Puede**: decisión local permitida sin alterar el contrato.
- **Actual**: comportamiento verificado en el código al momento de documentar.
- **Propuesto**: comportamiento todavía no incorporado a una decisión vigente.
- **Histórico**: material sin autoridad normativa.

Los nombres de frameworks, clases o paquetes no son decisiones arquitectónicas
salvo que el documento lo diga expresamente. React Flow, JSON o un executor CLI
son implementaciones actuales sin formar parte del contrato conceptual.
LangChain/LangGraph fueron removidos de las dependencias web: no tienen imports
productivos ni responsabilidad en la arquitectura actual.

## Material no normativo

- `docs/otras tesis/` contiene bibliografía y ejemplos externos.
- `docs/tesis/propuesta/` conserva una propuesta académica previa; su README
  aclara su relación con la arquitectura vigente.
- Los fixtures de `/proto` son demostraciones y regresiones del modelo de UI. No
  prueban por sí solos que el backend real implemente el comportamiento.
- `plans/`, `audits/` y `design/evolution-and-rationale.md` conservan contexto de
  implementación y evaluación. Son útiles para investigar historia, pero no son
  necesarios para comprender cómo funciona el sistema actual.

## Política de actualización

Un cambio arquitectónico debe actualizar, en la misma revisión:

1. la decisión en `DECISIONS.md`;
2. el contrato técnico afectado en `system/`;
3. la experiencia afectada en `design/`, si corresponde;
4. un ADR cuando cambien alternativas, trade-offs o límites relevantes;
5. un plan o ledger activo cuando el cambio requiera migración, compatibilidad o
   gates de rollout.

No se agregan bitácoras de implementación, auditorías temporales ni planes
cerrados a la documentación normativa. Esos artefactos deben vivir fuera del
recorrido principal y declarar fecha y estado.
