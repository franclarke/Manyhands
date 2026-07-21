import { createHash } from "node:crypto";

import type { TaskContractBundle } from "@manyhands/contracts";
import type { RepositorySnapshot } from "@manyhands/repository-index";

import type { GitRunner } from "../git/runner";
import { GitCandidateSandboxFactory, validateExactCandidate, type EvidenceValidationCache } from "../validation/candidate-validator";
import { compileValidationRecipe } from "../validation/recipe-compiler";
import { ChildProcessValidationRunner, type ValidationRunner } from "../validation/runner";
import type { WorktreeManager } from "../worktree/manager";
import type { V2ExecutionEvidenceMatrix, V2NodeValidationPort } from "./node-executor";

export interface ExactCandidateValidatorV2Options {
  git: GitRunner;
  worktrees: WorktreeManager;
  repoRoot: string;
  repositorySnapshot: RepositorySnapshot;
  runner?: ValidationRunner;
  operationId?: string;
  evidenceCache?: EvidenceValidationCache;
}

/** Runs the compiled obligations in isolated worktrees at the exact candidate and baseline SHAs. */
export class ExactCandidateValidatorV2 implements V2NodeValidationPort {
  private readonly runner: ValidationRunner;

  constructor(private readonly options: ExactCandidateValidatorV2Options) {
    this.runner = options.runner ?? new ChildProcessValidationRunner();
  }

  async validate(input: {
    runId: string;
    attemptId: string;
    contract: TaskContractBundle;
    candidateCommit: string;
    baselineCommit: string;
    signal?: AbortSignal;
  }): Promise<V2ExecutionEvidenceMatrix> {
    const recipe = compileValidationRecipe({
      contract: input.contract.validation,
      capabilities: this.options.repositorySnapshot.capabilities,
      repositorySnapshotId: this.options.repositorySnapshot.snapshotId,
      candidateCommit: input.candidateCommit,
      baselineCommit: input.baselineCommit
    });
    const candidateSandbox = new GitCandidateSandboxFactory(
      this.options.git,
      this.options.worktrees,
      `${input.runId}-${input.attemptId}-candidate`
    );
    const supervision = {
      runId: input.runId,
      ...(this.options.operationId !== undefined ? { operationId: this.options.operationId } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {})
    };
    const validated = await validateExactCandidate({
      recipe,
      obligations: input.contract.validation.obligations
    }, {
      sandbox: candidateSandbox,
      ...(this.options.evidenceCache !== undefined ? { cache: this.options.evidenceCache } : {}),
      run: async (step, sandbox) => this.runner.run([step.command], {
        worktreePath: sandbox.worktreePath,
        repoRoot: this.options.repoRoot,
        supervision
      }),
      // One baseline worktree for the whole candidate, reused across obligations
      // by the orchestrator, rather than a fresh worktree per obligation.
      createBaselineSandbox: async (baselineCommit) => new GitCandidateSandboxFactory(
        this.options.git,
        this.options.worktrees,
        `${input.runId}-${input.attemptId}-baseline`
      ).create({ candidateCommit: baselineCommit }),
      runBaseline: async (step, baselineSandbox) => this.runner.run([step.command], {
        worktreePath: baselineSandbox.worktreePath,
        repoRoot: this.options.repoRoot,
        supervision
      })
    });
    const identity = JSON.stringify({
      candidateCommit: validated.candidateCommit,
      validationContract: input.contract.task.validation,
      criteria: validated.matrix.criteria,
      outcome: validated.matrix.outcome
    });
    return {
      matrixId: `matrix-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
      candidateCommit: validated.candidateCommit,
      validationContract: { ...input.contract.task.validation },
      criteria: validated.matrix.criteria.map((criterion) => ({ ...criterion, evidenceRefs: [...criterion.evidenceRefs] })),
      outcome: validated.matrix.outcome
    };
  }
}
