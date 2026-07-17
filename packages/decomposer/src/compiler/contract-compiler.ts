import { createHash } from "node:crypto";
import {
  TaskContractBundleSchema,
  type ArtifactContract,
  type ContractReference,
  type ScopeContract,
  type SeamContract,
  type TaskAcceptanceCriterion,
  type TaskContractBundle,
  type ValidationContract
} from "@manyhands/contracts";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import type { WorkBreakdown, WorkUnit, WorkUnitLeaf } from "../planner/schema.js";
import {
  compileAcceptanceCriterion,
  compileValidationObligation,
  type ValidationCompilationDependencies
} from "./validation-obligations.js";

export interface ContractCompilerDependencies extends ValidationCompilationDependencies {}

export interface ContractCompilationResult {
  bundles: TaskContractBundle[];
  artifactContracts: ArtifactContract[];
  seamContracts: SeamContract[];
  scopePathsByNodeId: Record<string, string[]>;
}

export function compileContractBundles(input: {
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
  nodeIdByUnitKey: Record<string, string>;
}, dependencies: ContractCompilerDependencies): ContractCompilationResult {
  const leaves = flattenUnits(input.breakdown.root).filter((unit): unit is WorkUnitLeaf => unit.kind === "leaf");
  const evidence = new Map(input.breakdown.repositoryEvidence.map((item) => [item.id, item]));
  const indexedPaths = new Set(input.repositorySnapshot.index?.files.map((file) => file.path) ?? []);
  const scopePathsByNodeId: Record<string, string[]> = {};
  for (const leaf of leaves) {
    const nodeId = requireNodeId(input.nodeIdByUnitKey, leaf.key);
    const paths = leaf.evidenceIds
      .map((id) => evidence.get(id))
      .filter((item): item is NonNullable<typeof item> => item?.kind === "path")
      .map((item) => item.reference)
      .filter((path) => indexedPaths.has(path));
    scopePathsByNodeId[nodeId] = [...new Set(paths)].sort();
    if (scopePathsByNodeId[nodeId]?.length === 0) {
      throw new Error(`Cannot compile an honest scope for leaf ${leaf.key}; no referenced path exists in the repository snapshot.`);
    }
  }

  const artifactContracts = input.breakdown.candidateArtifacts.map((candidate) => {
    const producerNodeId = requireNodeId(input.nodeIdByUnitKey, candidate.producerUnitKey);
    const consumerNodeIds = candidate.consumerUnitKeys.map((key) => requireNodeId(input.nodeIdByUnitKey, key));
    const producerUnit = leaves.find((leaf) => leaf.key === candidate.producerUnitKey);
    if (producerUnit === undefined) throw new Error(`Artifact producer ${candidate.producerUnitKey} must be an executable leaf.`);
    const producerEvidenceIds = new Set(producerUnit.evidenceIds);
    const expectedPaths = candidate.evidenceIds
      .filter((id) => producerEvidenceIds.has(id))
      .map((id) => evidence.get(id))
      .filter((item): item is NonNullable<typeof item> => item?.kind === "path")
      .map((item) => item.reference)
      .filter((path) => indexedPaths.has(path));
    const base = {
      schemaVersion: 2 as const,
      id: dependencies.idFor("artifact-contract", candidate.id),
      provenance: "compiled" as const,
      producerNodeId,
      consumerNodeIds,
      artifactType: candidate.artifactType,
      materialization: candidate.materializationHint,
      expectedPaths: [...new Set(expectedPaths)].sort()
    };
    return { ...base, revision: revisionFor(base) } satisfies ArtifactContract;
  });

  const seamContracts = input.breakdown.candidateSeams.map((candidate) => {
    const base = {
      schemaVersion: 2 as const,
      id: dependencies.idFor("seam-contract", candidate.id),
      provenance: "compiled" as const,
      kind: candidate.kind,
      specification: candidate.specification,
      producerNodeId: requireNodeId(input.nodeIdByUnitKey, candidate.producerUnitKey),
      consumerNodeIds: candidate.consumerUnitKeys.map((key) => requireNodeId(input.nodeIdByUnitKey, key)),
      semanticFacts: Object.fromEntries(candidate.evidenceIds.map((id, index) => [`evidence.${index}`, id])),
      compatibility: { mode: "exact" as const, rules: ["All participants bind the same compiled revision."] }
    };
    return { ...base, revision: revisionFor(base) } satisfies SeamContract;
  });

  const intents = new Map(input.breakdown.acceptanceIntents.map((intent) => [intent.id, intent]));
  const bundles = leaves.map((leaf) => {
    const nodeId = requireNodeId(input.nodeIdByUnitKey, leaf.key);
    const criteria = leaf.acceptanceIntentIds.map((intentId) => {
      const intent = intents.get(intentId);
      if (intent === undefined) throw new Error(`Leaf ${leaf.key} references missing acceptance intent ${intentId}.`);
      return compileAcceptanceCriterion(leaf, intent, dependencies);
    });
    const scope = contractWithRevision({
      schemaVersion: 2 as const,
      id: dependencies.idFor("scope-contract", leaf.key),
      provenance: "compiled" as const,
      nodeId,
      allowedPaths: scopePathsByNodeId[nodeId] ?? [],
      forbiddenPaths: [],
      coordinationPaths: coordinationPaths(nodeId, scopePathsByNodeId)
    }) satisfies ScopeContract;
    const validation = contractWithRevision({
      schemaVersion: 2 as const,
      id: dependencies.idFor("validation-contract", leaf.key),
      provenance: "compiled" as const,
      nodeId,
      obligations: criteria.map((criterion) => compileValidationObligation(leaf, criterion, dependencies))
    }) satisfies ValidationContract;
    const relevantArtifacts = artifactContracts.filter((contract) => contract.producerNodeId === nodeId || contract.consumerNodeIds.includes(nodeId));
    const relevantSeams = seamContracts.filter((contract) => contract.producerNodeId === nodeId || contract.consumerNodeIds.includes(nodeId));
    const task = contractWithRevision({
      schemaVersion: 2 as const,
      id: dependencies.idFor("task-contract", leaf.key),
      provenance: "compiled" as const,
      nodeId,
      goal: leaf.objective,
      acceptanceCriteria: criteria,
      scope: reference(scope),
      consumes: relevantArtifacts.filter((contract) => contract.consumerNodeIds.includes(nodeId)).map(reference),
      produces: relevantArtifacts.filter((contract) => contract.producerNodeId === nodeId).map(reference),
      seams: relevantSeams.map(reference),
      validation: reference(validation),
      constraints: []
    });
    return TaskContractBundleSchema.parse({
      schemaVersion: 2,
      task,
      scope,
      seams: structuredClone(relevantSeams),
      artifacts: structuredClone(relevantArtifacts),
      validation
    });
  });

  return { bundles, artifactContracts, seamContracts, scopePathsByNodeId };
}

function contractWithRevision<T extends object>(contract: T): T & { revision: string } {
  return { ...contract, revision: revisionFor(contract) };
}

function revisionFor(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

function reference(contract: { id: string; revision: string }): ContractReference {
  return { id: contract.id, revision: contract.revision };
}

function requireNodeId(nodeIdByUnitKey: Record<string, string>, key: string): string {
  const nodeId = nodeIdByUnitKey[key];
  if (nodeId === undefined) throw new Error(`No compiled node exists for semantic unit ${key}.`);
  return nodeId;
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function coordinationPaths(nodeId: string, scopePathsByNodeId: Record<string, string[]>): string[] {
  const own = new Set(scopePathsByNodeId[nodeId] ?? []);
  return [...own].filter((path) => Object.entries(scopePathsByNodeId).some(([otherId, paths]) => otherId !== nodeId && paths.includes(path))).sort();
}
