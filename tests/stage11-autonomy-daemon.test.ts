import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { DigestHasher } from "@manyhands/contracts";
import {
  foldRun,
  type AutonomyLevel,
  type ProductRunDefinition,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";
import type { RunActorReactionContext } from "@manyhands/run-engine";

import { createProductRunApplication } from "../apps/daemon/src/product-run-application.js";

const at = "2026-08-16T00:00:00.000Z";
const runId = "run:stage11-autonomy";
const daemonEpoch = "epoch-stage11";
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

/**
 * Both live runs of 2026-08-15 parked at `Approve graph revision 1?` no matter
 * what the run form's autonomy select said, because the value never reached the
 * daemon and nothing in the actor consulted it.
 *
 * The delegation is answered by the actor, not by an adapter, so the answer is
 * a durable fact in the same journal as the question — and it is stamped with
 * the authorization that produced it, so a reader can always tell a person's
 * approval from a standing one.
 */
describe("A delegated plan approval", () => {
  it("answers the approval it raised and starts execution in the same reaction", async () => {
    const reaction = await planningReaction("semi");

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual([
      "graph.revision.proposed",
      "decision.raised",
      "decision.resolved",
      "graph.revision.approved"
    ]);
    expect(reaction.effects).toHaveLength(1);
    expect(reaction.effects[0]?.intent.attemptId).toBe("stage3:execution");
  });

  it("stamps the answer with the authorization that produced it", async () => {
    const reaction = await planningReaction("autonomous");
    const resolved = reaction.domainEvents.find(({ type }) => type === "decision.resolved");

    expect(resolved?.payload).toEqual({
      decisionId: "approve-plan:graph-stage11:r1",
      optionId: "approve",
      authorizedBy: { kind: "autonomy_policy", level: "autonomous" }
    });
  });

  it("produces a journal that folds to a running run at the approved revision", async () => {
    // The reaction is only worth anything if the reducer accepts it. Approving
    // a revision the projection does not hold throws, so folding is the proof
    // that the graph identity came from the planning result and not from a
    // plausible-looking constant.
    const reaction = await planningReaction("semi");
    const projection = foldRun([creation("semi"), ...sequenced(reaction.domainEvents, 1)]);

    expect(projection.lifecycle).toBe("running");
    expect(projection.approvedGraphRevision).toBe(1);
    expect(projection.decisions["approve-plan:graph-stage11:r1"]?.authorizedBy)
      .toEqual({ kind: "autonomy_policy", level: "semi" });
  });

  it("leaves a supervised run waiting for its operator", async () => {
    const reaction = await planningReaction("supervised");

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual([
      "graph.revision.proposed",
      "decision.raised"
    ]);
    expect(reaction.effects).toEqual([]);
  });

  it("leaves a run whose definition predates autonomy waiting too", async () => {
    const reaction = await planningReaction(undefined);

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual([
      "graph.revision.proposed",
      "decision.raised"
    ]);
    expect(reaction.effects).toEqual([]);
  });
});

/**
 * The rehearsal run of 2026-08-16 parked at `waiting_for_input` with a pending
 * `resolve_conflict`, despite being autonomous. The policy resolves that kind
 * and says so in its own tests; nothing wired it to the execution reaction,
 * where such decisions are actually raised. A delegation that covers the first
 * gate and not the ones that stop the run is not a delegation.
 */
describe("A delegated repair", () => {
  it("answers the conflict its own execution raised and tries again", async () => {
    const reaction = await executionReaction("autonomous", { raiseConflict: true });

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual([
      "decision.raised",
      "decision.resolved"
    ]);
    const resolved = reaction.domainEvents.at(-1) as RunEventInput & {
      payload: { optionId: string; authorizedBy: unknown };
    };
    expect(resolved.payload.optionId).toBe("retry");
    expect(resolved.payload.authorizedBy).toEqual({ kind: "autonomy_policy", level: "autonomous" });
    expect(reaction.effects).toHaveLength(1);
    expect(reaction.effects[0]?.intent.attemptId).toMatch(/^stage3:execution/u);
  });

  it("leaves a supervised run parked on the same conflict", async () => {
    const reaction = await executionReaction("supervised", { raiseConflict: true });

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual(["decision.raised"]);
    expect(reaction.effects).toEqual([]);
  });

  it("does not answer a question about what the operator wanted", async () => {
    // A `clarify_goal` raised mid-execution stops the run under every level,
    // because the answer is not in the repository or the graph.
    const reaction = await executionReaction("autonomous", { raiseClarification: true });

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual(["decision.raised"]);
    expect(reaction.effects).toEqual([]);
  });
});

describe("A delegated delivery", () => {
  it("publishes the candidate the run just verified", async () => {
    const reaction = await executionReaction("autonomous");

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual([
      "evidence.matrix_recorded",
      "final_candidate.verified",
      "delivery.started"
    ]);
    const started = reaction.domainEvents.at(-1) as RunEventInput & {
      payload: { approval: Record<string, string> };
    };
    expect(started.payload.approval).toEqual(derivedApproval());
    expect(reaction.effects).toHaveLength(1);
    expect(reaction.effects[0]?.intent.attemptId).toBe("stage3:delivery");
  });

  it("stops at the result for every level short of autonomous", async () => {
    // Publication is the one act that moves a ref other people pull. Semi
    // delegates everything inside the run's own workspace and nothing beyond
    // it, which is the whole difference between the two levels.
    for (const level of ["supervised", "semi"] as const) {
      const reaction = await executionReaction(level);
      expect(reaction.domainEvents.map(({ type }) => type)).toEqual([
        "evidence.matrix_recorded",
        "final_candidate.verified"
      ]);
      expect(reaction.effects).toEqual([]);
    }
  });

  it("does not publish while the run has not actually finished", async () => {
    // An execution result that records evidence without verifying a final
    // candidate leaves the run running. The gate is the folded lifecycle, the
    // same one the operator's own delivery command is checked against, so
    // there is no second opinion about when a run is done.
    const reaction = await executionReaction("autonomous", { verifyCandidate: false });

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual(["evidence.matrix_recorded"]);
    expect(reaction.effects).toEqual([]);
  });

  it("reports a failed autonomous delivery against the approval in the journal", async () => {
    // The reaction used to read the approval out of an accepted `deliver_run`
    // command and throw when there was none. An autonomous run has no such
    // command, and a delivery it cannot describe is a delivery it cannot
    // report as failed.
    const application = buildApplication({});
    const events = sequenced([
      creationInput("autonomous"),
      input("graph.revision.proposed", { graphId: "graph-stage11", revision: 1 }),
      input("graph.revision.approved", { graphId: "graph-stage11", revision: 1 }),
      input("evidence.matrix_recorded", { matrix: verifiedMatrix() }),
      input("final_candidate.verified", finalCandidate()),
      input("delivery.started", { approval: derivedApproval() })
    ], 0);

    const reaction = await application.react({
      intent: deliveryIntent(),
      receipts: [],
      terminal: {
        eventId: "effect:delivery:failed",
        occurredAt: at,
        type: "effect.failed",
        payload: { effectId: deliveryIntent().effectId, reason: "the target diverged" }
      }
    } as never, context(events));

    const failure = reaction.domainEvents[0] as RunEventInput & { payload: { manifestId: string } };
    expect(failure.type).toBe("delivery.failed");
    expect(failure.payload.manifestId).toBe("manifest-stage11");
  });
});

function buildApplication(overrides: {
  loadPlanningResult?: (effectId: string) => Promise<readonly RunEventInput[]>;
  loadExecutionResult?: (runId: string, attemptId: string) => Promise<readonly RunEventInput[]>;
}) {
  return createProductRunApplication({
    hasher: sha256,
    clock: () => at,
    executionProcess: () => ({ executable: process.execPath, argv: [], cwd: process.cwd(), env: {} }),
    ...overrides
  });
}

async function planningReaction(autonomy: AutonomyLevel | undefined) {
  const application = buildApplication({
    loadPlanningResult: async () => [
      input("graph.revision.proposed", { graphId: "graph-stage11", revision: 1 }),
      input("decision.raised", { decision: planDecision() })
    ]
  });
  return application.react({
    intent: planningIntent(),
    receipts: [],
    terminal: {
      eventId: "effect:planning:completed",
      occurredAt: at,
      type: "effect.completed",
      payload: { effectId: planningIntent().effectId, receiptId: "receipt:planning" }
    }
  } as never, context(sequenced([creationInput(autonomy)], 0)));
}

async function executionReaction(
  autonomy: AutonomyLevel,
  result: { verifyCandidate?: boolean; raiseConflict?: boolean; raiseClarification?: boolean } = {}
) {
  const blocked = result.raiseConflict === true || result.raiseClarification === true;
  const application = buildApplication({
    loadExecutionResult: async () => blocked
      ? [input("decision.raised", {
        decision: result.raiseClarification === true ? clarifyDecision() : conflictDecision()
      })]
      : [
        input("evidence.matrix_recorded", { matrix: verifiedMatrix() }),
        ...(result.verifyCandidate === false ? [] : [input("final_candidate.verified", finalCandidate())])
      ]
  });
  const events = sequenced([
    creationInput(autonomy),
    input("graph.revision.proposed", { graphId: "graph-stage11", revision: 1 }),
    input("graph.revision.approved", { graphId: "graph-stage11", revision: 1 })
  ], 0);
  return application.react({
    intent: executionIntent(),
    receipts: [],
    terminal: {
      eventId: "effect:execution:completed",
      occurredAt: at,
      type: "effect.completed",
      payload: { effectId: executionIntent().effectId, receiptId: "receipt:execution" }
    }
  } as never, context(events));
}

function context(events: readonly RunEvent[]): RunActorReactionContext {
  const projection = foldRun(events);
  return { runId, daemonEpoch, currentRevision: projection.sequence, events, projection };
}

function sequenced(inputs: readonly RunEventInput[], offset: number): RunEvent[] {
  return inputs.map((event, index) => ({
    ...event,
    runId,
    sequence: offset + index + 1
  }) as RunEvent);
}

function planDecision() {
  return {
    id: "approve-plan:graph-stage11:r1",
    kind: "approve_plan",
    question: "Approve graph revision 1?",
    options: [
      { id: "approve", label: "Approve plan" },
      { id: "request_changes", label: "Request changes" }
    ],
    affectedNodeIds: ["node:root"],
    evidenceRefs: ["graph:graph-stage11:r1"],
    impact: "acceptance"
  };
}

function conflictDecision() {
  return {
    id: "resolve-conflict:unit:a",
    kind: "resolve_conflict",
    question: "Execution for A requires guidance.",
    options: [{ id: "retry", label: "Retry" }, { id: "stop", label: "Stop" }],
    affectedNodeIds: ["unit:a"],
    evidenceRefs: ["attempt:unit:a:1"],
    impact: "risk"
  };
}

function clarifyDecision() {
  return {
    ...conflictDecision(),
    id: "clarify-goal:unit:a",
    kind: "clarify_goal",
    options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
    impact: "scope"
  };
}

function derivedApproval() {
  return {
    manifestId: "manifest-stage11",
    finalSha: "candidate-stage11",
    targetBranch: "main",
    targetHead: "base-stage11",
    targetFingerprint: "target:stage11",
    actor: "autonomy_policy",
    idempotencyKey: `${runId}:manifest-stage11:candidate-stage11`
  };
}

function finalCandidate() {
  return {
    manifestId: "manifest-stage11",
    commit: "candidate-stage11",
    evidenceMatrixId: "matrix-stage11",
    evidenceEligible: true,
    executionSucceeded: true,
    sourceTargetFingerprint: "target:stage11",
    targetBranch: "main",
    targetHead: "base-stage11",
    finalManifest: {
      commitSha: "candidate-stage11",
      treeSha: "tree-stage11",
      graphRevision: 1,
      artifactIds: ["artifact-stage11"],
      evidenceMatrixId: "matrix-stage11",
      validationRecipeDigest: "sha256:recipe-stage11",
      deliveryTarget: "main"
    }
  };
}

function verifiedMatrix() {
  return {
    matrixId: "matrix-stage11",
    candidateCommit: "candidate-stage11",
    validationContract: { id: "validation-stage11", revision: "revision-1" },
    criteria: [{
      criterionId: "criterion-stage11",
      obligationId: "obligation-stage11",
      status: "satisfied" as const,
      justification: "The validator checked the exact candidate.",
      evidenceRefs: ["evidence-stage11"]
    }],
    outcome: "verified" as const,
    validationRecipeDigest: "sha256:recipe-stage11",
    evidenceBindings: [],
    observations: []
  };
}

function definition(autonomy: AutonomyLevel | undefined): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage11",
    userPrompt: "Exercise the delegated path",
    acceptanceCriteria: ["the run finishes without an operator"],
    title: "Stage 11 autonomy",
    planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
    repairSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionConfig: {},
    ...(autonomy === undefined ? {} : { autonomy }),
    targetContext: {
      fingerprint: "target:stage11",
      sourceBaseCommit: "base-stage11",
      sourceBranch: "main",
      sourceRealPath: process.cwd()
    }
  };
}

function creationInput(autonomy: AutonomyLevel | undefined): RunEventInput {
  return input("run.created", {
    goal: definition(autonomy).userPrompt,
    definition: definition(autonomy)
  });
}

function creation(autonomy: AutonomyLevel | undefined): RunEvent {
  return sequenced([creationInput(autonomy)], 0)[0]!;
}

function input(type: string, payload: Record<string, unknown>): RunEventInput {
  return { eventId: `${runId}:${type}`, occurredAt: at, type, payload } as RunEventInput;
}

function planningIntent() {
  return intent("stage3:planning", "model_call", "a");
}

function executionIntent() {
  return intent("stage3:execution", "process_spawn", "c");
}

function deliveryIntent() {
  return intent("stage3:delivery", "delivery", "b");
}

function intent(attemptId: string, kind: string, seed: string) {
  return {
    runId,
    attemptId,
    kind,
    inputDigest: `sha256:${seed.repeat(64)}`,
    daemonEpoch,
    idempotency: "reconcile_then_repeat" as const,
    requestedAt: at,
    effectId: `sha256:${seed.repeat(64)}`
  };
}
