# DOCUMENTACIÓN DE DISEÑO Y ARQUITECTURA DE MANYHANDS

Este directorio contiene la especificación de diseño canónica y actualizada para el sistema de orquestación multiagente **ManyHands**.

---

## ESTRUCTURA DE LA DOCUMENTACIÓN

| Documento | Título / Tema | Descripción |
|---|---|---|
| 📄 **[01-system-overview.md](01-system-overview.md)** | General Architecture & Product Model | Visión general del sistema, modelo local/single-user, matriz de confianza e invariantes. |
| 📄 **[02-task-graph-and-contracts.md](02-task-graph-and-contracts.md)** | TaskGraph V3 & Canonical Relations | Modelo de grafo jerárquico, relaciones tipadas (`parentId`, `ArtifactRequirement`, `SeamBinding`, `ConflictConstraint`), reductor CAS e inmutabilidad profunda. |
| 📄 **[04-orchestration-and-scheduler.md](04-orchestration-and-scheduler.md)** | Event-Driven Scheduler & Execution Driver | Scheduler continuo por eventos, deferral de `ConflictConstraints`, `V2ExecutionDriver` y `recordQueue` atómico. |
| 📄 **[05-execution-core-and-sandboxing.md](05-execution-core-and-sandboxing.md)** | Worktree Pool & Host Security | Pool de reciclaje de worktrees (`git reset --hard`), guard de traversal OS-aware (`ScopeChecker`), supervisión de procesos (`LiveProcessRegistry`) y saneamiento de entorno. |
| 📄 **[06-persistence-durability-recovery.md](06-persistence-durability-recovery.md)** | Persistence, Durability & Recovery | Motor de escrituras atómicas con `fsync`, writer $O(1)$, compactación por generaciones, SQLite WAL y recuperador ante fallos de energía. |
| 📄 **[07-monorepo-grounding.md](07-monorepo-grounding.md)** | High-Performance Ripgrep Monorepo Indexing | Indexación nativa con `rg --files`, caché incremental por Git HEAD SHA y extractor de firmas de exportación. |
| 📄 **[08-cockpit-ui-interaction-model.md](08-cockpit-ui-interaction-model.md)** | Cockpit Visual UI & Decision Queue | Modelo de presentación del Cockpit web (`apps/web`), 5 estados de ciclo de vida de nodos, cola de decisiones non-blocking (`<DecisionQueueDrawer />`), visor de diffs e inspectores de seams. |

---

## PRINCIPIOS DE AUTORIDAD DE DOCUMENTACIÓN

1. **`PRODUCT.md`**: Definición de usuarios y principios de producto.
2. **`docs/DECISIONS.md`**: Decisiones de arquitectura target.
3. **`docs/design/`**: Especificación técnica de componentes y comportamiento de usuario.
4. **`docs/system/`**: Contratos técnicos de la API y esquemas de datos.

Toda implementación en el repositorio debe ser consistente con la especificación de estos documentos.

## Política de granularidad

- [`granularity-policy-redesign.md`](granularity-policy-redesign.md) — qué se
  conserva de la política actual, qué se reemplaza y por qué; la dirección de
  costo esperado en unidades reales.
- [`granularity-experiment.md`](granularity-experiment.md) — cómo evaluarla:
  ablación offline sobre el banco, y comparación A/C sobre un target donde el
  trabajo no entre en un intento.
- [`longitudinal-demonstration.md`](longitudinal-demonstration.md) — el plan de
  trabajo: qué construir, en cuántas iteraciones, con qué oráculo y qué se mide
  en cada una.
