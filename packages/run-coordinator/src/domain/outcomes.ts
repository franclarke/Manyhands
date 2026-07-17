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
  manifestId: z.string().min(1),
  destination: z.string().min(1),
  confirmed: z.boolean()
}).strict();

export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;

export interface FinalCandidate {
  manifestId: string;
  commit: string;
  evidenceEligible: true;
}
