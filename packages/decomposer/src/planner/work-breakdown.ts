import { createHash } from "node:crypto";
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
}

export interface WorkBreakdownModelRequest {
  system: string;
  user: string;
  attempt: number;
  repairIssues: string[];
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

  async plan(input: WorkBreakdownPlannerInput): Promise<WorkBreakdown> {
    const cacheKey = planningCacheKey(input);
    const cached = this.cache?.get(cacheKey);
    if (cached !== undefined) return WorkBreakdownSchema.parse(cached);

    const prompt = buildWorkBreakdownPrompt(input);
    let repairIssues: string[] = [];
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const outputs = normalizeModelOutputs(await this.model.generate({ ...prompt, attempt, repairIssues }));
        const failures: string[] = [];
        for (const output of outputs) {
          const parsed = WorkBreakdownSchema.safeParse(output);
          if (parsed.success) {
            this.cache?.set(cacheKey, parsed.data);
            return parsed.data;
          }
          failures.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`));
        }
        repairIssues = failures;
      } catch (error) {
        repairIssues = [error instanceof Error ? error.message : String(error)];
      }
      if (attempt < this.maxAttempts && this.retryDelayMs > 0) await delay(this.retryDelayMs);
    }
    throw new Error(`WorkBreakdown planning failed after ${this.maxAttempts} attempts: ${repairIssues.join("; ")}`);
  }
}

function normalizeModelOutputs(output: unknown): unknown[] {
  if (typeof output !== "string") return [output];
  const parsed = parseJsonObjectCandidates(output);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.candidates.map((candidate) => candidate.value);
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
