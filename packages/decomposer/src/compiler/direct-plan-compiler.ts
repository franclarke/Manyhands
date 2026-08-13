import {
  TaskContractBundleSchema,
  computeCanonicalDigest,
  type ArtifactContract,
  type CanonicalContractRef,
  type CanonicalValidationObligation,
  type DigestHasher,
  type GoalContract,
  type PlanningFinding,
  type ProofStrategy,
  type ScopeContract,
  type SeamContract,
  type SemanticPlan,
  type TaskContract,
  type TaskContractBundle,
  type ValidationContract,
  type WorkUnit
} from "@manyhands/contracts";
import type { RepositoryView } from "@manyhands/repository-index";
import {
  buildGraphRevision,
  validateGraphRevision,
  type GraphRevision,
  type GraphRevisionMaterial
} from "@manyhands/task-graph";
import { verifyPlan } from "./plan-verifier.js";

export type PlanIdentityFactory = (kind: string, parts: readonly string[]) => string;

export interface CompilePlanInput {
  plan: SemanticPlan;
  goal: GoalContract;
  proofStrategies: readonly ProofStrategy[];
  repositoryView: RepositoryView;
  hasher: DigestHasher;
  idFactory: PlanIdentityFactory;
}

export interface CompiledIntegrationContract {
  id: string;
  revision: number;
  obligationId: string;
  ownerUnitId: string;
  objective: string;
  criterionIds: string[];
  proofStrategyId: string;
  artifactIds: string[];
  seamIds: string[];
}

export interface CompiledPlanContracts {
  taskBundles: Record<string, TaskContractBundle>;
  artifacts: Record<string, ArtifactContract>;
  seams: Record<string, SeamContract>;
  integrations: Record<string, CompiledIntegrationContract>;
  validationObligations: Record<string, CanonicalValidationObligation>;
  proofStrategies: Record<string, ProofStrategy>;
  refs: CanonicalContractRef[];
}

export type CompilePlanResult =
  | { ok: true; graph: GraphRevision; contracts: CompiledPlanContracts }
  | { ok: false; findings: PlanningFinding[] };

export function compilePlan(input: CompilePlanInput): CompilePlanResult {
  const verified = verifyPlan(input);
  if (!verified.ok) return { ok: false, findings: verified.findings };

  try {
    return compileVerifiedPlan(input);
  } catch (error: unknown) {
    return {
      ok: false,
      findings: [compilerFinding(error)]
    };
  }
}

