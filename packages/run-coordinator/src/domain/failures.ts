import { EntityIdSchema } from "@manyhands/shared";
import { z } from "zod";

export const FailureClassSchema = z.enum([
  "transient",
  "environment_auth_executor",
  "code_test",
  "contract_decomposition",
  "undeclared_artifact",
  "upstream_artifact_unusable",
  "scope_unexpected_commit",
  "integration",
  "shared_infrastructure",
  "environment_workspace",
  /**
   * The classifier could not attribute this failure. It is a named outcome, not
   * a default: the alternative was to fall through to `code_test`, which claims
   * the agent's code was wrong and sends the run into `repair_code` — burning an
   * attempt repairing something that was never broken, and corrupting the
   * failure statistics with a cause that was never observed.
   */
  "unclassified"
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

export const FailureObservationSchema = z.object({
  source: z.enum(["executor", "validation", "planning", "artifact", "scope", "integration"]),
  code: z.string().min(1).optional(),
  artifactId: EntityIdSchema.optional(),
  producerNodeId: EntityIdSchema.optional(),
  exitCode: z.number().int().optional(),
  timedOut: z.boolean().optional(),
  message: z.string().optional()
}).strict();
export type FailureObservation = z.infer<typeof FailureObservationSchema>;

const ENVIRONMENT_CODES = new Set(["auth", "quota", "binary_missing", "executor_unavailable", "model_not_found"]);
const CONTRACT_CODES = new Set(["invalid_contract", "invalid_decomposition", "contract_mismatch"]);
const SHARED_CODES = new Set(["shared_config_broken", "repository_unavailable", "package_manager_broken", "worktree_pool_unavailable"]);
const WORKSPACE_CODES = new Set(["workspace_ref_rejected"]);

export function classifyFailure(raw: FailureObservation): FailureClass {
  const observation = FailureObservationSchema.parse(raw);
  if (observation.source === "scope" || observation.code === "scope_violation" || observation.code === "unexpected_commit") return "scope_unexpected_commit";
  if (observation.source === "artifact" && observation.code === "undeclared_artifact") return "undeclared_artifact";
  if (observation.source === "artifact" && observation.code === "artifact_empty") return "upstream_artifact_unusable";
  if (observation.source === "integration") return "integration";
  if (observation.code !== undefined && SHARED_CODES.has(observation.code)) return "shared_infrastructure";
  if (observation.code !== undefined && WORKSPACE_CODES.has(observation.code)) return "environment_workspace";
  if (observation.source === "planning" || (observation.code !== undefined && CONTRACT_CODES.has(observation.code))) return "contract_decomposition";
  if (observation.source === "executor" && (observation.timedOut === true || observation.code === "transient" || observation.code === "network")) return "transient";
  if (observation.code !== undefined && ENVIRONMENT_CODES.has(observation.code)) return "environment_auth_executor";
  // Validation is the one source whose unmodelled failures ARE about the code:
  // a check ran against the candidate and did not pass. Everywhere else an
  // unrecognised failure is exactly that, and says so.
  if (observation.source === "validation") return "code_test";
  return observation.code === undefined && observation.source === "executor" ? "code_test" : "unclassified";
}
