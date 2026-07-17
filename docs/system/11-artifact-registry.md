# Artifact Registry

## Propósito

Conectar resultados reales entre nodos sin convertir dependencies en simple
orden ni depender de commits implícitos.

## Artifact

```ts
type Artifact = {
  id: ArtifactId;
  type: string;
  producerNodeId: NodeId;
  producerAttemptId: AttemptId;
  commitSha: string;
  treeSha?: string;
  paths?: string[];
  digest: string;
  contractRevision: number;
  inputFingerprint: InputFingerprint;
  evidenceMatrixId: string;
  status: "candidate" | "verified" | "stale" | "rejected";
};
```

El registry almacena metadata/manifests. Git/filesystem siguen siendo storage de
contenido según tipo.

## Registro y adopción

Un artifact se registra candidate tras crear commit. Se vuelve verified solo si:

- attempt fingerprint sigue vigente;
- scope pasó;
- Evidence Matrix es elegible;
- commit/tree es alcanzable y reproducible;
- producer contract coincide.

Adoption produce evento. Nunca se deriva de exit code.

## Consumo

`ExecutionBaseBuilder` resuelve requirements por artifact type, producer y
revision. Registra exactamente qué digest consumió. No existe “usar el último”
sin revisión.

## Freshness

Un artifact queda stale cuando cambia cualquiera de sus inputs materiales:
graph/contract revision, required artifact digest, base commit, validation
contract o contexto que el compiler marque relevante.

Stale conserva evidencia histórica pero no es elegible para nuevas bases o
integración. Si un cambio es compatible, el amendment puede preservar freshness
con justificación calculada.

## Garbage collection

GC solo elimina contenido no referenciado por runs, snapshots, delivery receipts
o políticas de retención. Los manifests permanecen para auditabilidad aunque el
worktree desaparezca.
