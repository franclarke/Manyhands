import type { TaskContractBundle } from "@manyhands/contracts";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import type { GraphRevision } from "@manyhands/task-graph";
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
  path?: string;
}

export interface ProposalReceipt {
  slot: number;
  receivedAt: string;
  draft: unknown;
  plan?: SemanticPlan;
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
  terminal?: PlanningOutcome;
}
