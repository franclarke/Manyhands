import { TaskContractBundleSchema, type TaskContractBundle } from "@manyhands/contracts";
import { RepositorySnapshotSchema, type RepositorySnapshot } from "@manyhands/repository-index";
import { GraphRevisionSchema, type GraphRevision } from "@manyhands/task-graph";
import { NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export interface SemanticOutcomeDraft {
  statement: string;
  covers: string[];
  verification: {
    kind: "repository_capability";
    capability: string;
    references: string[];
  };
}

export interface SemanticLeafDraft {
  kind: "leaf";
  handle: string;
  title: string;
  objective: string;
  surface: {
    existingPaths: string[];
    plannedPaths: string[];
  };
  outcomes: SemanticOutcomeDraft[];
}

export interface SemanticCompositeDraft {
  kind: "composite";
  handle: string;
  title: string;
  objective: string;
  children: SemanticWorkDraft[];
}

export type SemanticWorkDraft = SemanticLeafDraft | SemanticCompositeDraft;

export interface SemanticSeamDraft {
  handle: string;
  producer: string;
  consumers: string[];
  interface: {
    kind: "api" | "type" | "event" | "data" | "ui" | "command";
    specification: string;
    compatibility: "exact" | "backward_compatible";
    materialization: "logical" | "files" | "manifest" | "commit";
    artifactPaths: string[];
    verification: string;
  };
  evidencePaths: string[];
}

export interface SemanticPlanDraft {
  rationale?: string | undefined;
  root: SemanticWorkDraft;
  seams: SemanticSeamDraft[];
  uncertainties?: string[] | undefined;
}

const OutcomeDraftSchema = z.object({
  statement: NonEmptyStringSchema,
  covers: z.array(NonEmptyStringSchema).min(1),
  verification: z.object({
    kind: z.literal("repository_capability"),
    capability: NonEmptyStringSchema,
    references: z.array(NonEmptyStringSchema).min(1)
  }).strict()
}).strict();

const SurfaceDraftSchema = z.object({
  existingPaths: z.array(NonEmptyStringSchema),
  plannedPaths: z.array(NonEmptyStringSchema)
}).strict().refine(
  (surface) => surface.existingPaths.length + surface.plannedPaths.length > 0,
  "a leaf surface must declare at least one path"
);

const WorkDraftSchema: z.ZodType<SemanticWorkDraft> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("leaf"),
    handle: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    surface: SurfaceDraftSchema,
    outcomes: z.array(OutcomeDraftSchema).min(1)
  }).strict(),
  z.object({
    kind: z.literal("composite"),
    handle: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    children: z.array(WorkDraftSchema).min(1)
  }).strict()
]));

const SeamDraftSchema = z.object({
  handle: NonEmptyStringSchema,
  producer: NonEmptyStringSchema,
  consumers: z.array(NonEmptyStringSchema).min(1),
  interface: z.object({
    kind: z.enum(["api", "type", "event", "data", "ui", "command"]),
    specification: NonEmptyStringSchema,
    compatibility: z.enum(["exact", "backward_compatible"]),
    materialization: z.enum(["logical", "files", "manifest", "commit"]),
    artifactPaths: z.array(NonEmptyStringSchema),
    verification: NonEmptyStringSchema
  }).strict().superRefine((value, context) => {
    if (value.materialization === "logical" && value.artifactPaths.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifactPaths"], message: "logical materialization cannot declare artifact paths" });
    }
    if ((value.materialization === "files" || value.materialization === "manifest") && value.artifactPaths.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifactPaths"], message: `${value.materialization} materialization requires artifact paths` });
    }
  }),
  evidencePaths: z.array(NonEmptyStringSchema)
}).strict();

export const SemanticPlanDraftSchema: z.ZodType<SemanticPlanDraft> = z.object({
  rationale: NonEmptyStringSchema.optional(),
  root: WorkDraftSchema,
  seams: z.array(SeamDraftSchema),
  uncertainties: z.array(NonEmptyStringSchema).optional()
}).strict();

export interface GoalCriterion {
  id: string;
  statement: string;
}

export interface PlanningGoal {
  id: string;
  statement: string;
  requiredCriteria: GoalCriterion[];
}

export interface PlanningContext {
  goal: PlanningGoal;
  repositorySnapshot: RepositorySnapshot;
  resolvedDecisions: unknown[];
  constraints?: string[] | undefined;
}

export interface PlanningProtocol {
  id: string;
  revision: string;
  proposalTarget: number;
  minSafeCandidates: number;
  minComparableCandidates: number;
  allowDegradedComparison: boolean;
}

export interface CanonicalOutcome {
  outcomeId: string;
  statement: string;
  covers: string[];
  verification: SemanticOutcomeDraft["verification"];
}

