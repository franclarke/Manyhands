import {
  ArtifactRequirementSchema,
  CanonicalContractRefSchema,
  RepositoryViewRefSchema,
  ResourceClaimSchema,
  RuntimeLeaseClaimSchema,
  SeamBindingSchema,
  canonicalJson,
  computeCanonicalDigest,
  verifyCanonicalDigest,
  type ArtifactRequirement,
  type ResourceClaim,
  type DigestHasher
} from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const TaskNodeSchema = z.object({
  id: EntityIdSchema,
  parentId: EntityIdSchema.nullable(),
  kind: z.enum(["root", "composite", "leaf", "integrator"]),
  title: NonEmptyStringSchema,
  goal: NonEmptyStringSchema,
  contractRef: CanonicalContractRefSchema
}).strict();
export type TaskNode = z.infer<typeof TaskNodeSchema>;
/** Explicit export avoids collision with the historical mutable TaskNode type. */
export type CanonicalTaskNode = TaskNode;

const SemanticPlanRefSchema = z.object({
  id: EntityIdSchema,
  revision: z.number().int().positive(),
  digest: NonEmptyStringSchema
}).strict();

export const GraphRevisionMaterialSchema = z.object({
  graphId: EntityIdSchema,
  revision: z.number().int().positive(),
  semanticPlan: SemanticPlanRefSchema,
  repositoryView: RepositoryViewRefSchema,
  rootId: EntityIdSchema,
  nodes: z.record(TaskNodeSchema),
  artifactRequirements: z.array(ArtifactRequirementSchema),
  seamBindings: z.array(SeamBindingSchema),
  resourceClaims: z.array(ResourceClaimSchema),
  runtimeLeaseClaims: z.array(RuntimeLeaseClaimSchema),
  contractRefs: z.array(CanonicalContractRefSchema)
}).strict();
export type GraphRevisionMaterial = z.infer<typeof GraphRevisionMaterialSchema>;

export const GraphRevisionSchema = GraphRevisionMaterialSchema.extend({ digest: NonEmptyStringSchema }).strict();
export type GraphRevision = z.infer<typeof GraphRevisionSchema>;

export type ResourceOverlap = "yes" | "no" | "unknown";
export interface ResourceOverlapQuery {
  overlap(leftResourceId: string, rightResourceId: string): ResourceOverlap;
}

export type GraphRevisionFindingCode =
  | "schema_invalid" | "digest_mismatch" | "missing_root" | "invalid_root"
  | "node_key_mismatch" | "missing_parent" | "hierarchy_cycle"
  | "missing_relation_node" | "missing_contract_ref" | "duplicate_relation"
  | "artifact_unreachable" | "artifact_cycle" | "resource_double_writer"
  | "resource_overlap_unknown" | "invalid_version_chain" | "missing_seam_artifact"
  | "missing_seam_obligation" | "nonconsecutive_revision" | "content_identity_unchanged";

export interface GraphRevisionFinding {
  code: GraphRevisionFindingCode;
  severity: "error";
  message: string;
  nodeId?: string;
  relationId?: string;
}

export interface ArtifactReachabilityQuery {
  canMaterialize(requirement: ArtifactRequirement): boolean;
}

export interface ValidateGraphRevisionOptions {
  hasher?: DigestHasher;
  resourceOverlap?: ResourceOverlapQuery;
  artifactReachability?: ArtifactReachabilityQuery;
}

export function buildGraphRevision(input: GraphRevisionMaterial, hasher: DigestHasher): GraphRevision {
  const material = normalizeGraphRevisionMaterial(GraphRevisionMaterialSchema.parse(input));
  return { ...material, digest: computeCanonicalDigest(material, hasher) };
}

