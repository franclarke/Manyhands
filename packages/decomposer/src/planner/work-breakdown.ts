import { createHash } from "node:crypto";
import { NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { parseJsonObjectCandidates } from "../llm/recursive/json.js";
import { WorkBreakdownSchema, type WorkBreakdown } from "./schema.js";
import { buildWorkBreakdownPrompt } from "./prompt.js";

export interface PlannerRepositoryEvidence {
  id: string;
  kind: "path" | "symbol" | "script" | "stack" | "diagnostic";
  reference: string;
  observation: string;
  confidence: number;
}

export interface WorkBreakdownPlannerInput {
  goal: string;
  acceptanceCriteria: string[];
  constraints: string[];
  repositorySnapshot: {
    snapshotId: string;
    inspectionDisposition: "complete" | "partial" | "unavailable";
    evidence: PlannerRepositoryEvidence[];
  };
  questionAnswers?: Record<string, string>;
  /** Deterministic C2 feedback requesting a better semantic alternative. */
  granularityFeedback?: GranularityReplanFeedback;
}

export interface GranularityReplanFeedback {
  unitKey: string;
  reason: "leaf_context_infeasible" | "missing_semantic_cut";
  evidence: string[];
}

export interface WorkBreakdownModelRequest {
  system: string;
  user: string;
  attempt: number;
  repairIssues: string[];
  onProgress(unit: WorkBreakdownProgressUnit): Promise<void>;
}

export const WorkBreakdownProgressUnitSchema = z.object({
  key: NonEmptyStringSchema,
  parentKey: NonEmptyStringSchema.nullable(),
  kind: z.enum(["composite", "leaf"]),
  title: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  siblingIndex: z.number().int().nonnegative(),
  siblingCount: z.number().int().positive()
}).strict().superRefine((unit, context) => {
  if (unit.siblingIndex >= unit.siblingCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "siblingIndex must be lower than siblingCount" });
  }
});

export type WorkBreakdownProgressUnit = z.infer<typeof WorkBreakdownProgressUnitSchema>;

export const WorkBreakdownProgressLineSchema = z.object({
  type: z.literal("planning.node"),
  unit: WorkBreakdownProgressUnitSchema
}).strict();

export interface WorkBreakdownPlanningObserver {
  onAttemptStarted?(event: { attempt: number }): void | Promise<void>;
  onUnitDiscovered?(event: { attempt: number; unit: WorkBreakdownProgressUnit }): void | Promise<void>;
  onAttemptFailed?(event: { attempt: number; reason: string }): void | Promise<void>;
}

export interface WorkBreakdownModel {
  generate(request: WorkBreakdownModelRequest): Promise<unknown>;
}

export interface WorkBreakdownCache {
  get(key: string): WorkBreakdown | undefined;
  set(key: string, value: WorkBreakdown): unknown;
}

export interface WorkBreakdownPlannerOptions {
  model: WorkBreakdownModel;
  maxAttempts?: number;
  retryDelayMs?: number;
  cache?: WorkBreakdownCache;
}

/** Signals a transport or protocol failure that another model attempt cannot repair. */
export class NonRetryablePlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryablePlanningError";
  }
}

export class WorkBreakdownPlanner {
  readonly architectureVersion = "v2" as const;
  private readonly model: WorkBreakdownModel;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly cache: WorkBreakdownCache | undefined;

