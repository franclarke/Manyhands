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
    const capability = capabilityFor(obligation, input.capabilities);
    if (capability === undefined) {
      unmaterializedObligationIds.push(obligation.id);
      continue;
    }
    steps.push({
      obligationId: obligation.id,
      criterionId: obligation.criterionId,
      evidenceKind: obligation.acceptableEvidence[0]!,
      command: { command: capability.command, args: [...capability.args], timeoutMs: 60_000, cwd: "worktree" },
      baselinePolicy: obligation.baselinePolicy,
      negativeControl: obligation.negativeControl,
      flakyPolicy: obligation.flakyPolicy
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

function capabilityFor(obligation: ValidationObligation, capabilities: RepositoryCapabilities) {
  const preferred = obligation.layer === "static"
    ? ["typecheck", "lint", "build"]
    : ["test"];
  return preferred.map((kind) => capabilities.baselineCommands.find((command) => command.kind === kind)).find((command) => command !== undefined);
}