function normalizeGraphRevisionMaterial(material: GraphRevisionMaterial): GraphRevisionMaterial {
  const artifactRequirements = normalizeRelations(
    material.artifactRequirements,
    "artifactRequirements",
    (requirement) => ({
      ...requirement,
      acceptedManifestKinds: sortedUnique(requirement.acceptedManifestKinds)
    })
  );
  const seamBindings = normalizeRelations(
    material.seamBindings,
    "seamBindings",
    (binding) => ({
      ...binding,
      validationObligationIds: sortedUnique(binding.validationObligationIds)
    })
  );
  const resourceClaims = normalizeRelations(
    material.resourceClaims,
    "resourceClaims",
    (claim): ResourceClaim => ({
      ...claim,
      evidenceRefs: sortedUnique(claim.evidenceRefs),
      epistemic: claim.epistemic.state === "unknown"
        ? claim.epistemic
        : { ...claim.epistemic, evidenceRefs: sortedUnique(claim.epistemic.evidenceRefs) }
    })
  );
  const runtimeLeaseClaims = normalizeRelations(
    material.runtimeLeaseClaims,
    "runtimeLeaseClaims",
    (claim) => claim
  );

  assertRelationIdsAreGloballyUnique([
    ["artifactRequirements", artifactRequirements],
    ["seamBindings", seamBindings],
    ["resourceClaims", resourceClaims],
    ["runtimeLeaseClaims", runtimeLeaseClaims]
  ]);

  return {
    ...material,
    artifactRequirements,
    seamBindings,
    resourceClaims,
    runtimeLeaseClaims,
    contractRefs: normalizeContractRefs(material.contractRefs)
  };
}

function normalizeRelations<T extends { id: string }>(
  relations: readonly T[],
  collection: string,
  normalize: (relation: T) => T
): T[] {
  const byId = new Map<string, T>();
  for (const relation of relations) {
    const normalized = normalize(relation);
    const existing = byId.get(normalized.id);
    if (existing && canonicalJson(existing) !== canonicalJson(normalized)) {
      throw new Error(`Conflicting ${collection} id ${normalized.id}.`);
    }
    if (!existing) byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((left, right) => compareCanonicalString(left.id, right.id));
}

function normalizeContractRefs(refs: GraphRevisionMaterial["contractRefs"]): GraphRevisionMaterial["contractRefs"] {
  const byIdentity = new Map<string, GraphRevisionMaterial["contractRefs"][number]>();
  for (const ref of refs) byIdentity.set(refKey(ref), ref);
  return [...byIdentity.values()].sort((left, right) => compareCanonicalString(refKey(left), refKey(right)));
}

function assertRelationIdsAreGloballyUnique(
  collections: ReadonlyArray<readonly [string, ReadonlyArray<{ id: string }>]>
): void {
  const owners = new Map<string, string>();
  for (const [collection, relations] of collections) {
    for (const relation of relations) {
      const owner = owners.get(relation.id);
      if (owner) throw new Error(`Conflicting relation id ${relation.id} appears in ${owner} and ${collection}.`);
      owners.set(relation.id, collection);
    }
  }
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareCanonicalString);
}

function compareCanonicalString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateGraphRevision(input: unknown, options: ValidateGraphRevisionOptions = {}): GraphRevisionFinding[] {
  const parsed = GraphRevisionSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => finding("schema_invalid", `${issue.path.join(".")}: ${issue.message}`));
  const graph = parsed.data;
  const findings: GraphRevisionFinding[] = [];
  if (options.hasher && !verifyCanonicalDigest(graph, "digest", options.hasher)) findings.push(finding("digest_mismatch", "Graph digest does not identify its canonical content."));
  validateHierarchy(graph, findings);
  validateReferences(graph, findings);
  validateArtifactFlow(graph, options.artifactReachability, findings);
  validateOwnership(graph, options.resourceOverlap, findings);
  validateVersionChains(graph, options.resourceOverlap, findings);
  validateSeams(graph, findings);
  return findings;
}

export function validateGraphRevisionTransition(previous: GraphRevision, next: GraphRevision): GraphRevisionFinding[] {
  const findings: GraphRevisionFinding[] = [];
  if (next.graphId !== previous.graphId || next.revision !== previous.revision + 1) findings.push(finding("nonconsecutive_revision", "A revision transition must preserve graphId and increment revision by one."));
  if (next.digest === previous.digest) findings.push(finding("content_identity_unchanged", "A new revision must identify different canonical content."));
  return findings;
}

function validateHierarchy(graph: GraphRevision, out: GraphRevisionFinding[]): void {
  const root = graph.nodes[graph.rootId];
  if (!root) out.push(finding("missing_root", `Root ${graph.rootId} does not exist.`, graph.rootId));
  else if (root.parentId !== null || (root.kind !== "root" && root.kind !== "composite" && Object.keys(graph.nodes).length > 1)) out.push(finding("invalid_root", "Root must be parentless and own the graph hierarchy.", root.id));
  for (const [key, node] of Object.entries(graph.nodes)) {
    if (key !== node.id) out.push(finding("node_key_mismatch", `Node key ${key} differs from id ${node.id}.`, node.id));
    if (node.id !== graph.rootId && (node.parentId === null || !graph.nodes[node.parentId])) out.push(finding("missing_parent", `Node ${node.id} has no valid parent.`, node.id));
  }
  detectCycle(Object.keys(graph.nodes), (id) => graph.nodes[id]?.parentId ? [graph.nodes[id]!.parentId!] : [], () => out.push(finding("hierarchy_cycle", "Hierarchy contains a cycle.")));
}