  constructor(options: WorkBreakdownPlannerOptions) {
    this.model = options.model;
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 3, "maxAttempts");
    this.retryDelayMs = nonNegativeInteger(options.retryDelayMs ?? 250, "retryDelayMs");
    this.cache = options.cache;
  }

  async plan(input: WorkBreakdownPlannerInput, observer: WorkBreakdownPlanningObserver = {}): Promise<WorkBreakdown> {
    const cacheKey = planningCacheKey(input);
    const cached = this.cache?.get(cacheKey);
    if (cached !== undefined) {
      const parsedCached = WorkBreakdownSchema.parse(cached);
      if (commandSurfaceIssues(parsedCached, input).length === 0) return parsedCached;
    }

    const prompt = buildWorkBreakdownPrompt(input);
    let repairIssues: string[] = cached === undefined ? [] : commandSurfaceIssues(WorkBreakdownSchema.parse(cached), input);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await observer.onAttemptStarted?.({ attempt });
      const discovered = new Set<string>();
      const reportUnit = async (candidate: WorkBreakdownProgressUnit): Promise<void> => {
        const unit = WorkBreakdownProgressUnitSchema.parse(candidate);
        if (discovered.has(unit.key)) return;
        discovered.add(unit.key);
        await observer.onUnitDiscovered?.({ attempt, unit });
      };
      let nonRetryable = false;
      try {
        const outputs = normalizeModelOutputs(await this.model.generate({ ...prompt, attempt, repairIssues, onProgress: reportUnit }));
        const failures: string[] = [];
        for (const output of outputs) {
          const parsed = WorkBreakdownSchema.safeParse(output);
          if (parsed.success) {
            const groundingIssues = commandSurfaceIssues(parsed.data, input);
            if (groundingIssues.length > 0) {
              failures.push(...groundingIssues);
              continue;
            }
            for (const unit of progressUnits(parsed.data.root)) await reportUnit(unit);
            this.cache?.set(cacheKey, parsed.data);
            return parsed.data;
          }
          failures.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`));
        }
        repairIssues = failures;
      } catch (error) {
        repairIssues = [error instanceof Error ? error.message : String(error)];
        nonRetryable = error instanceof NonRetryablePlanningError;
      }
      await observer.onAttemptFailed?.({ attempt, reason: repairIssues.join("; ") });
      if (nonRetryable) {
        throw new Error(`WorkBreakdown planning stopped after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${repairIssues.join("; ")}`);
      }
      if (attempt < this.maxAttempts && this.retryDelayMs > 0) await delay(this.retryDelayMs);
    }
    throw new Error(`WorkBreakdown planning failed after ${this.maxAttempts} attempts: ${repairIssues.join("; ")}`);
  }
}

function commandSurfaceIssues(breakdown: WorkBreakdown, input: WorkBreakdownPlannerInput): string[] {
  const stubScripts = input.repositorySnapshot.evidence.filter((item) =>
    item.kind === "script" && /\b(?:console\.log|echo)\b/iu.test(item.observation)
  );
  if (stubScripts.length === 0) return [];

  const units = flattenWorkUnits(breakdown.root);
  const introducesImplementation = units.some((unit) =>
    (unit.plannedPaths ?? []).some((candidate) => /\.(?:[cm]?[jt]sx?|css|html)$/iu.test(candidate))
  );
  if (!introducesImplementation) return [];

  const manifestEvidenceIds = new Set(input.repositorySnapshot.evidence
    .filter((item) => item.kind === "path" && /(^|\/)package\.json$/iu.test(item.reference.replaceAll("\\", "/")))
    .map((item) => item.id));
  const manifestGrounded = units.some((unit) => unit.evidenceIds.some((id) => manifestEvidenceIds.has(id)));
  if (manifestGrounded) return [];

  return [
    `command surface: repository validation scripts are stubs (${stubScripts.map((item) => item.reference).join(", ")}); ` +
    "the implementation unit must cite package.json path evidence so its scope can replace those stubs with real checks"
  ];
}

function flattenWorkUnits(root: WorkBreakdown["root"]): WorkBreakdown["root"][] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenWorkUnits)];
}

export function parseWorkBreakdownProgressLine(line: string): WorkBreakdownProgressUnit | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = WorkBreakdownProgressLineSchema.safeParse(candidate);
  return parsed.success ? parsed.data.unit : undefined;
}

function progressUnits(root: WorkBreakdown["root"]): WorkBreakdownProgressUnit[] {
  const output: WorkBreakdownProgressUnit[] = [];
  const visit = (unit: WorkBreakdown["root"], parentKey: string | null, siblingIndex: number, siblingCount: number): void => {
    output.push({ key: unit.key, parentKey, kind: unit.kind, title: unit.title, objective: unit.objective, siblingIndex, siblingCount });
    if (unit.kind === "composite") unit.children.forEach((child, index) => visit(child, unit.key, index, unit.children.length));
  };
  visit(root, null, 0, 1);
  return output;
}

function normalizeModelOutputs(output: unknown): unknown[] {
  if (typeof output !== "string") return [output];
  const parsed = parseJsonObjectCandidates(output);
  if (!parsed.ok) throw new Error(parsed.message);
  const documents = parsed.candidates
    .map((candidate) => candidate.value)
    .filter((candidate) => !WorkBreakdownProgressLineSchema.safeParse(candidate).success);
  if (documents.length === 0) {
    throw new Error("Model emitted planning progress but no complete WorkBreakdown JSON.");
  }
  return documents;
}

function planningCacheKey(input: WorkBreakdownPlannerInput): string {
  return `work-breakdown-v2:${createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
