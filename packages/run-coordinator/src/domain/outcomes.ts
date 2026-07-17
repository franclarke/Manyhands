import { z } from "zod";

export const RunOutcomesSchema = z.object({
  execution: z.enum(["pending", "succeeded", "failed", "interrupted"]),
  artifact: z.enum(["missing", "candidate", "verified", "unverified", "failed"]),
  delivery: z.enum(["not_started", "ready", "published", "failed"])
}).strict();

export type RunOutcomes = z.infer<typeof RunOutcomesSchema>;

export const INITIAL_RUN_OUTCOMES: RunOutcomes = {
  execution: "pending",
  artifact: "missing",
  delivery: "not_started"
};

export const DeliveryReceiptSchema = z.object({
  receiptId: z.string().min(1),
  requestFingerprint: z.string().min(1).optional(),
  manifestId: z.string().min(1),
  finalSha: z.string().min(1).optional(),
  targetBranch: z.string().min(1).optional(),
  targetHeadBefore: z.string().min(1).optional(),
  targetHeadAfter: z.string().min(1).optional(),
  disposition: z.enum(["delivered", "conflict", "failed"]).optional(),
  destination: z.string().min(1).optional(),
  confirmed: z.boolean()
}).strict();

export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;

export interface FinalCandidate {
  manifestId: string;
  commit: string;
  evidenceMatrixId: string;
  sourceTargetFingerprint: string;
  targetBranch: string;
  targetHead: string;
  evidenceEligible: true;
}

export const DeliveryApprovalSchema = z.object({
  manifestId: z.string().min(1),
  finalSha: z.string().min(1),
  targetBranch: z.string().min(1),
  targetHead: z.string().min(1),
  targetFingerprint: z.string().min(1),
  actor: z.string().min(1),
  idempotencyKey: z.string().min(1)
}).strict();
export type DeliveryApproval = z.infer<typeof DeliveryApprovalSchema>;