function compileVerifiedPlan(input: CompilePlanInput): CompilePlanResult {
  const revision = String(input.plan.revision);
  const artifacts = compileArtifacts(input.plan, revision);
  const seams = compileSeams(input.plan, revision);
  const taskBundles: Record<string, TaskContractBundle> = {};
  const refs: CanonicalContractRef[] = [];
  const referencedProofIds = new Set(Object.values(input.plan.units).flatMap((unit) => [
    ...unit.validation.map(({ proofStrategyId }) => proofStrategyId),
    ...(unit.integration === undefined ? [] : [unit.integration.proofStrategyId])
  ]));
  const proofStrategies = sortedRecord(Object.fromEntries(input.proofStrategies
    .filter(({ id }) => referencedProofIds.has(id))
    .map((proof) => [proof.id, proof])));
  const proofRefs = new Map(Object.values(proofStrategies).map((proof) => [
    proof.id,
    { id: proof.id, revision: proof.revision, digest: proof.digest }
  ]));
  const validationObligations: Record<string, CanonicalValidationObligation> = {};
  for (const unit of Object.values(input.plan.units)) {
    const scope = compileScope(input, unit, revision);
    const validation = compileValidation(unit, revision);
    const task = compileTask(input, unit, scope, validation, artifacts, seams, revision);
    const bundleArtifacts = unique(unit.consumes.concat(unit.produces)).map((id) => artifacts[id]!);
    const bundleSeams = unit.seamRefs
      .map((id) => seams[id]!)
      .filter((seam) => seam.producerNodeId === unit.id || seam.consumerNodeIds.includes(unit.id));
    taskBundles[unit.id] = TaskContractBundleSchema.parse({
      schemaVersion: 2,
      task,
      scope,
      seams: bundleSeams,
      artifacts: bundleArtifacts,
      validation
    });
    refs.push(refFor(task, input.plan.revision, input.hasher));
    refs.push(refFor(scope, input.plan.revision, input.hasher));
    refs.push(refFor(validation, input.plan.revision, input.hasher));
    for (const obligation of unit.validation) {
      const proofRef = proofRefs.get(obligation.proofStrategyId)!;
      const material = {
        id: obligation.obligationId,
        revision: input.plan.revision,
        criterionId: obligation.criterionId,
        ownerNodeId: unit.id,
        required: obligation.severity === "required",
        proofStrategy: proofRef
      };
      validationObligations[obligation.obligationId] = {
        digest: computeCanonicalDigest(material, input.hasher),
        ...material
      };
    }
  }
  const artifactRefs = new Map(Object.values(artifacts).map((contract) => [
    contract.id,
    refFor(contract, input.plan.revision, input.hasher)
  ]));
  const seamRefs = new Map(Object.values(seams).map((contract) => [
    contract.id,
    refFor(contract, input.plan.revision, input.hasher)
  ]));
  refs.push(
    ...artifactRefs.values(),
    ...seamRefs.values(),
    ...proofRefs.values(),
    ...Object.values(validationObligations).map(({ id, revision: obligationRevision, digest }) => ({
      id,
      revision: obligationRevision,
      digest
    }))
  );

  const integrations = compileIntegrations(input.plan);
  for (const integration of Object.values(integrations)) {
    refs.push(refFor(integration, input.plan.revision, input.hasher));
  }
  const refCollision = findCanonicalRefCollision(refs);
  if (refCollision !== undefined) {
    return {
      ok: false,
      findings: [{
        code: "canonical_contract_ref_collision",
        severity: "error",
        authority: "deterministic",
        message: `Canonical contract identity ${refCollision.id}@${refCollision.revision} names conflicting digests.`,
        subjectId: refCollision.id,
        evidenceRefs: [],
        resolution: "none"
      }]
    };
  }

  const graph = buildGraphRevision(graphMaterial(input, taskBundles, artifactRefs, seamRefs, refs), input.hasher);
  const graphFindings = validateGraphRevision(graph, {
    hasher: input.hasher,
    resourceOverlap: input.repositoryView.catalog.asOverlapQuery()
  });
  if (graphFindings.length > 0) {
    return {
      ok: false,
      findings: graphFindings.map((item) => ({
        code: `graph_${item.code}`,
        severity: "error",
        authority: "deterministic",
        message: item.message,
        ...(item.nodeId === undefined ? {} : { subjectId: item.nodeId }),
        evidenceRefs: [],
        resolution: "none"
      }))
    };
  }
  return {
    ok: true,
    graph,
    contracts: {
      taskBundles: sortedRecord(taskBundles),
      artifacts: sortedRecord(artifacts),
      seams: sortedRecord(seams),
      integrations: sortedRecord(integrations),
      validationObligations: sortedRecord(validationObligations),
      proofStrategies,
      refs: uniqueRefs(refs)
    }
  };
}

function compileArtifacts(plan: SemanticPlan, revision: string): Record<string, ArtifactContract> {
  return Object.fromEntries(Object.values(plan.artifacts).map((artifact) => [artifact.id, {
    schemaVersion: 2 as const,
    id: artifact.id,
    revision,
    provenance: "compiled" as const,
    producerNodeId: artifact.producerUnitId,
    consumerNodeIds: [...artifact.consumerUnitIds],
    artifactType: artifact.artifactType,
    ...(artifact.mediaType === undefined ? {} : { mediaType: artifact.mediaType }),
    materialization: artifact.materialization,
    expectedPaths: normalizedPaths(artifact.expectedPaths)
  }]));
}

function compileSeams(plan: SemanticPlan, revision: string): Record<string, SeamContract> {
  return Object.fromEntries(Object.values(plan.seams).map((seam) => [seam.id, {
    schemaVersion: 2 as const,
    id: seam.id,
    revision,
    provenance: "compiled" as const,
    kind: seam.kind,
    specification: seam.specification,
    producerNodeId: seam.producerUnitId,
    consumerNodeIds: [...seam.consumerUnitIds],
    semanticFacts: { ...seam.semanticFacts },
    compatibility: { ...seam.compatibility, rules: [...seam.compatibility.rules] },
    baselineArtifactContractId: seam.artifactId
  }]));
}

function compileScope(input: CompilePlanInput, unit: WorkUnit, revision: string): ScopeContract {
  const contributors = scopeContributors(input.plan, unit);
  const catalogPaths = contributors.flatMap((contributor) => contributor.repositorySurface.resourceRefs).flatMap((resourceId) => {
    const resolved = input.repositoryView.catalog.resolve(resourceId);
    return resolved.state === "known" && resolved.resource.path !== undefined
      ? [normalizePath(resolved.resource.path)]
      : [];
  });
  const forbiddenPaths = normalizedPaths(input.goal.acceptanceCriteria.flatMap(({ protectedReferences }) =>
    protectedReferences.filter((reference) => reference.startsWith("path:")).map((reference) => reference.slice(5))
  ));
  const allowedPaths = normalizedPaths([
    ...contributors.flatMap((contributor) => contributor.repositorySurface.pathHints),
    ...catalogPaths
  ])
    .filter((candidate) => !forbiddenPaths.some((forbidden) => pathsOverlap(candidate, forbidden)));
  return {
    schemaVersion: 2,
    id: `scope:${unit.id}`,
    revision,
    provenance: "compiled",
    nodeId: unit.id,
    allowedPaths,
    forbiddenPaths,
    coordinationPaths: [],
    outputRoots: []
  };
}

