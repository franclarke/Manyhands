import { describe, expect, it, vi } from "vitest";
import {
  createPlanningModule,
  SemanticPlanDraftSchema,
  type PlanningAttemptRecord,
  type PlanningRecordPort,
  type SemanticPlanDraft
} from "@manyhands/decomposer";
import { bookingSnapshot } from "./helpers/target-planning-fixtures.js";

describe("PlanningModule", () => {
  it("commits a ready degraded result when product mode has one safe proposal", async () => {
    const safeDraft = bookingDraft();
    const ungroundedDraft = bookingDraft({ existingPaths: ["src/domain/missing.ts"] });
    const records = new InMemoryPlanningRecordPort();
    const propose = vi.fn(async ({ slot }: { slot: number }) => slot === 0 ? safeDraft : ungroundedDraft);
    const snapshot = bookingSnapshot();
    const module = createPlanningModule({
      contexts: {
        load: async () => ({
          goal: {
            id: "booking-goal",
            statement: "Implement booking creation",
            requiredCriteria: [
              { id: "booking-created", statement: "A valid booking can be created." }
            ]
          },
          repositorySnapshot: snapshot,
          resolvedDecisions: []
        })
      },
      protocols: {
        load: async () => ({
          id: "product-default",
          revision: "1",
          proposalTarget: 2,
          minSafeCandidates: 1,
          minComparableCandidates: 0,
          allowDegradedComparison: true
        })
      },
      proposals: { propose },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    const outcome = await module.start({
      lease: { runId: "run-product-1", holderId: "coordinator-1", fenceToken: "fence-7" },
      protocol: { id: "product-default", revision: "1" }
    });

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") throw new Error(`Expected ready, received ${outcome.reason}`);

    expect(outcome.comparison).toEqual({ status: "degraded", safeCandidates: 1, comparableCandidates: 0 });
    expect(outcome.rejections).toHaveLength(1);
    expect(outcome.rejections[0]?.issues).toContainEqual(expect.objectContaining({ code: "ungrounded_existing_path" }));
    expect(outcome.selected.plan.repositorySnapshotId).toBe(snapshot.snapshotId);
    expect(outcome.selected.plan.planId).toMatch(/^semantic-plan:sha256:/);
    expect(outcome.selected.plan.root.moduleId).toMatch(/^module:sha256:/);
    expect(outcome.selected.executionCut.planId).toBe(outcome.selected.plan.planId);
    expect(outcome.compiled.graph.repositorySnapshotId).toBe(snapshot.snapshotId);
    expect(Object.values(outcome.compiled.graph.nodes).map((node) => node.kind)).toEqual(["root", "leaf"]);
    expect(outcome.compiled.contracts).toHaveLength(1);
    expect(propose).toHaveBeenCalledTimes(2);

    expect(records.attempts).toHaveLength(1);
    expect(records.attempts[0]?.proposals).toHaveLength(2);
    expect(records.attempts[0]?.terminal?.kind).toBe("ready");
    expect(records.attempts[0]?.terminal).toEqual(outcome);
  });

  it("rejects model-authored canonical identity fields", () => {
    const result = SemanticPlanDraftSchema.safeParse({
      ...bookingDraft(),
      planId: "model-selected-id",
      repositorySnapshotId: "model-selected-snapshot"
    });

    expect(result.success).toBe(false);
  });

  it("commits a complete experiment comparison for two safe distinct plans", async () => {
    const alternative = bookingDraft();
    if (alternative.root.kind !== "composite" || alternative.root.children[0]?.kind !== "leaf") {
      throw new Error("Expected the booking fixture to contain one leaf.");
    }
    alternative.root.children[0].surface.plannedPaths = ["src/domain/booking-policy.ts"];
    const drafts = [bookingDraft(), alternative];
    const module = createPlanningModule({
      contexts: { load: async () => standardContext() },
      protocols: {
        load: async () => ({
          id: "thesis-experiment",
          revision: "1",
          proposalTarget: 2,
          minSafeCandidates: 2,
          minComparableCandidates: 2,
          allowDegradedComparison: false
        })
      },
      proposals: { propose: async ({ slot }) => drafts[slot] },
      records: new InMemoryPlanningRecordPort(),
      now: () => "2026-08-03T12:00:00.000Z"
    });

    const outcome = await module.start({
      lease: { runId: "run-experiment-2", holderId: "coordinator-1", fenceToken: "fence-8b" },
      protocol: { id: "thesis-experiment", revision: "1" }
    });

    expect(outcome.kind).toBe("ready");
    expect(outcome.comparison).toEqual({ status: "complete", safeCandidates: 2, comparableCandidates: 2 });
  });

  it("does not count rhetorical variants as comparable experiment candidates", async () => {
    const records = new InMemoryPlanningRecordPort();
    const drafts = [
      bookingDraft({ rationale: "Prefer a cohesive domain slice." }),
      bookingDraft({ rationale: "This is the smallest sensible implementation." })
    ];
    const module = createPlanningModule({
      contexts: {
        load: async () => ({
          goal: {
            id: "booking-goal",
            statement: "Implement booking creation",
            requiredCriteria: [
              { id: "booking-created", statement: "A valid booking can be created." }
            ]
          },
          repositorySnapshot: bookingSnapshot(),
          resolvedDecisions: []
        })
      },
      protocols: {
        load: async () => ({
          id: "thesis-experiment",
          revision: "1",
          proposalTarget: 2,
          minSafeCandidates: 2,
          minComparableCandidates: 2,
          allowDegradedComparison: false
        })
      },
      proposals: { propose: async ({ slot }) => drafts[slot] },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    const outcome = await module.start({
      lease: { runId: "run-experiment-1", holderId: "coordinator-1", fenceToken: "fence-8" },
      protocol: { id: "thesis-experiment", revision: "1" }
    });

    expect(outcome.kind).toBe("not_ready");
    if (outcome.kind !== "not_ready") throw new Error("Expected the experiment quorum to reject duplicate semantics.");
    expect(outcome.reason).toBe("insufficient_comparable_candidates");
    expect(outcome.comparison).toEqual({ status: "degraded", safeCandidates: 2, comparableCandidates: 0 });
    expect(records.attempts[0]?.terminal).toEqual(outcome);
  });

  it("cannot return ready when the fenced terminal commit fails", async () => {
    const records = new FailingFencedPlanningRecordPort("fence-9");
    const module = createPlanningModule({
      contexts: { load: async () => standardContext() },
      protocols: { load: async () => productProtocol() },
      proposals: { propose: async () => bookingDraft() },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    await expect(module.start({
      lease: { runId: "run-product-2", holderId: "coordinator-1", fenceToken: "fence-9" },
      protocol: { id: "product-default", revision: "1" }
    })).rejects.toThrow("durable commit unavailable");

    expect(records.receivedFenceToken).toBe("fence-9");
    expect(records.terminal).toBeUndefined();
  });

  it("replays the committed outcome from proposal receipts without a live model", async () => {
    const records = new InMemoryPlanningRecordPort();
    const liveModule = createPlanningModule({
      contexts: { load: async () => standardContext() },
      protocols: { load: async () => productProtocol() },
      proposals: {
        propose: async ({ slot }) => slot === 0
          ? bookingDraft()
          : bookingDraft({ existingPaths: ["src/domain/missing.ts"] })
      },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });
    const committed = await liveModule.start({
      lease: { runId: "run-replay-1", holderId: "coordinator-1", fenceToken: "fence-10" },
      protocol: { id: "product-default", revision: "1" }
    });
    const propose = vi.fn(async () => {
      throw new Error("live model must not be called during replay");
    });
    const replayModule = createPlanningModule({
      contexts: { load: async () => { throw new Error("live context must not be loaded during replay"); } },
      protocols: { load: async () => { throw new Error("live protocol must not be loaded during replay"); } },
      proposals: { propose },
      records,
      now: () => "2030-01-01T00:00:00.000Z"
    });

    const replayed = await replayModule.replay({ attemptId: committed.attemptId });

    expect(replayed).toEqual(committed);
    expect(propose).not.toHaveBeenCalled();
  });

  it("resumes an interrupted attempt by requesting only missing proposal slots", async () => {
    const records = new InterruptOncePlanningRecordPort(1);
    const interruptedModule = createPlanningModule({
      contexts: { load: async () => standardContext() },
      protocols: { load: async () => productProtocol() },
      proposals: { propose: async () => bookingDraft() },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });
    await expect(interruptedModule.start({
      lease: { runId: "run-resume-1", holderId: "coordinator-1", fenceToken: "fence-11" },
      protocol: { id: "product-default", revision: "1" }
    })).rejects.toThrow("simulated record interruption");
    const attemptId = records.attempts[0]?.attemptId;
    if (attemptId === undefined) throw new Error("Expected the interrupted attempt to be durable.");
    const propose = vi.fn(async ({ slot }) => bookingDraft({
      existingPaths: slot === 1 ? ["src/domain/missing.ts"] : ["src/domain/booking.ts"]
    }));
    const resumedModule = createPlanningModule({
      contexts: { load: async () => { throw new Error("resume must use the frozen context"); } },
      protocols: { load: async () => { throw new Error("resume must use the frozen protocol"); } },
      proposals: { propose },
      records,
      now: () => "2026-08-03T12:05:00.000Z"
    });

    const outcome = await resumedModule.resume({
      attemptId,
      lease: { runId: "run-resume-1", holderId: "coordinator-2", fenceToken: "fence-12" }
    });

    expect(outcome.kind).toBe("ready");
    expect(outcome.comparison.status).toBe("degraded");
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ attemptId, slot: 1 }));
    expect(records.attempts[0]?.proposals.map((proposal) => proposal.slot)).toEqual([0, 1]);
    expect(records.attempts[0]?.terminal).toEqual(outcome);
  });

  it("compiles one canonical seam into both participant contracts and the graph binding", async () => {
    const records = new InMemoryPlanningRecordPort();
    const module = createPlanningModule({
      contexts: {
        load: async () => ({
          goal: {
            id: "booking-goal",
            statement: "Implement booking creation",
            requiredCriteria: [
              { id: "domain-ready", statement: "The domain creates a booking." },
              { id: "api-ready", statement: "The API exposes booking creation." }
            ]
          },
          repositorySnapshot: bookingSnapshot(),
          resolvedDecisions: []
        })
      },
      protocols: { load: async () => ({ ...productProtocol(), proposalTarget: 1 }) },
      proposals: { propose: async () => twoLeafDraft() },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    const outcome = await module.start({
      lease: { runId: "run-seam-1", holderId: "coordinator-1", fenceToken: "fence-13" },
      protocol: { id: "product-default", revision: "1" }
    });

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") throw new Error(`Expected seam plan to compile, received ${outcome.reason}.`);
    expect(outcome.compiled.graph.seamBindings).toHaveLength(1);
    const binding = outcome.compiled.graph.seamBindings[0]!;
    expect(binding.producerNodeId).not.toBe(binding.consumerNodeId);
    expect(outcome.compiled.contracts).toHaveLength(2);
    expect(outcome.compiled.contracts.every((bundle) => bundle.seams.some((seam) => seam.id === binding.seamContract.id))).toBe(true);
    expect(outcome.compiled.contracts.every((bundle) => bundle.task.seams.some((seam) => seam.id === binding.seamContract.id))).toBe(true);
  });

  it("materializes a file seam as an artifact required by its consumer", async () => {
    const records = new InMemoryPlanningRecordPort();
    const draft = twoLeafDraft();
    if (draft.root.kind !== "composite" || draft.root.children[0]?.kind !== "leaf") throw new Error("Expected producer leaf fixture.");
    draft.root.children[0].surface.plannedPaths = ["src/domain/booking-contract.json"];
    draft.seams[0]!.interface = {
      ...draft.seams[0]!.interface,
      materialization: "files",
      artifactPaths: ["src/domain/booking-contract.json"]
    } as typeof draft.seams[0]["interface"];
    const module = createPlanningModule({
      contexts: {
        load: async () => ({
          goal: {
            id: "booking-goal",
            statement: "Implement booking creation",
            requiredCriteria: [
              { id: "domain-ready", statement: "The domain creates a booking." },
              { id: "api-ready", statement: "The API exposes booking creation." }
            ]
          },
          repositorySnapshot: bookingSnapshot(),
          resolvedDecisions: []
        })
      },
      protocols: { load: async () => ({ ...productProtocol(), proposalTarget: 1 }) },
      proposals: { propose: async () => draft },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    const outcome = await module.start({
      lease: { runId: "run-artifact-1", holderId: "coordinator-1", fenceToken: "fence-16" },
      protocol: { id: "product-default", revision: "1" }
    });

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") throw new Error(`Expected materialized seam to compile, received ${outcome.reason}.`);
    expect(outcome.compiled.graph.artifactRequirements).toHaveLength(1);
    const requirement = outcome.compiled.graph.artifactRequirements[0]!;
    const producer = outcome.compiled.contracts.find((bundle) => bundle.task.nodeId === requirement.producerNodeId)!;
    const consumer = outcome.compiled.contracts.find((bundle) => bundle.task.nodeId === requirement.consumerNodeId)!;
    expect(producer.task.produces).toContainEqual(requirement.artifactContract);
    expect(consumer.task.consumes).toContainEqual(requirement.artifactContract);
    expect(producer.artifacts[0]).toMatchObject({ materialization: "files", expectedPaths: ["src/domain/booking-contract.json"] });
  });

  it("coalesces a bounded cohesive composite without rewriting the semantic plan", async () => {
    const records = new InMemoryPlanningRecordPort();
    const module = createPlanningModule({
      contexts: {
        load: async () => ({
          goal: {
            id: "booking-goal",
            statement: "Implement booking creation",
            requiredCriteria: [
              { id: "domain-ready", statement: "The domain creates a booking." },
              { id: "api-ready", statement: "The API exposes booking creation." },
              { id: "ui-ready", statement: "The UI submits a booking." }
            ]
          },
          repositorySnapshot: bookingSnapshot(),
          resolvedDecisions: []
        })
      },
      protocols: { load: async () => ({ ...productProtocol(), proposalTarget: 1 }) },
      proposals: { propose: async () => nestedCohesiveDraft() },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    const outcome = await module.start({
      lease: { runId: "run-cut-1", holderId: "coordinator-1", fenceToken: "fence-14" },
      protocol: { id: "product-default", revision: "1" }
    });

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") throw new Error(`Expected cohesive cut to compile, received ${outcome.reason}.`);
    const semanticRoot = outcome.selected.plan.root;
    if (semanticRoot.kind !== "composite") throw new Error("Expected the semantic root composite.");
    const backend = semanticRoot.children[0]!;
    const ui = semanticRoot.children[1]!;
    expect(backend.kind).toBe("composite");
    expect(outcome.selected.executionCut.executableModuleIds).toEqual([backend.moduleId, ui.moduleId]);
    expect(outcome.selected.executionCut.assessments).toContainEqual(expect.objectContaining({
      moduleId: backend.moduleId,
      decision: "execute_composite",
      reasons: expect.arrayContaining(["descendants_are_connected", "within_hard_limits"])
    }));
    expect(Object.values(outcome.compiled.graph.nodes).map((node) => node.kind)).toEqual(["root", "leaf", "leaf"]);
    expect(outcome.compiled.contracts).toHaveLength(2);
    expect(backend.kind === "composite" ? backend.children : []).toHaveLength(2);
  });

  it("rejects an over-broad leaf before quorum selection", async () => {
    const records = new InMemoryPlanningRecordPort();
    const broad = bookingDraft();
    if (broad.root.kind !== "composite" || broad.root.children[0]?.kind !== "leaf") throw new Error("Expected booking leaf fixture.");
    broad.root.children[0].surface.plannedPaths = Array.from({ length: 7 }, (_, index) => `src/generated/file-${index}.ts`);
    const module = createPlanningModule({
      contexts: { load: async () => standardContext() },
      protocols: { load: async () => productProtocol() },
      proposals: { propose: async ({ slot }) => slot === 0 ? bookingDraft() : broad },
      records,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    const outcome = await module.start({
      lease: { runId: "run-limit-1", holderId: "coordinator-1", fenceToken: "fence-15" },
      protocol: { id: "product-default", revision: "1" }
    });

    expect(outcome.kind).toBe("ready");
    expect(outcome.rejections).toContainEqual(expect.objectContaining({
      slot: 1,
      issues: expect.arrayContaining([expect.objectContaining({ code: "leaf_scope_limit_exceeded" })])
    }));
    expect(outcome.comparison).toEqual({ status: "degraded", safeCandidates: 1, comparableCandidates: 0 });
  });
});

function bookingDraft(overrides: { existingPaths?: string[]; rationale?: string } = {}): SemanticPlanDraft {
  return {
    rationale: overrides.rationale ?? "Keep the first executable slice cohesive.",
    root: {
      kind: "composite",
      handle: "booking",
      title: "Booking",
      objective: "Deliver booking creation.",
      children: [
        {
          kind: "leaf",
          handle: "booking-domain",
          title: "Booking domain",
          objective: "Implement booking creation in the domain module.",
          surface: {
            existingPaths: overrides.existingPaths ?? ["src/domain/booking.ts"],
            plannedPaths: []
          },
          outcomes: [
            {
              statement: "A valid booking can be created.",
              covers: ["booking-created"],
              verification: {
                kind: "repository_capability",
                capability: "test",
                references: ["tests/api.test.ts"]
              }
            }
          ]
        }
      ]
    },
    seams: []
  };
}

function twoLeafDraft(): SemanticPlanDraft {
  return {
    root: {
      kind: "composite",
      handle: "booking",
      title: "Booking",
      objective: "Deliver booking creation.",
      children: [
        {
          kind: "leaf",
          handle: "domain",
          title: "Booking domain",
          objective: "Create bookings in the domain.",
          surface: { existingPaths: ["src/domain/booking.ts"], plannedPaths: [] },
          outcomes: [{
            statement: "The domain creates a booking.",
            covers: ["domain-ready"],
            verification: { kind: "repository_capability", capability: "test", references: ["tests/api.test.ts"] }
          }]
        },
        {
          kind: "leaf",
          handle: "api",
          title: "Booking API",
          objective: "Expose booking creation through the API.",
          surface: { existingPaths: ["src/api/bookings.ts"], plannedPaths: [] },
          outcomes: [{
            statement: "The API exposes booking creation.",
            covers: ["api-ready"],
            verification: { kind: "repository_capability", capability: "test", references: ["tests/api.test.ts"] }
          }]
        }
      ]
    },
    seams: [{
      handle: "booking-create-api",
      producer: "domain",
      consumers: ["api"],
      interface: {
        kind: "api",
        specification: "createBooking(input) returns the persisted booking or a typed validation error.",
        compatibility: "exact",
        materialization: "logical",
        artifactPaths: [],
        verification: "The API integration test observes the domain result and validation error."
      },
      evidencePaths: ["src/domain/booking.ts", "src/api/bookings.ts", "tests/api.test.ts"]
    }]
  };
}

function nestedCohesiveDraft(): SemanticPlanDraft {
  const base = twoLeafDraft();
  if (base.root.kind !== "composite") throw new Error("Expected fixture composite.");
  return {
    root: {
      ...base.root,
      children: [{
        kind: "composite",
        handle: "backend",
        title: "Booking backend",
        objective: "Implement the cohesive booking backend slice.",
        children: base.root.children
      }, {
        kind: "leaf",
        handle: "ui",
        title: "Booking UI",
        objective: "Submit bookings from the UI.",
        surface: { existingPaths: ["src/ui/BookingForm.tsx"], plannedPaths: [] },
        outcomes: [{
          statement: "The UI submits a booking.",
          covers: ["ui-ready"],
          verification: { kind: "repository_capability", capability: "test", references: ["tests/api.test.ts"] }
        }]
      }]
    },
    seams: base.seams
  };
}

class InMemoryPlanningRecordPort implements PlanningRecordPort {
  readonly attempts: PlanningAttemptRecord[] = [];

  async begin(record: PlanningAttemptRecord): Promise<void> {
    this.attempts.push(structuredClone(record));
  }

  async recordProposal(attemptId: string, _lease: PlanningAttemptRecord["lease"], proposal: PlanningAttemptRecord["proposals"][number]): Promise<void> {
    this.requireAttempt(attemptId).proposals.push(structuredClone(proposal));
  }

  async commitTerminal(attemptId: string, _lease: PlanningAttemptRecord["lease"], terminal: NonNullable<PlanningAttemptRecord["terminal"]>): Promise<void> {
    this.requireAttempt(attemptId).terminal = structuredClone(terminal);
  }

  async load(attemptId: string): Promise<PlanningAttemptRecord | undefined> {
    const attempt = this.attempts.find((candidate) => candidate.attemptId === attemptId);
    return attempt === undefined ? undefined : structuredClone(attempt);
  }

  private requireAttempt(attemptId: string): PlanningAttemptRecord {
    const attempt = this.attempts.find((candidate) => candidate.attemptId === attemptId);
    if (attempt === undefined) throw new Error(`Unknown planning attempt ${attemptId}.`);
    return attempt;
  }
}

class InterruptOncePlanningRecordPort extends InMemoryPlanningRecordPort {
  private interrupted = false;

  constructor(private readonly interruptSlot: number) {
    super();
  }

  override async recordProposal(
    attemptId: string,
    lease: PlanningAttemptRecord["lease"],
    proposal: PlanningAttemptRecord["proposals"][number]
  ): Promise<void> {
    if (proposal.slot === this.interruptSlot && !this.interrupted) {
      this.interrupted = true;
      throw new Error("simulated record interruption");
    }
    await super.recordProposal(attemptId, lease, proposal);
  }
}

class FailingFencedPlanningRecordPort implements PlanningRecordPort {
  receivedFenceToken: string | undefined;
  terminal: PlanningAttemptRecord["terminal"];
  private attempt: PlanningAttemptRecord | undefined;

  constructor(private readonly expectedFenceToken: string) {}

  async begin(record: PlanningAttemptRecord): Promise<void> {
    this.attempt = structuredClone(record);
  }

  async recordProposal(_attemptId: string, _lease: PlanningAttemptRecord["lease"], proposal: PlanningAttemptRecord["proposals"][number]): Promise<void> {
    this.attempt?.proposals.push(structuredClone(proposal));
  }

  async commitTerminal(...args: unknown[]): Promise<void> {
    const lease = args[1] as { fenceToken?: string } | undefined;
    this.receivedFenceToken = lease?.fenceToken;
    if (this.receivedFenceToken !== this.expectedFenceToken) {
      throw new Error("terminal commit did not use the caller fence");
    }
    throw new Error("durable commit unavailable");
  }

  async load(attemptId: string): Promise<PlanningAttemptRecord | undefined> {
    return this.attempt?.attemptId === attemptId ? structuredClone(this.attempt) : undefined;
  }
}

function standardContext() {
  return {
    goal: {
      id: "booking-goal",
      statement: "Implement booking creation",
      requiredCriteria: [{ id: "booking-created", statement: "A valid booking can be created." }]
    },
    repositorySnapshot: bookingSnapshot(),
    resolvedDecisions: []
  };
}

function productProtocol() {
  return {
    id: "product-default",
    revision: "1",
    proposalTarget: 2,
    minSafeCandidates: 1,
    minComparableCandidates: 0,
    allowDegradedComparison: true
  };
}
