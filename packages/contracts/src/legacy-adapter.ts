import type { TaskContractBundle } from "./contract-bundle.js";
import { TaskContractBundleSchema } from "./contract-bundle.js";
import type { ContractProvenance, ContractReference } from "./contract-identity.js";
import type { TaskAcceptanceCriterion } from "./task-contract.js";
import type { ValidationObligation } from "./validation-contract.js";

const LEGACY_PROVENANCE: ContractProvenance = "legacy_inferred";

export interface LegacyAgentTaskContractShape {
  taskId: string;
  objective: string;
  allowed: { paths: string[] };
  forbidden: { paths: string[] };
  acceptance: Array<{ kind: string; description: string }>;
  validationCommands: Array<{ kind: string; command: string }>;
  expectedOutput: { changedFiles: string[] };
  executionScope?: {
    implementationPaths: string[];
    testPaths: string[];
    configPaths: string[];
  } | undefined;
  forbiddenPaths?: string[] | undefined;
  dependencies: string[];
  consumedInterfaces?: Array<{ id: string; signature: string; description: string }> | undefined;
  producedInterfaces?: Array<{ id: string; signature: string; description: string }> | undefined;
}

export type LegacyContractMigrationIssueCode =
  | "unresolved_consumed_seam"
  | "unresolved_produced_seam_consumers"
  | "legacy_validation_command_not_promoted"
  | "legacy_dependency_not_promoted";

export interface LegacyContractMigrationIssue {
  code: LegacyContractMigrationIssueCode;
  message: string;
  seamId?: string;
}

export interface LegacyContractAdapterResult {
  bundle: TaskContractBundle;
  migrationIssues: LegacyContractMigrationIssue[];
}

export function adaptParsedLegacyAgentTaskContract(
  legacy: LegacyAgentTaskContractShape
): LegacyContractAdapterResult {
  const taskId = legacy.taskId;
  const criteria = legacy.acceptance.map((criterion, index): TaskAcceptanceCriterion => ({
    id: `criterion:${taskId}:${index + 1}`,
    kind: acceptanceKind(criterion.kind),
    description: criterion.description,
    required: true
  }));
  const scopeId = `scope:${taskId}`;
  const validationId = `validation:${taskId}`;
  const artifactId = `artifact:${taskId}:change-set`;
  const allowedPaths = unique([
    ...(legacy.executionScope?.implementationPaths ?? []),
    ...(legacy.executionScope?.testPaths ?? []),
    ...(legacy.executionScope?.configPaths ?? []),
    ...legacy.allowed.paths
  ]);
  const forbiddenPaths = unique([...legacy.forbidden.paths, ...(legacy.forbiddenPaths ?? [])]);
  const artifacts = legacy.expectedOutput.changedFiles.length > 0
    ? [{
        schemaVersion: 2 as const,
        id: artifactId,
        revision: revisionFor("artifact", {
          taskId,
          expectedPaths: legacy.expectedOutput.changedFiles
        }),
        provenance: LEGACY_PROVENANCE,
        producerNodeId: taskId,
        consumerNodeIds: [],
        artifactType: "legacy-change-set",
        materialization: "files" as const,
        expectedPaths: unique(legacy.expectedOutput.changedFiles)
      }]
    : [];
  const obligations = criteria.map((criterion, index): ValidationObligation => ({
    id: `obligation:${taskId}:${index + 1}`,
    criterionId: criterion.id,
    layer: validationLayer(legacy.acceptance[index]?.kind ?? "custom"),
    severity: criterion.required ? "required" : "advisory",
    acceptableEvidence: acceptableEvidence(legacy.acceptance[index]?.kind ?? "custom"),
    baselinePolicy: criterion.kind === "manual" ? "not_required" : "optional",
    negativeControl: criterion.kind === "unit" || criterion.kind === "integration" ? "when_feasible" : "not_required",
    flakyPolicy: "forbid"
  }));
  const scopeRevision = revisionFor("scope", { taskId, allowedPaths, forbiddenPaths });
  const validationRevision = revisionFor("validation", { taskId, obligations });
  const producedReferences: ContractReference[] = artifacts.map(({ id, revision }) => ({ id, revision }));
  const taskContent = {
    taskId,
    objective: legacy.objective,
    criteria,
    scopeRevision,
    validationRevision,
    producedReferences
  };

  const candidate = {
    schemaVersion: 2 as const,
    task: {
      schemaVersion: 2 as const,
      id: `task-contract:${taskId}`,
      revision: revisionFor("task", taskContent),
      provenance: LEGACY_PROVENANCE,
      nodeId: taskId,
      goal: legacy.objective,
      acceptanceCriteria: criteria,
      scope: { id: scopeId, revision: scopeRevision },
      consumes: [],
      produces: producedReferences,
      seams: [],
      validation: { id: validationId, revision: validationRevision },
      constraints: []
    },
    scope: {
      schemaVersion: 2 as const,
      id: scopeId,
      revision: scopeRevision,
      provenance: LEGACY_PROVENANCE,
      nodeId: taskId,
      allowedPaths,
      forbiddenPaths,
      coordinationPaths: []
    },
    seams: [],
    artifacts,
    validation: {
      schemaVersion: 2 as const,
      id: validationId,
      revision: validationRevision,
      provenance: LEGACY_PROVENANCE,
      nodeId: taskId,
      obligations
    }
  };
  const parsed = TaskContractBundleSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Legacy AgentTaskContract cannot be represented safely: ${parsed.error.message}`);
  }

  const migrationIssues: LegacyContractMigrationIssue[] = [
    ...(legacy.consumedInterfaces ?? []).map((seam) => ({
      code: "unresolved_consumed_seam" as const,
      seamId: seam.id,
      message: `Legacy consumed seam "${seam.id}" has no canonical producer identity.`
    })),
    ...(legacy.producedInterfaces ?? []).map((seam) => ({
      code: "unresolved_produced_seam_consumers" as const,
      seamId: seam.id,
      message: `Legacy produced seam "${seam.id}" has no canonical consumer identities.`
    })),
    ...legacy.validationCommands.map((command) => ({
      code: "legacy_validation_command_not_promoted" as const,
      message: `Legacy command "${command.command}" remains provenance only; V2 stores obligations, not an exact recipe.`
    })),
    ...legacy.dependencies.map((dependency) => ({
      code: "legacy_dependency_not_promoted" as const,
      message: `Legacy dependency "${dependency}" requires graph-level evidence before it can become an ArtifactRequirement.`
    }))
  ];

  return { bundle: parsed.data, migrationIssues };
}

function acceptanceKind(kind: string): TaskAcceptanceCriterion["kind"] {
  switch (kind) {
    case "typecheck":
    case "exports_symbol":
      return "static";
    case "test":
      return "unit";
    case "command":
      return "integration";
    default:
      return "manual";
  }
}

function validationLayer(kind: string): ValidationObligation["layer"] {
  const mapped = acceptanceKind(kind);
  return mapped === "custom" ? "manual" : mapped;
}

function acceptableEvidence(kind: string): ValidationObligation["acceptableEvidence"] {
  switch (acceptanceKind(kind)) {
    case "static":
      return ["static_analysis"];
    case "unit":
    case "integration":
    case "e2e":
      return ["test_result"];
    case "security":
    case "accessibility":
      return ["test_result", "artifact_inspection"];
    default:
      return ["manual_attestation"];
  }
}

function revisionFor(kind: string, value: unknown): string {
  return `legacy-${kind}-${fnv1a(stableSerialize(value))}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