function compileValidation(unit: WorkUnit, revision: string): ValidationContract {
  return {
    schemaVersion: 2,
    id: `validation-contract:${unit.id}`,
    revision,
    provenance: "compiled",
    nodeId: unit.id,
    obligations: unit.validation.map((item) => ({
      id: item.obligationId,
      criterionId: item.criterionId,
      layer: item.layer,
      severity: item.severity,
      acceptableEvidence: [...item.acceptableEvidence],
      baselinePolicy: item.baselinePolicy,
      negativeControl: item.negativeControl,
      flakyPolicy: item.flakyPolicy
    }))
  };
}

function compileTask(
  input: CompilePlanInput,
  unit: WorkUnit,
  scope: ScopeContract,
  validation: ValidationContract,
  artifacts: Readonly<Record<string, ArtifactContract>>,
  seams: Readonly<Record<string, SeamContract>>,
  revision: string
): TaskContract {
  const locallyValidatedCriteria = new Set(validation.obligations
    .filter(({ severity }) => severity === "required")
    .map(({ criterionId }) => criterionId));
  return {
    schemaVersion: 2,
    id: `task:${unit.id}`,
    revision,
    provenance: "compiled",
    nodeId: unit.id,
    goal: unit.objective,
    acceptanceCriteria: unit.criteria.map((criterion) => ({
      id: criterion.criterionId,
      kind: criterionKind(unit.validation.find((item) => item.criterionId === criterion.criterionId)?.layer),
      description: criterion.statement,
      required: locallyValidatedCriteria.has(criterion.criterionId)
    })),
    scope: legacyRef(scope),
    consumes: unit.consumes.map((id) => legacyRef(artifacts[id]!)),
    produces: unit.produces.map((id) => legacyRef(artifacts[id]!)),
    seams: unit.seamRefs.map((id) => seams[id]!).filter((seam) =>
      seam.producerNodeId === unit.id || seam.consumerNodeIds.includes(unit.id)
    ).map(legacyRef),
    validation: legacyRef(validation),
    constraints: [...input.goal.constraints]
  };
}

function compileIntegrations(plan: SemanticPlan): Record<string, CompiledIntegrationContract> {
  const entries: Array<[string, CompiledIntegrationContract]> = [];
  for (const unit of Object.values(plan.units)) {
    if (unit.integration === undefined) continue;
    const integrationId = `integration:${unit.id}`;
    entries.push([
      integrationId,
      {
        id: integrationId,
        obligationId: unit.integration.obligationId,
        revision: plan.revision,
        ownerUnitId: unit.id,
        objective: unit.integration.objective,
        criterionIds: [...unit.integration.criterionIds],
        proofStrategyId: unit.integration.proofStrategyId,
        artifactIds: [...unit.integration.artifactIds],
        seamIds: [...unit.integration.seamIds]
      }
    ]);
  }
  return Object.fromEntries(entries);
}

