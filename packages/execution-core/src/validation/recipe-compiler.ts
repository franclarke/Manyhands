import { createHash } from "node:crypto";
import type { ExecutionValidationCommand, ValidationContract, ValidationObligation } from "@manyhands/contracts";
import type { RepositoryCapabilities } from "@manyhands/repository-index";

export interface ValidationRecipeStep {
  obligationId: string;
  criterionId: string;
  evidenceKind: ValidationObligation["acceptableEvidence"][number];
  command: ExecutionValidationCommand;
  baselinePolicy: ValidationObligation["baselinePolicy"];
  negativeControl: ValidationObligation["negativeControl"];
  flakyPolicy: ValidationObligation["flakyPolicy"];
  commandDigest?: string;
  attributions?: ValidationRecipeAttribution[];
}

export interface ValidationRecipeAttribution {
  obligationId: string;
  criterionId: string;
  evidenceKind: ValidationObligation["acceptableEvidence"][number];
  baselinePolicy: ValidationObligation["baselinePolicy"];
  negativeControl: ValidationObligation["negativeControl"];
  flakyPolicy: ValidationObligation["flakyPolicy"];
  references: string[];
  rationale: string;
}

export interface ValidationRecipe {
  schemaVersion: 1;
  recipeId: string;
  validationContract: { id: string; revision: string };
  repositorySnapshotId: string;
  candidateCommit: string;
  baselineCommit?: string;
  steps: ValidationRecipeStep[];
  unmaterializedObligationIds: string[];
}

export function compileValidationRecipe(input: {
  contract: ValidationContract;
  capabilities: RepositoryCapabilities;
  repositorySnapshotId: string;
  candidateCommit: string;
  baselineCommit?: string;
}): ValidationRecipe {
  const steps: ValidationRecipeStep[] = [];
  const unmaterializedObligationIds: string[] = [];
  for (const obligation of input.contract.obligations) {
    if (obligation.evidence === undefined || !validSharedEvidence(obligation, input.contract.obligations)) {
      unmaterializedObligationIds.push(obligation.id);
      continue;
    }
    const capability = capabilityFor(obligation, input.capabilities);
    if (capability === undefined) {
      unmaterializedObligationIds.push(obligation.id);
      continue;
    }
    const selectors = obligation.evidence.kind === "focused_command"
      ? obligation.evidence.selectors
      : obligation.evidence.kind === "shared_command"
        ? obligation.evidence.references
        : [];
    const command = { command: capability.command, args: [...capability.args, ...selectors], timeoutMs: 60_000, cwd: "worktree" as const };
    const commandDigest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const attribution: ValidationRecipeAttribution = {
      obligationId: obligation.id,
      criterionId: obligation.criterionId,
      evidenceKind: obligation.acceptableEvidence[0]!,
      baselinePolicy: obligation.baselinePolicy,
      negativeControl: obligation.negativeControl,
      flakyPolicy: obligation.flakyPolicy,
      references: [...obligation.evidence.references],
      rationale: obligation.evidence.kind === "shared_command"
        ? obligation.evidence.rationale
        : obligation.evidence.kind === "focused_command"
          ? `Focused command selectors: ${obligation.evidence.selectors.join(", ")}.`
          : `Static proof references: ${obligation.evidence.references.join(", ")}.`
    };
    const existing = steps.find((step) => step.commandDigest === commandDigest);
    if (existing !== undefined) {
      existing.attributions!.push(attribution);
      continue;
    }
    steps.push({
      obligationId: attribution.obligationId,
      criterionId: attribution.criterionId,
      evidenceKind: attribution.evidenceKind,
      command,
      baselinePolicy: attribution.baselinePolicy,
      negativeControl: attribution.negativeControl,
      flakyPolicy: attribution.flakyPolicy,
      commandDigest,
      attributions: [attribution]
    });
  }
  const identity = JSON.stringify({ contract: { id: input.contract.id, revision: input.contract.revision }, snapshot: input.repositorySnapshotId, candidate: input.candidateCommit, baseline: input.baselineCommit, steps, unmaterializedObligationIds });
  return {
    schemaVersion: 1,
    recipeId: `recipe-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
    validationContract: { id: input.contract.id, revision: input.contract.revision },
    repositorySnapshotId: input.repositorySnapshotId,
    candidateCommit: input.candidateCommit,
    ...(input.baselineCommit !== undefined ? { baselineCommit: input.baselineCommit } : {}),
    steps,
    unmaterializedObligationIds
  };
}

function validSharedEvidence(obligation: ValidationObligation, obligations: readonly ValidationObligation[]): boolean {
  const evidence = obligation.evidence;
  if (evidence?.kind !== "shared_command") return true;
  if (!evidence.criterionIds.includes(obligation.criterionId)) return false;
  return evidence.criterionIds.every((criterionId) => obligations.some((candidate) =>
    candidate.criterionId === criterionId
    && candidate.evidence?.kind === "shared_command"
    && JSON.stringify(candidate.evidence) === JSON.stringify(evidence)
  ));
}

function capabilityFor(obligation: ValidationObligation, capabilities: RepositoryCapabilities) {
  const preferred = obligation.layer === "static"
    ? ["typecheck", "lint", "build"]
    : ["test"];
  return preferred.map((kind) => capabilities.baselineCommands.find((command) => command.kind === kind)).find((command) => command !== undefined);
}