export interface CanonicalLeafModule {
  kind: "leaf";
  moduleId: string;
  title: string;
  objective: string;
  surface: SemanticLeafDraft["surface"];
  outcomes: CanonicalOutcome[];
}

export interface CanonicalCompositeModule {
  kind: "composite";
  moduleId: string;
  title: string;
  objective: string;
  children: CanonicalModule[];
}

export type CanonicalModule = CanonicalLeafModule | CanonicalCompositeModule;

export interface CanonicalSeam {
  seamId: string;
  producerModuleId: string;
  consumerModuleIds: string[];
  interface: SemanticSeamDraft["interface"];
  evidencePaths: string[];
}

export interface SemanticPlan {
  schemaVersion: 1;
  planId: string;
  planHash: string;
  strategyHash: string;
  repositorySnapshotId: string;
  goalDigest: string;
  protocolDigest: string;
  decisionSetDigest: string;
  constraintSetDigest: string;
  root: CanonicalModule;
  seams: CanonicalSeam[];
}

export interface ExecutionCut {
  cutId: string;
  planId: string;
  executableModuleIds: string[];
  policy: "bounded-cohesion-v1";
  assessments: ExecutionCutAssessment[];
}

export interface ExecutionCutAssessment {
  moduleId: string;
  decision: "execute_leaf" | "execute_composite" | "expand";
  reasons: string[];
  metrics: {
    leafCount: number;
    scopePathCount: number;
    outcomeCount: number;
  };
}

export interface SemanticCompilation {
  graph: GraphRevision;
  contracts: TaskContractBundle[];
  compilationHash: string;
}

export interface PlanningIssue {
  code: string;
  message: string;
  path?: string | undefined;
}

export interface ProposalReceipt {
  slot: number;
  receivedAt: string;
  draft: unknown;
  plan?: SemanticPlan | undefined;
  issues: PlanningIssue[];
}

export interface PlanningRejection {
  slot: number;
  issues: PlanningIssue[];
}

export interface PlanningComparison {
  status: "complete" | "degraded";
  safeCandidates: number;
  comparableCandidates: number;
}

export type ReadyPlanningOutcome = {
  kind: "ready";
  attemptId: string;
  comparison: PlanningComparison;
  rejections: PlanningRejection[];
  selected: { plan: SemanticPlan; executionCut: ExecutionCut };
  compiled: SemanticCompilation;
};

export type NotReadyPlanningOutcome = {
  kind: "not_ready";
  attemptId: string;
  reason: "no_safe_candidate" | "insufficient_safe_candidates" | "insufficient_comparable_candidates";
  comparison: PlanningComparison;
  rejections: PlanningRejection[];
};

export type PlanningOutcome = ReadyPlanningOutcome | NotReadyPlanningOutcome;

export interface PlanningLease {
  runId: string;
  holderId: string;
  fenceToken: string;
}

export interface PlanningAttemptRecord {
  schemaVersion: 1;
  attemptId: string;
  lease: PlanningLease;
  protocol: PlanningProtocol;
  context: PlanningContext;
  startedAt: string;
  proposals: ProposalReceipt[];
  terminal?: PlanningOutcome | undefined;
}

const GoalCriterionSchema = z.object({
  id: NonEmptyStringSchema,
  statement: NonEmptyStringSchema
}).strict();

const PlanningGoalSchema = z.object({
  id: NonEmptyStringSchema,
  statement: NonEmptyStringSchema,
  requiredCriteria: z.array(GoalCriterionSchema).min(1)
}).strict();

export const PlanningProtocolSchema = z.object({
  id: NonEmptyStringSchema,
  revision: NonEmptyStringSchema,
  proposalTarget: z.number().int().positive(),
  minSafeCandidates: z.number().int().nonnegative(),
  minComparableCandidates: z.number().int().nonnegative(),
  allowDegradedComparison: z.boolean()
}).strict();

const PlanningLeaseSchema = z.object({
  runId: NonEmptyStringSchema,
  holderId: NonEmptyStringSchema,
  fenceToken: NonEmptyStringSchema
}).strict();

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(JsonValueSchema)
]));

export const PlanningContextSchema = z.object({
  goal: PlanningGoalSchema,
  repositorySnapshot: RepositorySnapshotSchema,
  resolvedDecisions: z.array(JsonValueSchema),
  constraints: z.array(NonEmptyStringSchema).optional()
}).strict();

const CanonicalOutcomeSchema = z.object({
  outcomeId: NonEmptyStringSchema,
  statement: NonEmptyStringSchema,
  covers: z.array(NonEmptyStringSchema).min(1),
  verification: OutcomeDraftSchema.shape.verification
}).strict();