function graphMaterial(
  input: CompilePlanInput,
  bundles: Readonly<Record<string, TaskContractBundle>>,
  artifactRefs: ReadonlyMap<string, CanonicalContractRef>,
  seamRefs: ReadonlyMap<string, CanonicalContractRef>,
  refs: readonly CanonicalContractRef[]
): GraphRevisionMaterial {
  const artifactRequirements = Object.values(input.plan.artifacts).flatMap((artifact) =>
    artifact.consumerUnitIds.map((consumerId) => ({
      id: input.idFactory("artifact-requirement", [artifact.id, consumerId]),
      producerNodeId: artifact.producerUnitId,
      consumerNodeId: consumerId,
      artifactContract: artifactRefs.get(artifact.id)!,
      consumerInputName: artifact.id,
      acceptedManifestKinds: ["change_set", "candidate_tree"] as Array<"change_set" | "candidate_tree">
    }))
  );
  return {
    graphId: input.idFactory("graph", [input.plan.id]),
    revision: input.plan.revision,
    semanticPlan: { id: input.plan.id, revision: input.plan.revision, digest: input.plan.digest },
    repositoryView: { ...input.plan.repositoryView },
    rootId: input.plan.rootUnitId,
    nodes: Object.fromEntries(Object.values(input.plan.units).map((unit) => [unit.id, {
      id: unit.id,
      parentId: unit.parentId ?? null,
      kind: unit.id === input.plan.rootUnitId ? "root" as const : unit.role,
      title: unit.title,
      goal: unit.objective,
      contractRef: refFor(bundles[unit.id]!.task, input.plan.revision, input.hasher)
    }])),
    artifactRequirements,
    seamBindings: Object.values(input.plan.seams).flatMap((seam) => seam.consumerUnitIds.map((consumerId) => ({
      id: input.idFactory("seam-binding", [seam.id, consumerId]),
      producerNodeId: seam.producerUnitId,
      consumerNodeId: consumerId,
      seamContract: seamRefs.get(seam.id)!,
      artifactRequirementId: input.idFactory("artifact-requirement", [seam.artifactId, consumerId]),
      validationObligationIds: [...seam.validationObligationIds]
    }))),
    resourceClaims: Object.values(input.plan.units).flatMap((unit) => unit.resourceIntents.map((intent) => {
      const common = {
        id: input.idFactory("resource-claim", [unit.id, intent.resourceId, intent.access]),
        nodeId: unit.id,
        resourceId: intent.resourceId,
        source: "planner" as const,
        evidenceRefs: [...intent.evidenceRefs],
        epistemic: intent.epistemic
      };
      const inputVersion = intent.inputArtifactId === undefined
        ? { kind: "repository_view" as const, digest: input.repositoryView.digest }
        : { kind: "artifact_contract" as const, ref: artifactRefs.get(intent.inputArtifactId)! };
      return intent.access === "observe"
        ? { ...common, access: "observe" as const, inputVersion }
        : {
            ...common,
            access: "modify" as const,
            ownerPhase: intent.ownerPhase,
            inputVersion,
            outputArtifact: artifactRefs.get(intent.outputArtifactId)!
          };
    })),
    runtimeLeaseClaims: [],
    contractRefs: uniqueRefs(refs)
  };
}

function refFor(value: unknown, revision: number, hasher: DigestHasher, id?: string): CanonicalContractRef {
  const contractId = id ?? (value as { id: string }).id;
  return { id: contractId, revision, digest: computeCanonicalDigest(value, hasher) };
}

function legacyRef<T extends { id: string; revision: string }>(value: T): { id: string; revision: string } {
  return { id: value.id, revision: value.revision };
}

function criterionKind(layer: "static" | "unit" | "integration" | "e2e" | "security" | "accessibility" | "manual" | undefined): "static" | "unit" | "integration" | "e2e" | "security" | "accessibility" | "manual" {
  return layer ?? "integration";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueRefs(refs: readonly CanonicalContractRef[]): CanonicalContractRef[] {
  return [...new Map(refs.map((ref) => [`${ref.id}\0${ref.revision}\0${ref.digest}`, ref])).values()]
    .sort((left, right) => `${left.id}\0${left.revision}\0${left.digest}`.localeCompare(`${right.id}\0${right.revision}\0${right.digest}`));
}

function findCanonicalRefCollision(
  refs: readonly CanonicalContractRef[]
): { id: string; revision: number; digests: string[] } | undefined {
  const byIdentity = new Map<string, { id: string; revision: number; digests: Set<string> }>();
  for (const ref of refs) {
    const key = `${ref.id}\0${ref.revision}`;
    const group = byIdentity.get(key) ?? { id: ref.id, revision: ref.revision, digests: new Set<string>() };
    group.digests.add(ref.digest);
    byIdentity.set(key, group);
  }
  const collision = [...byIdentity.values()].find(({ digests }) => digests.size > 1);
  return collision === undefined ? undefined : { ...collision, digests: [...collision.digests].sort() };
}

function sortedRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function normalizedPaths(paths: readonly string[]): string[] {
  return unique(paths.map(normalizePath).filter((path) => path !== ""));
}

function scopeContributors(plan: SemanticPlan, unit: WorkUnit): WorkUnit[] {
  if (hasDeclaredScope(unit)) return [unit];
  const contributors: WorkUnit[] = [];
  const pending = Object.values(plan.units).filter(({ parentId }) => parentId === unit.id);
  const visited = new Set<string>([unit.id]);
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    if (visited.has(candidate.id)) continue;
    visited.add(candidate.id);
    if (hasDeclaredScope(candidate)) {
      contributors.push(candidate);
    } else {
      pending.push(...Object.values(plan.units).filter(({ parentId }) => parentId === candidate.id));
    }
  }
  return contributors;
}

function hasDeclaredScope(unit: WorkUnit): boolean {
  return unit.repositorySurface.resourceRefs.length > 0 || unit.repositorySurface.pathHints.length > 0;
}

function compilerFinding(error: unknown): PlanningFinding {
  return {
    code: "compiler_invalid_material",
    severity: "error",
    authority: "deterministic",
    message: error instanceof Error ? error.message : "Direct plan compilation failed with invalid material.",
    evidenceRefs: [],
    resolution: "none"
  };
}