function validateReferences(graph: GraphRevision, out: GraphRevisionFinding[]): void {
  const refs = new Set(graph.contractRefs.map(refKey));
  for (const node of Object.values(graph.nodes)) if (!refs.has(refKey(node.contractRef))) out.push(finding("missing_contract_ref", `Node ${node.id} references an undeclared contract.`, node.id));
  for (const requirement of graph.artifactRequirements) if (!refs.has(refKey(requirement.artifactContract))) out.push(finding("missing_contract_ref", `Artifact requirement ${requirement.id} references an undeclared contract.`, undefined, requirement.id));
  for (const seam of graph.seamBindings) if (!refs.has(refKey(seam.seamContract))) out.push(finding("missing_contract_ref", `Seam ${seam.id} references an undeclared contract.`, undefined, seam.id));
  for (const claim of graph.resourceClaims) {
    if (claim.access === "modify" && !refs.has(refKey(claim.outputArtifact))) out.push(finding("missing_contract_ref", `Resource claim ${claim.id} references an undeclared output contract.`, claim.nodeId, claim.id));
    if (claim.inputVersion.kind === "artifact_contract" && !refs.has(refKey(claim.inputVersion.ref))) out.push(finding("missing_contract_ref", `Resource claim ${claim.id} references an undeclared input contract.`, claim.nodeId, claim.id));
  }
  const ids = new Set<string>();
  for (const relation of [...graph.artifactRequirements, ...graph.seamBindings, ...graph.resourceClaims, ...graph.runtimeLeaseClaims]) {
    if (ids.has(relation.id)) out.push(finding("duplicate_relation", `Relation id ${relation.id} is duplicated.`, undefined, relation.id));
    ids.add(relation.id);
    const nodeIds = "producerNodeId" in relation ? [relation.producerNodeId, relation.consumerNodeId] : [relation.nodeId];
    for (const id of nodeIds) if (!graph.nodes[id]) out.push(finding("missing_relation_node", `Relation ${relation.id} references missing node ${id}.`, id, relation.id));
  }
}

function validateArtifactFlow(graph: GraphRevision, reachability: ArtifactReachabilityQuery | undefined, out: GraphRevisionFinding[]): void {
  const produced = new Map(graph.resourceClaims.filter((claim): claim is Extract<ResourceClaim, { access: "modify" }> => claim.access === "modify").map((claim) => [refKey(claim.outputArtifact), claim.nodeId]));
  for (const req of graph.artifactRequirements) {
    const producer = produced.get(refKey(req.artifactContract));
    if (producer !== req.producerNodeId || (reachability && !reachability.canMaterialize(req))) out.push(finding("artifact_unreachable", `Artifact ${req.id} is not materializable from its declared producer.`, req.producerNodeId, req.id));
  }
  detectCycle(Object.keys(graph.nodes), (id) => graph.artifactRequirements.filter((r) => r.producerNodeId === id).map((r) => r.consumerNodeId), () => out.push(finding("artifact_cycle", "Artifact dataflow contains a cycle.")));
}

function validateOwnership(graph: GraphRevision, overlap: ResourceOverlapQuery | undefined, out: GraphRevisionFinding[]): void {
  const claims = graph.resourceClaims;
  for (let i = 0; i < claims.length; i++) for (let j = i + 1; j < claims.length; j++) {
    const left = claims[i]!, right = claims[j]!;
    if (left.access !== "modify" && right.access !== "modify") continue;
    const state = overlap?.overlap(left.resourceId, right.resourceId) ?? (left.resourceId === right.resourceId ? "yes" : "unknown");
    if (state === "no") continue;
    if (state === "unknown") {
      out.push(finding("resource_overlap_unknown", `Claims ${left.id} and ${right.id} include a writer and are not proven disjoint.`));
      continue;
    }
    if (left.access === "modify" && right.access === "modify" && !orderedByArtifact(graph, left, right)) out.push(finding("resource_double_writer", `Writers ${left.nodeId} and ${right.nodeId} are not version-ordered.`));
  }
}

