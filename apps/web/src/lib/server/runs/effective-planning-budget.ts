import { createHash } from "node:crypto";
import { z } from "zod";
import { updateRunForOperation } from "./run-operation-lease";
import type { PlanningBudgetInput, RunOperationLease, RunRecord } from "./schema";

const PlanningBudgetSchema = z.object({
  version: z.literal(1).default(1),
  maxPlanningDurationMs: z.number().int().positive().default(15 * 60_000),
  maxIndexDurationMs: z.number().int().positive().default(60_000),
  maxIndexedFiles: z.number().int().positive().default(20_000),
  maxIndexBytes: z.number().int().positive().default(64 * 1024 * 1024),
  maxIndexedFileBytes: z.number().int().positive().default(2 * 1024 * 1024),
  maxIndexedSymbols: z.number().int().positive().default(100_000),
  maxIndexedImports: z.number().int().positive().default(100_000),
  maxIndexedExports: z.number().int().positive().default(100_000),
  maxDecomposerCalls: z.number().int().positive().default(500),
  maxCriticCalls: z.number().int().positive().default(2),
  maxPlanningNodes: z.number().int().positive().default(500),
  maxPlanningDepth: z.number().int().positive().default(8),
  maxChildrenPerNode: z.number().int().positive().default(24),
  maxPromptBytes: z.number().int().positive().default(128 * 1024),
  maxPlanningConcurrency: z.number().int().positive().default(3),
  maxOutputBytes: z.number().int().positive().default(65_536)
});

export type EffectivePlanningBudget = z.infer<typeof PlanningBudgetSchema>;

/** One normalization boundary; legacy records are explicitly upgraded on their first planning attempt. */
export function effectivePlanningBudget(input: PlanningBudgetInput | undefined): EffectivePlanningBudget {
  return PlanningBudgetSchema.parse(input ?? {});
}

export function planningBudgetFingerprint(budget: EffectivePlanningBudget): string {
  return createHash("sha256").update(JSON.stringify(budget)).digest("hex");
}

export function persistEffectivePlanningBudget(runId: string, lease?: RunOperationLease): Promise<RunRecord> {
  return updateRunForOperation(runId, lease, (current) => ({
    ...current,
    planningBudget: effectivePlanningBudget(current.planningBudget)
  }));
}
