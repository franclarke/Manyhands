# SUBSISTEMA 01 — TASKGRAPH V3 Y ESQUEMAS DE CONTRATOS

> **Paquetes**: `packages/task-graph`, `packages/contracts`

---

## 1. ESQUEMA DE GRAFO INMUTABLE (`GraphRevision`)

`packages/task-graph` mantiene la estructura de datos del DAG jerárquico. Cada cambio genera una nueva revisión inmutable identificada por `revision`.

```typescript
export interface GraphRevision {
  schemaVersion: 2;
  graphId: string;
  revision: number;
  rootId: string;
  baseCommit: string;
  repositorySnapshotId: string;
  nodes: Record<string, TaskNodeV2>;
  artifactRequirements: ArtifactRequirementRelation[];
  seamBindings: SeamBindingRelation[];
  conflictConstraints: ConflictConstraintRelation[];
  legacyOrderingConstraints: LegacyOrderingConstraint[];
  createdAt: string;
}
```

---

## 2. RELACIONES CANÓNICAS Y REDUCTOR CAS (`packages/contracts/src/relations.ts`)

- **`parentId`**: Conexión de jerarquía estructural.
- **`ArtifactRequirement`**: Dependencia de datos y artefactos producidos.
- **`SeamBinding`**: Contrato de interfaz entre módulos.
- **`ConflictConstraint`**: Restricción de concurrencia y colisión.
- **Reductor CAS (`reduceGraphRevision`)**: Modifica el grafo de forma atómica aplicando Compare-and-Swap (`expectedRevision`) y `deepFreeze(next)`.
