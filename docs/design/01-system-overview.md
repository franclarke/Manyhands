# 01 — ARQUITECTURA GENERAL Y MODELO DE PRODUCTO DE MANYHANDS

Este documento establece la visión arquitectónica, el modelo de despliegue, la matriz de seguridad y los invariantes fundamentales del sistema **ManyHands**.

---

## 1. VISIÓN Y PROPÓSITO DEL PRODUCTO

ManyHands es un sistema de orquestación de agentes de código diseñado para transformar un objetivo de software (*Goal*) en un resultado verificado, integrado y entregado (*Delivered Result*).

```mermaid
flowchart LR
    Goal["Goal / User Intent"] --> Planner["Adaptive Decomposer (V3)"]
    Planner --> DAG["TaskGraph DAG (V3)"]
    DAG --> Scheduler["Continuous Event Scheduler"]
    Scheduler --> Workers["Agent Executors (Claude / Codex)"]
    Workers --> Isolation["Worktree Recycling Pool"]
    Isolation --> Validation["Evidence Matrix Engine"]
    Validation --> Integration["Bottom-Up Tree Integrator"]
    Integration --> MainBranch["Delivered Main Branch"]
```

---

## 2. MODELO DE DESPLIEGUE Y FRONTERAS DE CONFIANZA

### Modelo Target:
- **Despliegue**: Aplicación **local, single-user y self-hosted** ejecutada en `localhost` dentro de la máquina del usuario (Windows, Linux, macOS).
- **Límites de Producto**: **NO es un SaaS**, NO es multi-tenant, NO expone servicios a internet público.
- **Entorno de Trabajo**: Trabaja directamente sobre repositorios Git locales seleccionados por el usuario.

### Matriz de Confianza (*Trust Model*):

| Elemento | Nivel de Confianza | Tratamiento de Seguridad |
|---|---|---|
| Usuario Local | **Confiable** | Posee control total sobre la máquina e interfaz. |
| Repositorio Clonado | **No Confiable** | Puede contener hooks maliciosos, symlinks escapados o archivos corruptos. |
| Ejecutables CLI / LLM | **No Confiable** | Se invocan mediante argumentos saneados sin interpolación de shell. |
| Variables de Entorno | **No Confiable** | Se limpian credenciales sensibles via `buildAgentEnvironment()`. |
| Outputs de Agentes | **No Confiable** | Se validan estrictamente mediante la Matriz de Evidencias en worktrees aislados. |

---

## 3. INVARIANTES ARQUITECTÓNICOS CRÍTICOS

1. **Grafo Híbrido Estricto**: Raíz del objetivo, nodos composites en fronteras de integración y hojas cohesivas ejecutables.
2. **Relaciones Tipadas Canónicas**: Conexiones restringidas a `parentId`, `ArtifactRequirement`, `SeamBinding` y `ConflictConstraint`.
3. **Intentos Inmutables**: Identificados inequívocamente por un hash de entradas (`InputFingerprint`).
4. **Validación sobre Commits Exactos**: La Matriz de Evidencias se construye validando sobre el SHA exacto del candidato en aislamiento.
5. **UI Estática e Interactiva**: El canvas de la interfaz nunca se recentra ni cambia zoom automáticamente ante eventos (`fitView` prohibido). Las decisiones humanas no bloquean ramas independientes.
6. **Persistencia Atómica e Inmune a Crashes**: Almacenamiento en disco durable mediante escrituras atómicas, `fsync`, compactación por generaciones y SQLite WAL.
7. **Integración Bottom-Up**: La publicación de la rama principal requiere la validación completa del árbol en orden ascendente.

---

## 4. MAPA DE PAQUETES Y FRONT-END

```text
apps/web                               (Cockpit UI, SSE Replay, Decision Queue)
  ├── packages/orchestrator-graph      (Execution Driver V2, Event Dispatch)
  ├── packages/scheduler               (Continuous Event Scheduler, Conflict Constraints)
  ├── packages/decomposer              (Adaptive Granularity Engine V3)
  ├── packages/execution-core          (Worktree Pool, ScopeChecker, Process Registry)
  ├── packages/task-graph              (GraphRevision V3, Typed Relations, CAS Reducer)
  ├── packages/contracts               (Zod Contract Schemas)
  ├── packages/run-store               (Event Store, Compactor, Recovery Engine)
  ├── packages/trace-store             (Redacted Telemetry & Traces)
  ├── packages/repository-index        (Native Ripgrep Indexer, HEAD Snapshot Cache)
  └── packages/shared                  (Node CLI Process, Safe Git Args)
```

La dirección de dependencias es estrictamente **`apps -> specific packages -> shared`**. No se permiten importaciones cíclicas ni dependencias del núcleo hacia capas superiores.
