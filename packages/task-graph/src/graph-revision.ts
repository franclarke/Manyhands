import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import {
  ArtifactRequirementSchema,
  ConflictConstraintSchema,
  LegacyOrderingConstraintSchema,
  SeamBindingSchema,
  type ArtifactRequirement,
  type ConflictConstraint,
  type SeamBinding
} from "./relations.js";

export const TaskNodeV2Schema = z.object({
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

export type TaskNodeV2 = z.infer<typeof TaskNodeV2Schema>;

export const GraphRevisionSchema = z.object({
  schemaVersion: z.literal(2),
  graphId: EntityIdSchema,
  revision: z.number().int().positive(),
  rootId: EntityIdSchema,
  baseCommit: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  nodes: z.record(EntityIdSchema, TaskNodeV2Schema),
  artifactRequirements: z.array(ArtifactRequirementSchema).default([]),
  seamBindings: z.array(SeamBindingSchema).default([]),
  conflictConstraints: z.array(ConflictConstraintSchema).default([]),
  legacyOrderingConstraints: z.array(LegacyOrderingConstraintSchema).default([]),
  createdAt: IsoTimestampSchema
}).strict();

export type GraphRevision = z.infer<typeof GraphRevisionSchema>;

export type GraphRevisionOperation =
  | { type: "upsert_node"; node: TaskNodeV2 }
  | { type: "remove_node"; nodeId: string }
  | { type: "update_node_goal"; nodeId: string; goal: string }
  | { type: "add_artifact_requirement"; requirement: ArtifactRequirement }
  | { type: "remove_artifact_requirement"; requirementId: string }
  | { type: "add_seam_binding"; binding: SeamBinding }
  | { type: "remove_seam_binding"; bindingId: string }
  | { type: "add_conflict_constraint"; constraint: ConflictConstraint }
  | { type: "remove_conflict_constraint"; constraintId: string }
  | { type: "remove_legacy_ordering_constraint"; constraintId: string };

export interface ReviseGraphInput {
  expectedRevision: number;
  operations: readonly GraphRevisionOperation[];
  createdAt?: string;
}
