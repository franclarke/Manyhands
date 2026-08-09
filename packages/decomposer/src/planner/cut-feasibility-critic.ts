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
 * Conservative default critic. A criterion can make a path obligation
 * explicit by naming one of the parent's grounded paths in its description.
 * The child that owns that criterion must then write the path. Criteria with
 * no explicit path remain the model's semantic responsibility.
 */
export class CutFeasibilityCritic implements CutFeasibilityCriticPort {
  review(input: CutFeasibilityReviewInput): CutFeasibilityReview {
    const groundedPaths = unique([
      ...input.parent.reads,
      ...input.parent.writes,
      ...input.evidence.filter((item) => item.kind === "path").map((item) => item.reference)
    ]);
    const issues: string[] = [];
    for (const child of input.proposal.children) {
      for (const criterionId of child.criterionIds ?? []) {
        const criterion = input.parent.criteria.find((candidate) => candidate.id === criterionId);
        if (criterion === undefined) continue;
        const requiredPaths = groundedPaths.filter((candidate) => mentionsPath(criterion.description, candidate));
        for (const requiredPath of requiredPaths) {
          if (child.writes.some((written) => normalize(written) === normalize(requiredPath))) continue;
          issues.push(
            `criterion_unimplementable: criterion ${criterionId} requires write path ${requiredPath}; child ${child.key} writes ${format(child.writes)}.`
          );
        }
      }
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }
}

function mentionsPath(description: string, candidate: string): boolean {
  return normalize(description).includes(normalize(candidate));
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
