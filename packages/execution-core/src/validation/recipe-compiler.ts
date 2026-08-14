import { createHash } from "node:crypto";
import {
  evidenceKindForBinding,
  type ExecutionValidationCommand,
  type ValidationContract,
  type ValidationObligation
} from "@manyhands/contracts";
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

/** Inputs used to prepare the command program before a candidate exists. */
export interface ValidationRecipePreparationInput {
  contract: ValidationContract;
  capabilities: RepositoryCapabilities;
  repositorySnapshotId: string;
}

/** The candidate-specific identity added after a prepared recipe is available. */
export interface ValidationRecipeBindingInput {
  prepared: PreparedValidationRecipe;
  candidateCommit: string;
  baselineCommit?: string;
}

/**
 * Candidate-independent validation program.
 *
 * Commands and repository snapshot identity are authoritative here. Binding a
 * candidate must not re-resolve either from a second source.
 */
export interface PreparedValidationRecipe {
  schemaVersion: 1;
  templateId: string;
  /** Compatibility alias for callers that refer to the prepared program. */
  programId: string;
  validationContract: { id: string; revision: string };
  repositorySnapshotId: string;
  steps: ValidationRecipeStep[];
  unmaterializedObligationIds: string[];
}

export interface ValidationRecipe extends PreparedValidationRecipe {
  recipeId: string;
  candidateCommit: string;
  baselineCommit?: string;
}

export function prepareValidationRecipe(input: ValidationRecipePreparationInput): PreparedValidationRecipe {
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
    assertSafeSelectors(selectors);
    const command = { command: capability.command, args: [...capability.args, ...selectors], timeoutMs: 60_000, cwd: "worktree" as const };
    const commandDigest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const evidenceKind = evidenceKindForBinding(obligation.evidence);
    const attribution: ValidationRecipeAttribution = {
      obligationId: obligation.id,
      criterionId: obligation.criterionId,
      evidenceKind,
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
  const templateIdentity = JSON.stringify({
    contract: { id: input.contract.id, revision: input.contract.revision },
    snapshot: input.repositorySnapshotId,
    steps,
    unmaterializedObligationIds
  });
  const templateId = `template-${createHash("sha256").update(templateIdentity).digest("hex").slice(0, 16)}`;
  return {
    schemaVersion: 1,
    templateId,
    // Keep one canonical prepared identity while supporting both vocabulary
    // names during the transition to prepare/bind.
    programId: templateId,
    validationContract: { id: input.contract.id, revision: input.contract.revision },
    repositorySnapshotId: input.repositorySnapshotId,
    steps,
    unmaterializedObligationIds
  };
}

export function bindValidationRecipe(input: ValidationRecipeBindingInput): ValidationRecipe;
export function bindValidationRecipe(
  prepared: PreparedValidationRecipe,
  input: Omit<ValidationRecipeBindingInput, "prepared">
): ValidationRecipe;
export function bindValidationRecipe(
  input: ValidationRecipeBindingInput | PreparedValidationRecipe,
  binding?: Omit<ValidationRecipeBindingInput, "prepared">
): ValidationRecipe {
  const resolved = "prepared" in input
    ? input
    : { prepared: input, ...(binding ?? {}) };
  if (resolved.candidateCommit === undefined) {
    throw new Error("Cannot bind a validation recipe without a candidate commit.");
  }
  const identity = JSON.stringify({
    templateId: resolved.prepared.templateId,
    candidate: resolved.candidateCommit,
    baseline: resolved.baselineCommit
  });
  const prepared = clonePreparedRecipe(resolved.prepared);
  return {
    ...prepared,
    recipeId: `recipe-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
    candidateCommit: resolved.candidateCommit,
    ...(resolved.baselineCommit !== undefined ? { baselineCommit: resolved.baselineCommit } : {})
  };
}

/** Backward-compatible one-shot API. */
export function compileValidationRecipe(input: {
  contract: ValidationContract;
  capabilities: RepositoryCapabilities;
  repositorySnapshotId: string;
  candidateCommit: string;
  baselineCommit?: string;
}): ValidationRecipe {
  return bindValidationRecipe({
    prepared: prepareValidationRecipe({
      contract: input.contract,
      capabilities: input.capabilities,
      repositorySnapshotId: input.repositorySnapshotId
    }),
    candidateCommit: input.candidateCommit,
    ...(input.baselineCommit !== undefined ? { baselineCommit: input.baselineCommit } : {})
  });
}

function clonePreparedRecipe(recipe: PreparedValidationRecipe): PreparedValidationRecipe {
  return {
    ...recipe,
    steps: recipe.steps.map((step) => ({
      ...step,
      command: { ...step.command, args: [...step.command.args] },
      ...(step.attributions === undefined
        ? {}
        : { attributions: step.attributions.map((attribution) => ({ ...attribution, references: [...attribution.references] })) })
    })),
    unmaterializedObligationIds: [...recipe.unmaterializedObligationIds]
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

/** Selectors become subprocess arguments, so they must name candidates inside the worktree. */
function assertSafeSelectors(selectors: readonly string[]): void {
  for (const selector of selectors) {
    const normalized = selector.replaceAll("\\", "/");
    if (
      selector.trim() !== selector ||
      normalized.startsWith("/") ||
      normalized.startsWith("-") ||
      /^[A-Za-z]:/u.test(normalized) ||
      normalized.split("/").includes("..") ||
      /[\u0000-\u001f]/u.test(selector)
    ) {
      throw new Error(`Unsafe validation selector: ${JSON.stringify(selector)}.`);
    }
  }
}
