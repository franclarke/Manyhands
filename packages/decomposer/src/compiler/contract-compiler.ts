import { createHash } from "node:crypto";
import {
  TaskContractBundleSchema,
  type ArtifactContract,
  type ContractReference,
  type ScopeContract,
  type SeamContract,
  type SourceContract,
  type TaskAcceptanceCriterion,
  type TaskContractBundle,
  type ValidationContract,
  type ValidationObligation
} from "@manyhands/contracts";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import type { WorkBreakdown, WorkUnit } from "../planner/schema.js";
import { allocateAcceptanceIntents } from "./acceptance-allocation.js";
import {
  compileAcceptanceCriterion,
  compileLocalAcceptanceCriterion,
  compileValidationObligation,
  type ValidationCompilationDependencies
} from "./validation-obligations.js";

export interface ContractCompilerDependencies extends ValidationCompilationDependencies {}

export interface ContractCompilationResult {
  bundles: TaskContractBundle[];
  artifactContracts: ArtifactContract[];
  nodeOutputArtifactContracts: ArtifactContract[];
  seamContracts: SeamContract[];
  scopePathsByNodeId: Record<string, string[]>;
  acceptanceOwnerByIntentId: Record<string, string>;
}

export function compileContractBundles(input: {
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
  nodeIdByUnitKey: Record<string, string>;
  sourceContract?: SourceContract;
}, dependencies: ContractCompilerDependencies): ContractCompilationResult {
  const units = flattenUnits(input.breakdown.root);
  const evidence = new Map(input.breakdown.repositoryEvidence.map((item) => [item.id, item]));
  const repositoryRoot = input.repositorySnapshot.rootPath;
  const indexedPaths = new Set(input.repositorySnapshot.index?.files.map((file) => normalizeRepositoryPath(file.path, repositoryRoot)) ?? []);
  if (hasPackageManifest(input.repositorySnapshot)) indexedPaths.add("package.json");
  const scopePathsByNodeId: Record<string, string[]> = {};
  const directPaths = new Map(units.map((unit) => [unit.key, unit.evidenceIds
      .map((id) => evidence.get(id))
      .filter((item): item is NonNullable<typeof item> => item?.kind === "path")
      .map((item) => normalizeRepositoryPath(item.reference, repositoryRoot))
      .filter((path) => indexedPaths.has(path))
      .concat((unit.plannedPaths ?? []).map((path) => normalizeRepositoryPath(path, repositoryRoot)))]));
  populateScopePaths(input.breakdown.root, input.nodeIdByUnitKey, directPaths, scopePathsByNodeId);

  const artifactContracts = input.breakdown.candidateArtifacts.map((candidate) => {
    const producerNodeId = requireNodeId(input.nodeIdByUnitKey, candidate.producerUnitKey);
    const consumerNodeIds = candidate.consumerUnitKeys.map((key) => requireNodeId(input.nodeIdByUnitKey, key));
    const producerUnit = units.find((unit) => unit.key === candidate.producerUnitKey);
    if (producerUnit === undefined) throw new Error(`Artifact producer ${candidate.producerUnitKey} does not exist.`);
    const producerEvidenceIds = new Set(producerUnit.evidenceIds);
    const expectedPaths = candidate.evidenceIds
      .filter((id) => producerEvidenceIds.has(id))
      .map((id) => evidence.get(id))
      .filter((item): item is NonNullable<typeof item> => item?.kind === "path")
      .map((item) => normalizeRepositoryPath(item.reference, repositoryRoot))
      .filter((path) => indexedPaths.has(path))
      .concat((producerUnit.plannedPaths ?? []).map((path) => normalizeRepositoryPath(path, repositoryRoot)));
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

  const parentKeyByUnitKey = collectParentKeys(input.breakdown.root);
  const nodeOutputArtifactContracts = units.map((unit) => {
    const producerNodeId = requireNodeId(input.nodeIdByUnitKey, unit.key);
    const parentKey = parentKeyByUnitKey.get(unit.key);
    const consumerNodeIds = parentKey === undefined
      ? []
      : [requireNodeId(input.nodeIdByUnitKey, parentKey)];
    const base = {
      schemaVersion: 2 as const,
      id: dependencies.idFor("artifact-contract", `${unit.key}-output`),
      provenance: "compiled" as const,
      producerNodeId,
      consumerNodeIds,
      artifactType: parentKey === undefined ? "final-candidate" : "node-result",
      mediaType: "application/vnd.manyhands.git-commit",
      materialization: "commit" as const,
      expectedPaths: scopePathsByNodeId[producerNodeId] ?? []
    };
    return { ...base, revision: revisionFor(base) } satisfies ArtifactContract;
  });
  const allArtifactContracts = [...artifactContracts, ...nodeOutputArtifactContracts];

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
  const acceptanceOwnerByIntentId = allocateAcceptanceIntents(input.breakdown.root);
  for (const intent of input.breakdown.acceptanceIntents) {
    acceptanceOwnerByIntentId[intent.id] ??= input.breakdown.root.key;
  }
  const bundles = units.map((unit) => {
    const nodeId = requireNodeId(input.nodeIdByUnitKey, unit.key);
    const userCriteria = unit.acceptanceIntentIds
      .filter((intentId) => acceptanceOwnerByIntentId[intentId] === unit.key)
      .map((intentId) => {
      const intent = intents.get(intentId);
      if (intent === undefined) throw new Error(`Unit ${unit.key} references missing acceptance intent ${intentId}.`);
      return compileAcceptanceCriterion(unit, intent, dependencies);
    });
    const criteria = userCriteria.length > 0
      ? userCriteria
      : [compileLocalAcceptanceCriterion(unit, dependencies)];
    const scope = contractWithRevision({
      schemaVersion: 2 as const,
      id: dependencies.idFor("scope-contract", unit.key),
      provenance: "compiled" as const,
      nodeId,
      allowedPaths: scopePathsByNodeId[nodeId] ?? [],
      forbiddenPaths: [],
      coordinationPaths: coordinationPaths(nodeId, scopePathsByNodeId),
      outputRoots: deriveOutputRoots(scopePathsByNodeId[nodeId] ?? [])
    }) satisfies ScopeContract;
    const validation = contractWithRevision({
      schemaVersion: 2 as const,
      id: dependencies.idFor("validation-contract", unit.key),
      provenance: "compiled" as const,
      nodeId,
      obligations: criteria.map((criterion) => compileValidationObligation(
        unit,
        criterion,
        dependencies,
        criterionEvidence(unit, criteria, input.breakdown.repositoryEvidence)
      ))
    }) satisfies ValidationContract;
    const relevantArtifacts = allArtifactContracts.filter((contract) => contract.producerNodeId === nodeId || contract.consumerNodeIds.includes(nodeId));
    const relevantSeams = seamContracts.filter((contract) => contract.producerNodeId === nodeId || contract.consumerNodeIds.includes(nodeId));
    const task = contractWithRevision({
      schemaVersion: 2 as const,
      id: dependencies.idFor("task-contract", unit.key),
      provenance: "compiled" as const,
      nodeId,
      goal: unit.objective,
      ...(input.sourceContract === undefined ? {} : { sourceContract: structuredClone(input.sourceContract) }),
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

  return {
    bundles,
    artifactContracts: allArtifactContracts,
    nodeOutputArtifactContracts,
    seamContracts,
    scopePathsByNodeId,
    acceptanceOwnerByIntentId
  };
}

function criterionEvidence(
  unit: WorkUnit,
  criteria: readonly TaskAcceptanceCriterion[],
  repositoryEvidence: WorkBreakdown["repositoryEvidence"]
): ValidationObligation["evidence"] {
  const evidenceById = new Map(repositoryEvidence.map((evidence) => [evidence.id, evidence]));
  const citedReferences = unit.evidenceIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return evidence?.kind === "path" ? [evidence.reference] : [];
  });
  const plannedReferences = [...new Set((unit.plannedPaths ?? []).filter(isTestReference))].sort();
  const focusedReferences = [...new Set([...plannedReferences, ...citedReferences.filter(isTestReference)])].sort();
  // A composite owns an integration criterion, so existing test paths that it
  // cites are the repository-grounded evidence for the assembled tree. Leaf
  // units keep the stricter authorship rule below: a leaf-level citation alone
  // does not prove that the leaf owns or changes that test.
  const compositeReferences = unit.kind === "composite"
    ? [...new Set([...plannedReferences, ...citedReferences.filter(isTestReference)])].sort()
    : plannedReferences;

  if (criteria.length === 1) {
    const references = focusedReferences;
    if (references.length === 0) return undefined;
    return { kind: "focused_command", selectors: references, references };
  }

  // Con varios criterios, una referencia que la unidad sólo *citó* sigue sin
  // decir cuál de ellos prueba: eso es co-localización, y permanece sin binding.
  //
  // Un test que la unidad **declara que va a escribir** es distinto. Es autoría
  // suya y cubre criterios que también son suyos, así que puede sostenerlos
  // siempre que el carácter compartido quede registrado en el binding en vez de
  // disimularse como si cada criterio tuviera su prueba propia. Sin esta
  // distinción, una unidad gruesa ---toda la condición A del estudio
  // comparativo--- no podía vincular evidencia y por lo tanto no podía entregar
  // nunca, perdiendo por construcción y no por granularidad.
  if (compositeReferences.length === 0) return undefined;
  return {
    kind: "shared_command",
    criterionIds: criteria.map((criterion) => criterion.id),
    references: compositeReferences,
    rationale: `The unit authors these tests and owns all ${criteria.length} criteria; the evidence is shared across them rather than specific to one.`
  };
}

function isTestReference(reference: string): boolean {
  const normalized = reference.replaceAll("\\", "/");
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(normalized);
}

function hasPackageManifest(snapshot: RepositorySnapshot): boolean {
  return snapshot.capabilities.packageManager !== undefined ||
    Object.keys(snapshot.capabilities.scripts).length > 0 ||
    snapshot.capabilities.stack.some((item) => item.evidence.some((entry) => entry.includes("package.json")));
}

function normalizeRepositoryPath(value: string, repositoryRoot: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  const root = repositoryRoot.replaceAll("\\", "/").replace(/\/+$/u, "");
  const normalizedLower = normalized.toLowerCase();
  const rootLower = root.toLowerCase();
  if (normalizedLower === rootLower) return "";
  if (normalizedLower.startsWith(`${rootLower}/`)) return normalized.slice(root.length + 1);
  return normalized;
}

function populateScopePaths(
  unit: WorkUnit,
  nodeIdByUnitKey: Record<string, string>,
  directPaths: ReadonlyMap<string, string[]>,
  output: Record<string, string[]>
): string[] {
  const descendants = unit.kind === "composite"
    ? unit.children.flatMap((child) => populateScopePaths(child, nodeIdByUnitKey, directPaths, output))
    : [];
  const paths = [...new Set([...(directPaths.get(unit.key) ?? []), ...descendants])].sort();
  if (paths.length === 0) {
    throw new Error(`Cannot compile an honest scope for unit ${unit.key}; no existing or explicitly planned path is available.`);
  }
  output[requireNodeId(nodeIdByUnitKey, unit.key)] = paths;
  return paths;
}

function collectParentKeys(root: WorkUnit): Map<string, string> {
  const parents = new Map<string, string>();
  const visit = (unit: WorkUnit): void => {
    if (unit.kind !== "composite") return;
    for (const child of unit.children) {
      parents.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return parents;
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

/**
 * Output roots are *derived*, never requested. A node may create new files only
 * under the directories its own declared surface already occupies, so the
 * authority stays grounded in the repository evidence the planner cited rather
 * than in a root the model could invent. A path that lives at the repository
 * root yields no root at all — that would be repo-wide write.
 */
function deriveOutputRoots(allowedPaths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of allowedPaths) {
    const normalized = path.replaceAll("\\", "/");
    const cut = normalized.lastIndexOf("/");
    if (cut <= 0) continue;
    roots.add(normalized.slice(0, cut));
  }
  return [...roots].sort();
}

function coordinationPaths(nodeId: string, scopePathsByNodeId: Record<string, string[]>): string[] {
  const own = new Set(scopePathsByNodeId[nodeId] ?? []);
  return [...own].filter((path) => Object.entries(scopePathsByNodeId).some(([otherId, paths]) => otherId !== nodeId && paths.includes(path))).sort();
}
