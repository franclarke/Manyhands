export interface FinalCandidatePreparationRequest {
  manifestId: string;
  runId: string;
  integratedCommit: string;
  sourceTargetFingerprint: string;
  targetBranch: string;
  targetHead: string;
}

export interface PreparedCandidate {
  candidateCommit: string;
  candidateRef: string;
  changedFiles: string[];
}

export interface CandidateValidationResult {
  matrixId: string;
  candidateCommit: string;
  eligible: boolean;
}

export interface FinalCandidateManifest extends FinalCandidatePreparationRequest, PreparedCandidate {
  evidenceMatrixId: string;
  evidenceEligible: true;
  preparedAt: string;
}

export interface FinalCandidatePreparerOptions {
  prepare(request: FinalCandidatePreparationRequest): Promise<PreparedCandidate>;
  validate(input: { candidateCommit: string }): Promise<CandidateValidationResult>;
  clock(): string;
}

/**
 * Preparation is deliberately incapable of publishing. It materializes one
 * isolated candidate and accepts it only when validation identifies that exact
 * commit. The returned manifest is therefore safe to project as result_ready.
 */
export class FinalCandidatePreparer {
  constructor(private readonly options: FinalCandidatePreparerOptions) {}

  async prepare(request: FinalCandidatePreparationRequest): Promise<FinalCandidateManifest> {
    const prepared = await this.options.prepare(request);
    const validation = await this.options.validate({ candidateCommit: prepared.candidateCommit });
    if (validation.candidateCommit !== prepared.candidateCommit) {
      throw new Error(`Validation did not examine the exact candidate ${prepared.candidateCommit}.`);
    }
    if (!validation.eligible) {
      throw new Error(`Candidate ${prepared.candidateCommit} is not evidence eligible.`);
    }
    return {
      ...request,
      ...prepared,
      evidenceMatrixId: validation.matrixId,
      evidenceEligible: true,
      preparedAt: this.options.clock()
    };
  }
}
