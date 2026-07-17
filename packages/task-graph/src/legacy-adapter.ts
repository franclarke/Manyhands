import { createHash } from "node:crypto";
import type { InterfaceContract } from "@manyhands/contracts";
import type { GraphRevision, TaskNodeV2 } from "./graph-revision.js";
import type { ArtifactRequirement, LegacyOrderingConstraint, SeamBinding } from "./relations.js";
import type { TaskGraph } from "./index.js";
import { validateGraphRevision } from "./validate-v2.js";

export interface LegacyGraphAdapterOptions {
  repositorySnapshotId: string;
}

export interface LegacyGraphMigrationIssue {
  code: "ambiguous_legacy_dependency";
  nodeId: string;
  message: string;
}

export interface LegacyGraphAdapterResult {
  graph: GraphRevision;
  requiresReplan: boolean;
  issues: LegacyGraphMigrationIssue[];
}

export function adaptTaskGraphV1ToV2(legacy: TaskGraph, options: LegacyGraphAdapterOptions): LegacyGraphAdapterResult {
  const artifactRequirements: ArtifactRequirement[] = [];
  const legacyOrderingConstraints: LegacyOrderingConstraint[] = [];
  const issues: LegacyGraphMigrationIssue[] = [];

  for (const dependency of legacy.dependencies) {
    const producer = legacy.nodes[dependency.fromTaskId];
    const consumer = legacy.nodes[dependency.toTaskId];
    const evidencePath = producer?.contract?.expectedOutput.changedFiles.find((filePath) =>
      consumer?.contract?.context.upstreamArtifacts.includes(filePath) === true
    );
    if (producer !== undefined && consumer !== undefined && evidencePath !== undefined) {
      const revision = shortHash({ producer: producer.id, path: evidencePath });
      artifactRequirements.push({
        id: safeId(`legacy-artifact-requirement-${producer.id}-${consumer.id}`),
        artifactContract: { id: safeId(`legacy-artifact-${producer.id}-${evidencePath}`), revision },
        producerNodeId: producer.id,
        consumerNodeId: consumer.id,
        requiredFor: "execution"
      });
      continue;
    }

    legacyOrderingConstraints.push({
      id: safeId(`legacy-ordering-${dependency.fromTaskId}-${dependency.toTaskId}`),
      fromNodeId: dependency.fromTaskId,
      toNodeId: dependency.toTaskId,
      reason: dependency.rationale ?? `V1 ${dependency.type} dependency has no explicit artifact evidence.`,
      deprecated: true,
      requiresReplan: true
    });
    issues.push({
      code: "ambiguous_legacy_dependency",
      nodeId: dependency.toTaskId,
      message: `Dependency ${dependency.fromTaskId} -> ${dependency.toTaskId} cannot be promoted to an artifact requirement without contractual evidence.`
    });
  }

  const graph: GraphRevision = {
    schemaVersion: 2,
    graphId: legacy.id,
    revision: 1,
    rootId: legacy.rootId,
    baseCommit: legacy.baseCommit,
    repositorySnapshotId: options.repositorySnapshotId,
    createdAt: legacy.createdAt,
    nodes: Object.fromEntries(Object.values(legacy.nodes).map((node) => [node.id, toNodeV2(node)])),
    artifactRequirements,
    seamBindings: inferSeamBindings(legacy),
    conflictConstraints: [],
    legacyOrderingConstraints
  };
  const errors = validateGraphRevision(graph).filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new Error(`Legacy graph cannot be adapted: ${errors.map((issue) => issue.message).join("; ")}`);
  return { graph, requiresReplan: legacyOrderingConstraints.length > 0, issues };
}

function toNodeV2(node: TaskGraph["nodes"][string]): TaskNodeV2 {
  return { id: node.id, parentId: node.parentId, kind: node.kind, title: node.title, goal: node.goal };
}

function inferSeamBindings(legacy: TaskGraph): SeamBinding[] {
  const bindings = new Map<string, SeamBinding>();
  for (const producer of Object.values(legacy.nodes)) {
    for (const produced of producer.contract?.producedInterfaces ?? []) {
      for (const consumer of Object.values(legacy.nodes)) {
        const consumed = consumer.contract?.consumedInterfaces?.find((candidate) => sameInterface(candidate, produced));
        if (consumed === undefined || consumer.id === producer.id) continue;
        const revision = shortHash({ id: produced.id, signature: produced.signature, contract: produced.contract ?? {} });
        const id = safeId(`legacy-seam-${produced.id}-${producer.id}-${consumer.id}`);
        bindings.set(id, {
          id,
          seamContract: { id: safeId(produced.id), revision },
          producerNodeId: producer.id,
          consumerNodeId: consumer.id,
          producerRevision: revision,
          consumerRevision: revision
        });
      }
    }
  }
  return [...bindings.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function sameInterface(left: InterfaceContract, right: InterfaceContract): boolean {
  return left.id === right.id && left.kind === right.kind && left.signature === right.signature;
}

function shortHash(value: unknown): string {
  return `legacy-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]/gu, "-");
}
