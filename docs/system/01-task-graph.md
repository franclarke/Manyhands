# TaskGraph objetivo

## Responsabilidad

Representar ownership de integración y las relaciones necesarias para ejecutar
software. No representa el control flow interno del orquestador.

## Forma

```ts
type TaskGraph = {
  rootId: NodeId;
  nodes: Record<NodeId, TaskNode>;
  artifactRequirements: ArtifactRequirement[];
  seamBindings: SeamBinding[];
  conflictConstraints: ConflictConstraint[];
  revision: number;
};

type TaskNode = {
  id: NodeId;
  parentId?: NodeId;
  role: "root" | "composite" | "leaf";
  goal: string;
  boundary?: {
    kind: "application" | "package" | "module" | "domain" | "vertical_slice";
    ref?: string;
  };
  contractId: ContractId;
};
```

`parentId` es canónico; children y profundidad se derivan. Solo las hojas se
envían a coding agents. Root y composites se materializan por integración.

## Relaciones

### Ownership

El parent responde por integrar y validar sus hijos. Cada nodo, salvo root, tiene
un único parent. Esto forma un árbol jerárquico aun cuando requirements y seams
formen un DAG entre hojas.

### ArtifactRequirement

```ts
type ArtifactRequirement = {
  consumerNodeId: NodeId;
  artifactType: string;
  producerNodeId: NodeId;
  requiredRevision: string;
};
```

Impone readiness y materialización. Si el output no existe, el consumer no puede
crear una base válida.

### SeamBinding

Declara compatibilidad entre producer y consumers contra un contrato versionado.
Permite paralelismo cuando todos trabajan sobre el mismo baseline. No impone
orden por sí mismo.

### ConflictConstraint

Declara overlap o recurso exclusivo. Influye en scheduling y puede serializar
intentos, pero no materializa outputs.

## Criterios de una hoja

Una hoja debe tener objetivo observable, scope acotado, output identificable,
criterios demostrables y contexto suficiente. Puede tocar varias capas si forma
un incremento vertical cohesivo.

Debe descomponerse si mezcla outputs sin relación, requiere decisiones internas
independientes, no puede validarse sin trabajo futuro ambiguo o su blast radius
impide descartarla de forma local.

## Validez

Un graph revision es ejecutable solo si:

- existe exactamente una raíz;
- todos los nodos son alcanzables por parentage;
- no hay ciclos de ArtifactRequirement;
- producers y consumers existen;
- revisions y contratos referenciados existen;
- todo leaf tiene contrato ejecutable;
- todo composite tiene criterios de integración;
- ningún output obligatorio carece de producer;
- todo criterio obligatorio tiene estrategia de evidencia;
- la revisión aprobada coincide con la que se despacha.

## Enmiendas

Una enmienda nunca muta la revisión aprobada. Produce otra revisión con reason,
evidence, projected impact y preserved work. La aprobación usa CAS sobre la
revisión esperada.

Los intentos activos pueden terminar, pero su resultado solo se adopta si el
fingerprint sigue vigente. El coordinator puede cancelarlos para ahorrar costo;
la corrección no depende de lograr cancelación instantánea.
