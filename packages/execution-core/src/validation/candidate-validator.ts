import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ValidationObligation } from "@manyhands/contracts";
import { buildEvidenceMatrix, type EvidenceMatrix, type ValidationEvidenceObservation } from "./evidence-matrix";
import type { ValidationRecipe, ValidationRecipeAttribution, ValidationRecipeStep } from "./recipe-compiler";
import { compareBaselineResult } from "./baseline";
import type { GitRunner } from "../git/runner";
import type { ExecutionWorkspaceProvider } from "../worktree/execution-workspace";
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

/**
 * A validation sandbox is a workspace like any other: a checkout of one exact
 * commit, used once, thrown away.
 *
 * It used to come from `WorktreeManager`, which meant every sandbox took the
 * cross-process topology lease for a worktree nobody else could want, and filed
 * it under a synthesised run id that `gcRun` would never walk — so a crash
 * mid-validation orphaned it permanently. Going through the shared provider
 * fixes both, and leaves the manager with no productive caller.
 *
 * The provider instance must be shared with the rest of the run: its serialised
 * access to the repository's worktree metadata only holds across the callers
 * that share it.
 */
export class GitCandidateSandboxFactory {
  constructor(
    private readonly git: GitRunner,
    private readonly workspaces: ExecutionWorkspaceProvider,
    private readonly runId: string,
    /** Distinguishes concurrent sandboxes of one run in paths and traces. */
    private readonly purpose: string = "validation"
  ) {}

  async create(input: { candidateCommit: string }): Promise<CandidateSandbox> {
    const handle = await this.workspaces.acquire({
      taskId: `${this.purpose}-${input.candidateCommit.slice(0, 12)}`,
      runId: this.runId,
      kind: "integration",
      baseCommit: input.candidateCommit
    });
    const worktreePath = handle.worktree.path;
    const headCommit = await this.git.head(worktreePath);
    const clean = (await this.git.statusPorcelain(worktreePath)).length === 0;
    return {
      worktreePath,
      headCommit,
      clean,
      // Always a discard: a sandbox proves things about a commit that already
      // exists, so it never has a candidate of its own to anchor.
      dispose: async () => { await handle.release({ kind: "discard" }); }
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
      const attributions = attributionsOf(step);
      const first = await timedRun(() => dependencies.run(step, sandbox));
      evidence.push(...attributions.map((attribution) => observation(step, attribution, first, 1)));
      if (!first.passed) {
        const retry = await timedRun(() => dependencies.run(step, sandbox));
        evidence.push(...attributions.map((attribution) => observation(step, attribution, retry, 2)));
      }
      const finals = attributions.map((attribution) => evidence.filter((item) => item.obligationId === attribution.obligationId).at(-1)!);
      if (attributions.some((attribution) => attribution.baselinePolicy !== "not_required") && input.recipe.baselineCommit !== undefined && dependencies.runBaseline !== undefined && dependencies.createBaselineSandbox !== undefined) {
        const baseline = await dependencies.runBaseline(step, await ensureBaselineSandbox(input.recipe.baselineCommit));
        for (const [index, attribution] of attributions.entries()) {
          if (attribution.baselinePolicy === "not_required") continue;
          finals[index]!.baselineDisposition = compareBaselineResult({ baselinePassed: baseline.passed && baseline.exitCode === 0, candidatePassed: finals[index]!.passed });
        }
      }
      const controlled = attributions
        .map((attribution, index) => ({ attribution, final: finals[index]! }))
        .filter(({ attribution, final }) => final.passed && attribution.negativeControl !== "not_required");
      if (controlled.length > 0 && dependencies.runNegativeControl !== undefined) {
        const control = await dependencies.runNegativeControl(step, sandbox);
        for (const { attribution, final } of controlled) {
          final.negativeControl = {
            evidenceId: `${attribution.obligationId}:negative-control`,
            obligationId: attribution.obligationId,
            detectedFailure: control.detectedFailure,
            outputDigest: createHash("sha256").update(control.output).digest("hex")
          };
        }
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

const EVIDENCE_VALIDATION_POLICY_VERSION = 3;

function evidenceCacheKey(recipeId: string, integrityFindings: readonly TestIntegrityFinding[]): string {
  const identity = JSON.stringify({
    recipeId,
    evidenceValidationPolicyVersion: EVIDENCE_VALIDATION_POLICY_VERSION,
    testIntegrityDetectorVersion: TEST_INTEGRITY_DETECTOR_VERSION,
    integrityFindings
  });
  return `evidence-${createHash("sha256").update(identity).digest("hex")}`;
}

function observation(
  step: ValidationRecipeStep,
  attribution: ValidationRecipeAttribution,
  run: { passed: boolean; exitCode: number; output: string; durationMs: number },
  attempt: number
): ValidationEvidenceObservation {
  return {
    evidenceId: `${stepIdentity(step)}:attempt:${attempt}`,
    obligationId: attribution.obligationId,
    criterionId: attribution.criterionId,
    kind: attribution.evidenceKind,
    passed: run.passed && run.exitCode === 0,
    attempt,
    commandDigest: commandDigest(step),
    durationMs: run.durationMs,
    references: [...attribution.references],
    output: run.output
  };
}

function attributionsOf(step: ValidationRecipeStep): ValidationRecipeAttribution[] {
  return step.attributions ?? [{
    obligationId: step.obligationId,
    criterionId: step.criterionId,
    evidenceKind: step.evidenceKind,
    baselinePolicy: step.baselinePolicy,
    negativeControl: step.negativeControl,
    flakyPolicy: step.flakyPolicy,
    references: [],
    rationale: "Legacy recipe attribution."
  }];
}

function commandDigest(step: ValidationRecipeStep): string {
  return step.commandDigest ?? createHash("sha256").update(JSON.stringify(step.command)).digest("hex");
}

function stepIdentity(step: ValidationRecipeStep): string {
  return `command-${commandDigest(step)}`;
}

async function timedRun(
  run: () => Promise<{ passed: boolean; exitCode: number; output: string }>
): Promise<{ passed: boolean; exitCode: number; output: string; durationMs: number }> {
  const startedAt = performance.now();
  const result = await run();
  return { ...result, durationMs: Math.max(0, performance.now() - startedAt) };
}
