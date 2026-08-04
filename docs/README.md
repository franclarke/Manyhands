# DOCUMENTACIÓN TÉCNICA DE MANYHANDS

Bienvenido al centro oficial de documentación de **ManyHands**, el sistema local y self-hosted de orquestación multiagente para desarrollo de software.

---

## 🌟 LOS 3 PILARES FUNDAMENTALES DEL SISTEMA

Muchos componentes del sistema existen para dar soporte a la arquitectura, pero el núcleo estratégico de ManyHands descansa sobre **3 pilares principales**:

| Pilar | Documento de Arquitectura | Descripción |
|---|---|---|
| 🧠 **Pilar 1: El Decomposer** | 📄 **[01-decomposer-engine.md](core-pillars/01-decomposer-engine.md)** | Motor de granularidad adaptativa (V3). Evalúa el índice de complejidad intrínseca ($C_{task}$), ejecuta la división en 2 fases (*Architect Pass + Compiler*) y optimiza sub-tareas mediante critics de coalescencia. |
| ⚡ **Pilar 2: La Ejecución** | 📄 **[02-execution-and-orchestration.md](core-pillars/02-execution-and-orchestration.md)** | Despacho continuo por eventos, scheduler determinista, `V2ExecutionDriver` con `recordQueue` atómico, pool de reciclaje de worktrees y sandboxing de seguridad. |
| 🛡️ **Pilar 3: La Integración** | 📄 **[03-integration-and-evidence.md](core-pillars/03-integration-and-evidence.md)** | Construcción de la Matriz de Evidencias sobre commits exactos, materialización bottom-up del árbol e integración final verificada en la rama entregada. |

---

## ⚙️ SUBSISTEMAS TÉCNICOS Y ESPECIFICACIONES

| Subsistema | Especificación Técnica | Descripción |
|---|---|---|
| 📐 **TaskGraph & Contratos** | 📄 **[01-task-graph.md](system/01-task-graph.md)** | Grafo jerárquico, relaciones canónicas tipadas, reductor Compare-and-Swap e inmutabilidad profunda (`deepFreeze`). |
| 💾 **Persistencia y Durabilidad** | 📄 **[02-persistence-and-durability.md](system/02-persistence-and-durability.md)** | Contratos de persistencia, eventos, snapshots, trazas y límites de recuperación documentados para la transición actual. |
| 🚀 **Indexación Monorepo** | 📄 **[03-monorepo-grounding.md](system/03-monorepo-grounding.md)** | Indexación nativa con `ripgrep` (`rg --files`), caché incremental por Git HEAD SHA y extractor de firmas de exportación. |
| 🖥️ **Cockpit UI & Interacción** | 📄 **[04-cockpit-ui-and-interaction.md](system/04-cockpit-ui-and-interaction.md)** | Modelo visual del Cockpit (`apps/web`), medallas de ciclo de vida de nodos, cola de decisiones non-blocking y prohibición de `fitView`. |

---

## 📜 REGISTRO DE DECISIONES Y PLANIFICACIÓN

- **Decisiones de Arquitectura**: `docs/DECISIONS.md` y carpeta `docs/adr/`.
- **Estado de cierre de tesis**: [`docs/tesis/evidence/g6/FINAL-REPORT.md`](tesis/evidence/g6/FINAL-REPORT.md) y [`docs/tesis/HANDOFF.md`](tesis/HANDOFF.md).
- **Próxima validación semántica**: diseño futuro documentado en [`docs/tesis/evidence/semantic-planning/next-run.md`](tesis/evidence/semantic-planning/next-run.md); todavía no ejecutado.

---

## PRINCIPIOS DE AUTORIDAD DE DOCUMENTACIÓN

1. **`PRODUCT.md`**: Usuarios y principios del producto.
2. **`docs/DECISIONS.md`**: Decisiones de arquitectura target.
3. **`docs/core-pillars/`**: Los 3 pilares estructurales del producto.
4. **`docs/system/`**: Esquemas y especificaciones técnicas de subsistemas.