const CanonicalModuleSchema: z.ZodType<CanonicalModule> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("leaf"),
    moduleId: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    surface: SurfaceDraftSchema,
    outcomes: z.array(CanonicalOutcomeSchema).min(1)
  }).strict(),
  z.object({
    kind: z.literal("composite"),
    moduleId: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    children: z.array(CanonicalModuleSchema).min(1)
  }).strict()
]));

const CanonicalSeamSchema = z.object({
  seamId: NonEmptyStringSchema,
  producerModuleId: NonEmptyStringSchema,
  consumerModuleIds: z.array(NonEmptyStringSchema).min(1),
  interface: SeamDraftSchema.shape.interface,
  evidencePaths: z.array(NonEmptyStringSchema)
}).strict();

export const SemanticPlanSchema = z.object({
  schemaVersion: z.literal(1),
  planId: NonEmptyStringSchema,
  planHash: NonEmptyStringSchema,
  strategyHash: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  goalDigest: NonEmptyStringSchema,
  protocolDigest: NonEmptyStringSchema,
  decisionSetDigest: NonEmptyStringSchema,
  constraintSetDigest: NonEmptyStringSchema,
  root: CanonicalModuleSchema,
  seams: z.array(CanonicalSeamSchema)
}).strict();

const ExecutionCutAssessmentSchema = z.object({
  moduleId: NonEmptyStringSchema,
  decision: z.enum(["execute_leaf", "execute_composite", "expand"]),
  reasons: z.array(NonEmptyStringSchema),
  metrics: z.object({
    leafCount: z.number().int().nonnegative(),
    scopePathCount: z.number().int().nonnegative(),
    outcomeCount: z.number().int().nonnegative()
  }).strict()
}).strict();

export const ExecutionCutSchema = z.object({
  cutId: NonEmptyStringSchema,
  planId: NonEmptyStringSchema,
  executableModuleIds: z.array(NonEmptyStringSchema).min(1),
  policy: z.literal("bounded-cohesion-v1"),
  assessments: z.array(ExecutionCutAssessmentSchema)
}).strict();

const PlanningIssueSchema = z.object({
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  path: NonEmptyStringSchema.optional()
}).strict();

export const ProposalReceiptSchema = z.object({
  slot: z.number().int().nonnegative(),
  receivedAt: NonEmptyStringSchema,
  draft: JsonValueSchema,
  plan: SemanticPlanSchema.optional(),
  issues: z.array(PlanningIssueSchema)
}).strict();

const PlanningComparisonSchema = z.object({
  status: z.enum(["complete", "degraded"]),
  safeCandidates: z.number().int().nonnegative(),
  comparableCandidates: z.number().int().nonnegative()
}).strict();

const PlanningRejectionSchema = z.object({
  slot: z.number().int().nonnegative(),
  issues: z.array(PlanningIssueSchema)
}).strict();

const ReadyPlanningOutcomeSchema = z.object({
  kind: z.literal("ready"),
  attemptId: NonEmptyStringSchema,
  comparison: PlanningComparisonSchema,
  rejections: z.array(PlanningRejectionSchema),
  selected: z.object({ plan: SemanticPlanSchema, executionCut: ExecutionCutSchema }).strict(),
  compiled: z.object({
    graph: GraphRevisionSchema,
    contracts: z.array(TaskContractBundleSchema),
    compilationHash: NonEmptyStringSchema
  }).strict()
}).strict();

const NotReadyPlanningOutcomeSchema = z.object({
  kind: z.literal("not_ready"),
  attemptId: NonEmptyStringSchema,
  reason: z.enum(["no_safe_candidate", "insufficient_safe_candidates", "insufficient_comparable_candidates"]),
  comparison: PlanningComparisonSchema,
  rejections: z.array(PlanningRejectionSchema)
}).strict();

export const PlanningOutcomeSchema = z.discriminatedUnion("kind", [ReadyPlanningOutcomeSchema, NotReadyPlanningOutcomeSchema]);

export const PlanningAttemptRecordSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: NonEmptyStringSchema,
  lease: PlanningLeaseSchema,
  protocol: PlanningProtocolSchema,
  context: PlanningContextSchema,
  startedAt: NonEmptyStringSchema,
  proposals: z.array(ProposalReceiptSchema),
  terminal: PlanningOutcomeSchema.optional()
}).strict();

export const PlanningAttemptRecordEventSchema = PlanningAttemptRecordSchema
  .transform((value): PlanningAttemptRecord => value as PlanningAttemptRecord);

export const ProposalReceiptEventSchema = ProposalReceiptSchema
  .transform((value): ProposalReceipt => value as ProposalReceipt);

export const PlanningOutcomeEventSchema = PlanningOutcomeSchema
  .transform((value): PlanningOutcome => value as PlanningOutcome);
