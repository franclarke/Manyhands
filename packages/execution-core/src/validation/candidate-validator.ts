import { createHash } from "node:crypto";
import type { ValidationObligation } from "@manyhands/contracts";
import { buildEvidenceMatrix, type EvidenceMatrix, type ValidationEvidenceObservation } from "./evidence-matrix";
import type { ValidationRecipe, ValidationRecipeStep } from "./recipe-compiler";
import { compareBaselineResult } from "./baseline";
import type { GitRunner } from "../git/runner";
import type { WorktreeManager } from "../worktree/manager";
import { TEST_INTEGRITY_DETECTOR_VERSION, type TestIntegrityFinding } from "./test-integrity";

export interface CandidateSandbox {
  worktreePath: string;
  headCommit: string;
  clean: boolean;
  dispose(): Promise<void>;
}

export interface ExactCandidateValidationResult {
  candidateCommit: string;
  evidence: ValidationEvidenceObservation[];
  matrix: EvidenceMatrix;
}

/**
 * Evidence for a candidate is a pure function of the compiled recipe (which binds
 * the exact candidate commit, validation contract, snapshot and steps). Reusing a
 * cached matrix for an identical recipe — a delivery re-validation, a recovery
 * replay, a retry that reproduced the same candidate — avoids re-opening a sandbox
 * and re-running checks. It never turns a negative result positive: the whole
 * matrix, including failed/flaky evidence, is stored and returned verbatim.
 */
export interface EvidenceValidationCache {
  get(recipeId: string): Promise<ExactCandidateValidationResult | undefined>;
  set(recipeId: string, result: ExactCandidateValidationResult): Promise<void>;
}

export class InMemoryEvidenceValidationCache implements EvidenceValidationCache {
  private readonly entries = new Map<string, ExactCandidateValidationResult>();
  async get(recipeId: string): Promise<ExactCandidateValidationResult | undefined> { return this.entries.get(recipeId); }
  async set(recipeId: string, result: ExactCandidateValidationResult): Promise<void> { this.entries.set(recipeId, result); }
}

export interface CandidateValidatorDependencies {
  sandbox: { create(input: { candidateCommit: string }): Promise<CandidateSandbox> };
  run(step: ValidationRecipeStep, sandbox: CandidateSandbox): Promise<{ passed: boolean; exitCode: number; output: string }>;
  /** Opens the baseline worktree once; the orchestrator reuses it across obligations. */
  createBaselineSandbox?(baselineCommit: string): Promise<CandidateSandbox>;
  runBaseline?(step: ValidationRecipeStep, sandbox: CandidateSandbox): Promise<{ passed: boolean; exitCode: number; output: string }>;
  runNegativeControl?(step: ValidationRecipeStep, sandbox: CandidateSandbox): Promise<{ detectedFailure: boolean; output: string }>;
  cache?: EvidenceValidationCache;
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
  input: { recipe: ValidationRecipe; obligations: ValidationObligation[]; notApplicableObligationIds?: string[]; integrityFindings?: TestIntegrityFinding[] },
  dependencies: CandidateValidatorDependencies
): Promise<ExactCandidateValidationResult> {
  const cacheKey = evidenceCacheKey(input.recipe.recipeId, input.integrityFindings ?? []);
  const cached = await dependencies.cache?.get(cacheKey);
  if (cached !== undefined) return cached;
  const sandbox = await dependencies.sandbox.create({ candidateCommit: input.recipe.candidateCommit });
  // Opened lazily on the first baseline obligation and reused for the rest, then
  // disposed once — never one worktree per obligation.
  let baselineSandbox: CandidateSandbox | undefined;
  const ensureBaselineSandbox = async (baselineCommit: string): Promise<CandidateSandbox> => {
    if (baselineSandbox === undefined) baselineSandbox = await dependencies.createBaselineSandbox!(baselineCommit);
    return baselineSandbox;
  };
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
      if (step.baselinePolicy !== "not_required" && input.recipe.baselineCommit !== undefined && dependencies.runBaseline !== undefined && dependencies.createBaselineSandbox !== undefined) {
        const baseline = await dependencies.runBaseline(step, await ensureBaselineSandbox(input.recipe.baselineCommit));
        final.baselineDisposition = compareBaselineResult({ baselinePassed: baseline.passed && baseline.exitCode === 0, candidatePassed: final.passed });
      }
      if (final.passed && step.negativeControl !== "not_required" && dependencies.runNegativeControl !== undefined) {
        const control = await dependencies.runNegativeControl(step, sandbox);
        final.negativeControl = {
          evidenceId: `${step.obligationId}:negative-control`,
          obligationId: step.obligationId,
          detectedFailure: control.detectedFailure,
          outputDigest: createHash("sha256").update(control.output).digest("hex")
        };
      }
    }
    const result: ExactCandidateValidationResult = {
      candidateCommit: input.recipe.candidateCommit,
      evidence,
      matrix: buildEvidenceMatrix({ obligations: input.obligations, evidence, ...(input.notApplicableObligationIds !== undefined ? { notApplicableObligationIds: input.notApplicableObligationIds } : {}), ...(input.integrityFindings !== undefined ? { integrityFindings: input.integrityFindings } : {}) })
    };
    await dependencies.cache?.set(cacheKey, result);
    return result;
  } finally {
    const cleanups: Array<() => Promise<void>> = [() => sandbox.dispose()];
    if (baselineSandbox !== undefined) {
      const baselineToDispose = baselineSandbox;
      cleanups.push(() => baselineToDispose.dispose());
    }
    const results = await Promise.allSettled(cleanups.map(async (cleanup) => cleanup()));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Multiple validation sandboxes failed cleanup.");
  }
}

const EVIDENCE_VALIDATION_POLICY_VERSION = 2;

function evidenceCacheKey(recipeId: string, integrityFindings: readonly TestIntegrityFinding[]): string {
  const identity = JSON.stringify({
    recipeId,
    evidenceValidationPolicyVersion: EVIDENCE_VALIDATION_POLICY_VERSION,
    testIntegrityDetectorVersion: TEST_INTEGRITY_DETECTOR_VERSION,
    integrityFindings
  });
  return `evidence-${createHash("sha256").update(identity).digest("hex")}`;
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
