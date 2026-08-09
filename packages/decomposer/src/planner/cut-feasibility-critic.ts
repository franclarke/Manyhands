import type { RepositoryEvidence } from "./schema.js";
import type { CutProposal, UnitProposal } from "./recursive-planner.js";

export interface CutFeasibilityReviewInput {
  parent: UnitProposal;
  proposal: CutProposal;
  evidence: readonly RepositoryEvidence[];
}

export type CutFeasibilityReview =
  | { ok: true }
  | { ok: false; issues: string[] };

/**
 * Optional seam for checks that need repository semantics but must not mutate
 * the proposed cut. Deterministic shape/lineage checks run before this seam.
 */
export interface CutFeasibilityCriticPort {
  review(input: CutFeasibilityReviewInput): CutFeasibilityReview | Promise<CutFeasibilityReview>;
}

/**
 * Conservative default critic. Only structured `requiredPaths` are write
 * obligations. Paths mentioned in prose may instead be read-only evidence or
 * protected regression tests, so inferring mutation authority from prose both
 * rejects valid cuts and can encourage an agent to rewrite its oracle.
 */
export class CutFeasibilityCritic implements CutFeasibilityCriticPort {
  review(input: CutFeasibilityReviewInput): CutFeasibilityReview {
    const issues: string[] = [];
    for (const criterion of input.parent.criteria) {
      const contributors = input.proposal.children.filter((child) => child.criterionIds?.includes(criterion.id));
      if (contributors.length === 0) continue;
      const contributorWrites = unique(contributors.flatMap((child) => child.writes));
      const requiredPaths = unique(criterion.requiredPaths ?? []);
      for (const requiredPath of requiredPaths) {
        if (contributorWrites.some((written) => normalize(written) === normalize(requiredPath))) continue;
        issues.push(
          `criterion_unimplementable: criterion ${criterion.id} requires write path ${requiredPath}; its contributing children write ${format(contributorWrites)}.`
        );
      }
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function format(paths: readonly string[]): string {
  return paths.length === 0 ? "an empty write set" : paths.join(", ");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
