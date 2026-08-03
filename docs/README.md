# DOCUMENTACIÓN TÉCNICA DE MANYHANDS

Bienvenido al centro oficial de documentación de **ManyHands**, el sistema local y self-hosted de orquestación multiagente para desarrollo de software.

---

## 🌟 LOS 3 PILARES FUNDAMENTALES DEL SISTEMA

Muchos componentes del sistema existen para dar soporte a la arquitectura, pero el núcleo estratégico de ManyHands descansa sobre **3 pilares principales**:

| Pilar | Documento de Arquitectura | Descripción |
|---|---|---|
| 🧠 **Pilar 1: Planning semántico** | 📄 **[03-decomposer.md](system/03-decomposer.md)** | `PlanningModule` durable: propuestas semánticas no confiables, canonicalización determinista, comparación por estrategia, selección de `ExecutionCut` y compilación de contratos/grafo. El documento V3 anterior queda como referencia histórica. |
| ⚡ **Pilar 2: La Ejecución** | 📄 **[02-execution-and-orchestration.md](core-pillars/02-execution-and-orchestration.md)** | Despacho continuo por eventos, scheduler determinista, `V2ExecutionDriver` con `recordQueue` atómico, pool de reciclaje de worktrees y sandboxing de seguridad. |
| 🛡️ **Pilar 3: La Integración** | 📄 **[03-integration-and-evidence.md](core-pillars/03-integration-and-evidence.md)** | Construcción de la Matriz de Evidencias sobre commits exactos, materialización bottom-up del árbol e integración final verificada en la rama entregada. |

---

## ⚙️ SUBSISTEMAS TÉCNICOS Y ESPECIFICACIONES

| Subsistema | Especificación Técnica | Descripción |
|---|---|---|
| 📐 **TaskGraph & Contratos** | 📄 **[01-task-graph-and-contracts.md](system/01-task-graph-and-contracts.md)** | Grafo jerárquico V3, relaciones canónicas tipadas, reductor Compare-and-Swap e inmutabilidad profunda (`deepFreeze`). |
| 💾 **Persistencia y Durabilidad** | 📄 **[02-persistence-and-durability.md](system/02-persistence-and-durability.md)** | Escrituras atómicas con `fsync`, log $O(1)$, compactación por generaciones, SQLite WAL mode y recuperador de fallos de energía. |
| 🚀 **Indexación Monorepo** | 📄 **[03-monorepo-grounding.md](system/03-monorepo-grounding.md)** | Indexación nativa con `ripgrep` (`rg --files`), caché incremental por Git HEAD SHA y extractor de firmas de exportación. |
| 🖥️ **Cockpit UI & Interacción** | 📄 **[04-cockpit-ui-and-interaction.md](system/04-cockpit-ui-and-interaction.md)** | Modelo visual del Cockpit (`apps/web`), medallas de ciclo de vida de nodos, cola de decisiones non-blocking y prohibición de `fitView`. |

---

## 📜 REGISTRO DE DECISIONES Y PLANIFICACIÓN

- **Decisiones de Arquitectura**: `docs/DECISIONS.md` y carpeta `docs/adr/`.
- **Auditoría de Producción y Backlog**: `docs/audits/production-readiness/planning/remediation-backlog.json`.
- **Prompts Autónomos de Ejecución**: `docs/prompts/`.

---

## PRINCIPIOS DE AUTORIDAD DE DOCUMENTACIÓN

1. **`PRODUCT.md`**: Usuarios y principios del producto.
2. **`docs/DECISIONS.md`**: Decisiones de arquitectura target.
3. **`docs/core-pillars/`**: Los 3 pilares estructurales del producto.
4. **`docs/system/`**: Esquemas y especificaciones técnicas de subsistemas.
