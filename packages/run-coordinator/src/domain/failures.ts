import { z } from "zod";

export const FailureClassSchema = z.enum([
  "transient",
  "environment_auth_executor",
  "code_test",
  "contract_decomposition",
  "undeclared_artifact",
  "scope_unexpected_commit",
  "integration",
  "shared_infrastructure"
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

export const FailureObservationSchema = z.object({
  source: z.enum(["executor", "validation", "planning", "artifact", "scope", "integration"]),
  code: z.string().min(1).optional(),
  exitCode: z.number().int().optional(),
  timedOut: z.boolean().optional(),
  message: z.string().optional()
}).strict();
export type FailureObservation = z.infer<typeof FailureObservationSchema>;

const ENVIRONMENT_CODES = new Set(["auth", "quota", "binary_missing", "executor_unavailable", "model_not_found"]);
const CONTRACT_CODES = new Set(["invalid_contract", "invalid_decomposition", "contract_mismatch"]);
const SHARED_CODES = new Set(["shared_config_broken", "repository_unavailable", "package_manager_broken", "worktree_pool_unavailable"]);

export function classifyFailure(raw: FailureObservation): FailureClass {
  const observation = FailureObservationSchema.parse(raw);
  if (observation.source === "scope" || observation.code === "scope_violation" || observation.code === "unexpected_commit") return "scope_unexpected_commit";
  if (observation.source === "artifact" && observation.code === "undeclared_artifact") return "undeclared_artifact";
  if (observation.source === "integration") return "integration";
  if (observation.code !== undefined && SHARED_CODES.has(observation.code)) return "shared_infrastructure";
  if (observation.source === "planning" || (observation.code !== undefined && CONTRACT_CODES.has(observation.code))) return "contract_decomposition";
  if (observation.source === "executor" && (observation.timedOut === true || observation.code === "transient" || observation.code === "network")) return "transient";
  if (observation.code !== undefined && ENVIRONMENT_CODES.has(observation.code)) return "environment_auth_executor";
  return "code_test";
}
