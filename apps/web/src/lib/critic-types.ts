/**
 * Single source of truth for the deterministic-critic shapes. The plan critic
 * (`plan-critic.ts`) produces them, the API surface (`api-types.ts`) exposes
 * them, and `schema.ts` validates them with a matching zod schema. Optionals are
 * `| undefined` so they stay assignable from the zod-inferred persisted type
 * under `exactOptionalPropertyTypes`.
 */

export type CriticSeverity = "error" | "warning" | "info";
export type CriticStatus = "clean" | "warnings" | "errors";

export interface CriticFinding {
  severity: CriticSeverity;
  code: string;
  taskId?: string | undefined;
  message: string;
  suggestion?: string | undefined;
}

export interface PlanCriticResult {
  status: CriticStatus;
  findings: CriticFinding[];
  generatedAt: string;
}

export interface SeamCriticResult {
  status: CriticStatus;
  seamCount: number;
  findings: CriticFinding[];
  generatedAt: string;
}
