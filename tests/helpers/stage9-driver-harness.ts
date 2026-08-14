import { createHash } from "node:crypto";

import { compilePlan } from "@manyhands/decomposer";
import {
  RunCoordinator,
  RunEventSchema,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";

import { stage9Fixture, stage9Sha256 } from "./stage9-fixture.js";

export const stage9At = "2026-08-14T12:00:00.000Z";

export function compileStage9Graph() {
  const fixture = stage9Fixture();
  const compiled = compilePlan({
    ...fixture,
    hasher: stage9Sha256,
    idFactory: (kind, parts) => [kind, ...parts].join(":")
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings, null, 1));
  return { fixture, compiled };
}

/** In-memory canonical journal with the strict single-writer sequence contract. */
export function stage9Coordinator(input: {
  runId: string;
  graphId: string;
  /** Throws when two appends interleave, which is how concurrency bugs surface. */
  detectInterleaving?: boolean;
}): { coordinator: RunCoordinator; events: () => RunEvent[] } {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId: input.runId, sequence: 1, occurredAt: stage9At, type: "run.created", payload: { goal: "Stage 9 fake run" } }),
    RunEventSchema.parse({ eventId: "proposed", runId: input.runId, sequence: 2, occurredAt: stage9At, type: "graph.revision.proposed", payload: { graphId: input.graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId: input.runId, sequence: 3, occurredAt: stage9At, type: "graph.revision.approved", payload: { graphId: input.graphId, revision: 1 } })
  ];
  let appending = false;
  const coordinator = new RunCoordinator({
    events: {
      load: async () => structuredClone(events),
      append: async (runId: string, expectedSequence: number, inputs: RunEventInput[]) => {
        if (input.detectInterleaving === true && appending) {
          throw new Error("Concurrent journal append: the single-writer contract was violated.");
        }
        appending = true;
        try {
          if (expectedSequence !== events.length) {
            throw new Error(`Expected sequence ${expectedSequence}, journal is at ${events.length}.`);
          }
          await Promise.resolve();
          const appended = inputs.map((event, index) => RunEventSchema.parse({
            ...event,
            runId,
            sequence: expectedSequence + index + 1
          }));
          events = [...events, ...appended];
          return appended;
        } finally {
          appending = false;
        }
      }
    },
    delivery: { publish: async () => { throw new Error("Delivery is not part of Stage 9."); } },
    clock: () => stage9At,
    eventId: (type, sequence) => `${type}:${sequence}`
  });
  return { coordinator, events: () => structuredClone(events) };
}

export interface Stage9ExecuteInput {
  runId: string;
  attemptId: string;
  inputFingerprint: string;
  graph: { revision: number; rootId?: string; contractRefs: Array<{ id: string; revision: number; digest: string }> };
  node: { id: string; kind: string };
  contract: {
    scope: { allowedPaths: string[] };
    validation: { id: string; revision: string; obligations: Array<{ id: string; criterionId: string }> };
    artifacts: Array<{ id: string; revision: string; producerNodeId: string }>;
  };
}

/**
 * A verified outcome for one node. `changedFiles` is explicit so a test can make
 * a composite write a path it does not own.
 */
export function stage9SuccessOutcome(
  input: Stage9ExecuteInput,
  options: { rootId: string; artifactIds: string[]; changedFiles?: string[] }
) {
  const obligation = input.contract.validation.obligations[0]!;
  const candidate = stage9Oid(input.node.id);
  return {
    kind: "success" as const,
    candidateCommit: candidate,
    outputDigest: `sha256:${input.node.id}`,
    changedFiles: options.changedFiles ?? input.contract.scope.allowedPaths,
    artifactManifests: stage9ManifestsFor(input),
    evidenceMatrix: {
      matrixId: `matrix-${input.node.id}`,
      candidateCommit: candidate,
      validationContract: { id: input.contract.validation.id, revision: input.contract.validation.revision },
      criteria: [{
        criterionId: obligation.criterionId,
        obligationId: obligation.id,
        status: "satisfied" as const,
        justification: "Fake executor verified the exact candidate.",
        evidenceRefs: ["evidence:fake"]
      }],
      outcome: "verified" as const,
      validationRecipeDigest: "sha256:fake",
      observations: []
    },
    ...(input.node.id === options.rootId ? {
      integrationManifestId: "integration-root",
      finalManifestId: "final-root",
      finalManifest: {
        commitSha: candidate,
        treeSha: "c".repeat(40),
        graphRevision: input.graph.revision,
        artifactIds: options.artifactIds,
        evidenceMatrixId: `matrix-${input.node.id}`,
        validationRecipeDigest: "sha256:fake",
        deliveryTarget: "main"
      }
    } : {})
  };
}

export function stage9ManifestsFor(input: Stage9ExecuteInput): Record<string, object> {
  return Object.fromEntries(input.contract.artifacts
    .filter((artifact) => artifact.producerNodeId === input.node.id)
    .map((artifact) => {
      const contract = input.graph.contractRefs.find((ref) =>
        ref.id === artifact.id && ref.revision === Number(artifact.revision)
      );
      if (contract === undefined) throw new Error(`Missing canonical ref for ${artifact.id}.`);
      const tree = stage9Oid(`${input.node.id}:tree`);
      return [artifact.id, {
        id: artifact.id,
        contract,
        producerNodeId: input.node.id,
        producerAttemptId: input.attemptId,
        inputFingerprint: input.inputFingerprint,
        repositoryObjectStoreId: "object-store:fake",
        objectFormat: "sha1",
        sourceCandidate: { commitOid: stage9Oid(input.node.id), treeOid: tree },
        retainedByRef: `refs/manyhands/test/${artifact.id}`,
        kind: "change_set",
        baseTreeSha: stage9Oid("base"),
        resultTreeSha: tree,
        entries: [],
        manifestDigest: `sha256:${stage9Oid(`${artifact.id}:manifest`)}${stage9Oid(`${artifact.id}:manifest:tail`).slice(0, 24)}`
      }];
    }));
}

export function stage9Oid(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}
