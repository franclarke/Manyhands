import { z } from "zod";

import type { DecisionInput } from "./decisions.js";

/**
 * How much of a run the operator delegated when they started it.
 *
 * The axis is reversibility, not confidence. A supervised run answers nothing
 * on its own. A semi-automatic run moves the graph forward — approving the plan
 * it compiled, retrying a conflict — but every one of those acts stays inside
 * the run's own workspace and can be discarded by throwing the run away. An
 * autonomous run additionally publishes: it moves a ref other people pull, and
 * that is the one act no later decision can take back.
 */
export const AutonomyLevelSchema = z.enum(["supervised", "semi", "autonomous"]);

export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

/**
 * What a run means when it says nothing. Every journal written before this
 * existed omits the field, and folding one has to mean "nobody delegated
 * anything" rather than a guess about what the operator would have wanted.
 */
export const DEFAULT_AUTONOMY: AutonomyLevel = "supervised";

/**
 * The authorization a decision was resolved under, recorded on the resolution.
 *
 * Absent means a person answered. A journal that cannot tell the two apart
 * loses the fact an auditor most needs, because "the plan was approved" and
 * "the plan was approved by a standing delegation the operator gave at intake"
 * are different claims about the run.
 */
export const StandingAuthorizationSchema = z.object({
  kind: z.literal("autonomy_policy"),
  level: AutonomyLevelSchema
}).strict();

export type StandingAuthorization = z.infer<typeof StandingAuthorizationSchema>;

export function standingAuthorization(level: AutonomyLevel): StandingAuthorization {
  return { kind: "autonomy_policy", level };
}

export function runAutonomy(
  definition: { autonomy?: AutonomyLevel | undefined } | undefined
): AutonomyLevel {
  return definition?.autonomy ?? DEFAULT_AUTONOMY;
}

/**
 * The option each kind of decision is answered with when it is delegated at
 * all. `clarify_goal` is deliberately absent: that decision exists because the
 * answer could not be derived from the repository or the goal, so deriving one
 * anyway would be exactly the invented domain state this system refuses.
 */
const DELEGATED_OPTION: Partial<Record<DecisionInput["kind"], string>> = {
  approve_plan: "approve",
  approve_amendment: "approve",
  resolve_conflict: "retry",
  approve_delivery: "approve"
};

const DELEGATED_KINDS: Record<AutonomyLevel, readonly DecisionInput["kind"][]> = {
  supervised: [],
  semi: ["approve_plan", "approve_amendment", "resolve_conflict"],
  autonomous: ["approve_plan", "approve_amendment", "resolve_conflict", "approve_delivery"]
};

/**
 * The option this authorization answers the decision with, or `undefined` when
 * only a person can answer it.
 *
 * The option has to be one the decision actually offered. Answering with an
 * option that is not on the decision would be the policy inventing a choice
 * the run never presented, and the reducer would reject it anyway; failing
 * here means the run parks for a human instead of throwing.
 */
export function autonomyResolution(
  level: AutonomyLevel,
  decision: Pick<DecisionInput, "kind" | "options">
): string | undefined {
  if (!DELEGATED_KINDS[level].includes(decision.kind)) return undefined;
  const optionId = DELEGATED_OPTION[decision.kind];
  if (optionId === undefined) return undefined;
  return decision.options.some((option) => option.id === optionId) ? optionId : undefined;
}

/** Whether the run may move the target ref without asking again. */
export function autonomyPublishesDelivery(level: AutonomyLevel): boolean {
  return level === "autonomous";
}