function validateVersionChains(graph: GraphRevision, overlap: ResourceOverlapQuery | undefined, out: GraphRevisionFinding[]): void {
  const writes = graph.resourceClaims.filter((claim): claim is Extract<ResourceClaim, { access: "modify" }> => claim.access === "modify");
  for (const successor of writes) for (const predecessor of writes) {
    if (successor.id === predecessor.id) continue;
    const state = overlap?.overlap(successor.resourceId, predecessor.resourceId) ?? (successor.resourceId === predecessor.resourceId ? "yes" : "no");
    if (state !== "yes" || successor.inputVersion.kind !== "artifact_contract" || refKey(successor.inputVersion.ref) !== refKey(predecessor.outputArtifact)) continue;
    if (!orderedByArtifact(graph, predecessor, successor)) out.push(finding("invalid_version_chain", `Writer ${successor.nodeId} consumes ${predecessor.outputArtifact.id} without a matching ArtifactRequirement.`, successor.nodeId));
  }
}

function validateSeams(graph: GraphRevision, out: GraphRevisionFinding[]): void {
  const requirements = new Map(graph.artifactRequirements.map((r) => [r.id, r]));
  const refs = new Set(graph.contractRefs.map(refKey));
  for (const seam of graph.seamBindings) {
    const req = requirements.get(seam.artifactRequirementId);
    if (!req || req.producerNodeId !== seam.producerNodeId || req.consumerNodeId !== seam.consumerNodeId) out.push(finding("missing_seam_artifact", `Seam ${seam.id} has no matching artifact requirement.`, undefined, seam.id));
    for (const id of seam.validationObligationIds) if (![...refs].some((key) => key.startsWith(`${id}:`))) out.push(finding("missing_seam_obligation", `Seam ${seam.id} references undeclared validation obligation ${id}.`, undefined, seam.id));
  }
}

/**
 * Whether two writers of one resource can never run at the same time.
 *
 * The walk is transitive, which is both the correct reading and the one the
 * plan verifier already applies: if B consumes A's artifact and C consumes B's,
 * then C runs after B runs after A and no two of them write concurrently. This
 * used to look for a single direct requirement between exactly those two nodes,
 * so a graph with N writers of one resource — which is every graph whose units
 * create new files in the same package — needed a requirement between all N
 * pairs. A five-unit plan was rejected for six pairs it had ordered through a
 * chain.
 */
function orderedByArtifact(graph: GraphRevision, first: Extract<ResourceClaim, { access: "modify" }>, second: Extract<ResourceClaim, { access: "modify" }>): boolean {
  return versionReachable(graph, first, second) || versionReachable(graph, second, first);
}

function versionReachable(graph: GraphRevision, from: Extract<ResourceClaim, { access: "modify" }>, target: Extract<ResourceClaim, { access: "modify" }>): boolean {
  const writers = graph.resourceClaims.filter((claim): claim is Extract<ResourceClaim, { access: "modify" }> => claim.access === "modify");
  const pending = [from];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.id === target.id) return true;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    for (const next of writers) {
      if (next.inputVersion.kind !== "artifact_contract" || refKey(next.inputVersion.ref) !== refKey(current.outputArtifact)) continue;
      // The consumption has to be declared as a relation, not merely implied by
      // a matching reference, or the order would rest on a coincidence of ids.
      if (graph.artifactRequirements.some((req) => req.producerNodeId === current.nodeId && req.consumerNodeId === next.nodeId && refKey(req.artifactContract) === refKey(current.outputArtifact))) {
        pending.push(next);
      }
    }
  }
  return false;
}

function detectCycle(ids: string[], next: (id: string) => string[], onCycle: () => void): void {
  const active = new Set<string>(), done = new Set<string>(); let reported = false;
  const visit = (id: string): void => { if (active.has(id)) { if (!reported) onCycle(); reported = true; return; } if (done.has(id)) return; active.add(id); for (const target of next(id)) visit(target); active.delete(id); done.add(id); };
  for (const id of ids) visit(id);
}

function refKey(ref: { id: string; revision: number; digest: string }): string { return `${ref.id}:${ref.revision}:${ref.digest}`; }
function finding(code: GraphRevisionFindingCode, message: string, nodeId?: string, relationId?: string): GraphRevisionFinding { return { code, severity: "error", message, ...(nodeId ? { nodeId } : {}), ...(relationId ? { relationId } : {}) }; }
