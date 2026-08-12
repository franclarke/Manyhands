import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import {
  LegacyArtifactRequirementV2Schema,
  ConflictConstraintSchema,
  LegacyOrderingConstraintSchema,
  LegacySeamBindingV2Schema,
  type LegacyArtifactRequirementV2,
  type ConflictConstraint,
  type LegacySeamBindingV2
} from "./relations.js";

export const LegacyTaskNodeV2Schema = z.object({
  id: EntityIdSchema,
  parentId: EntityIdSchema.nullable(),
  kind: z.enum(["root", "composite", "leaf", "integrator"]),
  title: NonEmptyStringSchema,
  goal: NonEmptyStringSchema,
  /**
   * Longest path from the start of the run — the wave, kept as a derived fact
   * for the flow layout to band by. Presentational only: no runtime decision
   * reads it, which is what separates it from the barrier it replaced.
   *
   * Optional because revisions compiled before stage 4 do not carry it.
   */
  topologicalLevel: z.number().int().nonnegative().optional()
}).strict();

export type LegacyTaskNodeV2 = z.infer<typeof LegacyTaskNodeV2Schema>;

export const LegacyGraphRevisionV2Schema = z.object({
  schemaVersion: z.literal(2),
  graphId: EntityIdSchema,
  revision: z.number().int().positive(),
  rootId: EntityIdSchema,
  baseCommit: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  nodes: z.record(EntityIdSchema, LegacyTaskNodeV2Schema),
  artifactRequirements: z.array(LegacyArtifactRequirementV2Schema).default([]),
  seamBindings: z.array(LegacySeamBindingV2Schema).default([]),
  conflictConstraints: z.array(ConflictConstraintSchema).default([]),
  legacyOrderingConstraints: z.array(LegacyOrderingConstraintSchema).default([]),
  createdAt: IsoTimestampSchema
}).strict();

export type LegacyGraphRevisionV2 = z.infer<typeof LegacyGraphRevisionV2Schema>;

export type LegacyGraphRevisionV2Operation =
  | { type: "upsert_node"; node: LegacyTaskNodeV2 }
  | { type: "remove_node"; nodeId: string }
  | { type: "update_node_goal"; nodeId: string; goal: string }
  | { type: "add_artifact_requirement"; requirement: LegacyArtifactRequirementV2 }
  | { type: "remove_artifact_requirement"; requirementId: string }
  | { type: "add_seam_binding"; binding: LegacySeamBindingV2 }
  | { type: "remove_seam_binding"; bindingId: string }
  | { type: "add_conflict_constraint"; constraint: ConflictConstraint }
  | { type: "remove_conflict_constraint"; constraintId: string }
  | { type: "remove_legacy_ordering_constraint"; constraintId: string };

export interface ReviseLegacyGraphV2Input {
  expectedRevision: number;
  operations: readonly LegacyGraphRevisionV2Operation[];
  createdAt?: string;
}
