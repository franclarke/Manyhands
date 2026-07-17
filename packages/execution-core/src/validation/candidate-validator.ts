import type { ValidationObligation } from "@manyhands/contracts";
import { buildEvidenceMatrix, type EvidenceMatrix, type ValidationEvidenceObservation } from "./evidence-matrix";
import type { ValidationRecipe, ValidationRecipeStep } from "./recipe-compiler";
import { compareBaselineResult } from "./baseline";
import type { GitRunner } from "../git/runner";
import { WorktreeManager } from "../worktree/manager";

export interface CandidateSandbox {
  worktreePath: string;
  headCommit: string;
  clean: boolean;
  dispose(): Promise<void>;
}

export interface CandidateValidatorDependencies {
  sandbox: { create(input: { candidateCommit: string }): Promise<CandidateSandbox> };
  run(step: ValidationRecipeStep, sandbox: CandidateSandbox): Promise<{ passed: boolean; exitCode: number; output: string }>;
  runBaseline?(step: ValidationRecipeStep, baselineCommit: string): Promise<{ passed: boolean; exitCode: number; output: string }>;
  runNegativeControl?(step: ValidationRecipeStep, sandbox: CandidateSandbox): Promise<{ detectedFailure: boolean; output: string }>;
}

export class GitCandidateSandboxFactory {
  constructor(
    private readonly git: GitRunner,
    private readonly worktrees: WorktreeManager,
    private readonly runId: string
  ) {}

  async create(input: { candidateCommit: string }): Promise<CandidateSandbox> {
    const record = await this.worktrees.create({
      taskId: `validation-${input.candidateCommit.slice(0, 12)}`,
      runId: this.runId,
      kind: "integration",
      baseCommit: input.candidateCommit
    });
    const headCommit = await this.git.head(record.path);
    const clean = (await this.git.statusPorcelain(record.path)).length === 0;
    return {
      worktreePath: record.path,
      headCommit,
      clean,
      dispose: async () => { await this.worktrees.clean(record); }
    };
  }
}

export async function validateExactCandidate(
  input: { recipe: ValidationRecipe; obligations: ValidationObligation[]; notApplicableObligationIds?: string[]; integrityFindingRefs?: string[] },
  dependencies: CandidateValidatorDependencies
): Promise<{ candidateCommit: string; evidence: ValidationEvidenceObservation[]; matrix: EvidenceMatrix }> {
  const sandbox = await dependencies.sandbox.create({ candidateCommit: input.recipe.candidateCommit });
  try {
    if (sandbox.headCommit !== input.recipe.candidateCommit || !sandbox.clean) throw new Error(`Validation sandbox is not the clean exact candidate ${input.recipe.candidateCommit}.`);
    const evidence: ValidationEvidenceObservation[] = [];
    for (const step of input.recipe.steps) {
      const first = await dependencies.run(step, sandbox);
      evidence.push(observation(step, first, 1));
      if (!first.passed) {
        const retry = await dependencies.run(step, sandbox);
        evidence.push(observation(step, retry, 2));
      }
      const final = evidence.filter((item) => item.obligationId === step.obligationId).at(-1)!;
      if (step.baselinePolicy !== "not_required" && input.recipe.baselineCommit !== undefined && dependencies.runBaseline !== undefined) {
        const baseline = await dependencies.runBaseline(step, input.recipe.baselineCommit);
        final.baselineDisposition = compareBaselineResult({ baselinePassed: baseline.passed && baseline.exitCode === 0, candidatePassed: final.passed });
      }
      if (final.passed && step.negativeControl !== "not_required" && dependencies.runNegativeControl !== undefined) {
        final.negativeControlPassed = (await dependencies.runNegativeControl(step, sandbox)).detectedFailure;
      }
    }
    return {
      candidateCommit: input.recipe.candidateCommit,
      evidence,
      matrix: buildEvidenceMatrix({ obligations: input.obligations, evidence, ...(input.notApplicableObligationIds !== undefined ? { notApplicableObligationIds: input.notApplicableObligationIds } : {}), ...(input.integrityFindingRefs !== undefined ? { integrityFindingRefs: input.integrityFindingRefs } : {}) })
    };
  } finally {
    await sandbox.dispose();
  }
}

function observation(step: ValidationRecipeStep, run: { passed: boolean; exitCode: number; output: string }, attempt: number): ValidationEvidenceObservation {
  return {
    evidenceId: `${step.obligationId}:attempt:${attempt}`,
    obligationId: step.obligationId,
    kind: step.evidenceKind,
    passed: run.passed && run.exitCode === 0,
    attempt,
    output: run.output
  };
}
