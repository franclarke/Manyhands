import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DigestHasher } from "@manyhands/contracts";
import { buildRunCommandEnvelope, foldRun, RunEventSchema, type RunEvent } from "@manyhands/run-coordinator";
import { RunActor } from "@manyhands/run-engine";
import { createProductRunApplication } from "../apps/daemon/src/product-run-application.js";

const at = "2026-08-14T12:00:00.000Z";
const runId = "run-stage7-review";
const candidate = "a".repeat(40);
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 7 daemon review lifecycle", () => {
  it("persists one exact human review through the actor and replays its original receipt after restart", async () => {
    const journal = new MemoryJournal(seedEvents());
    const command = buildRunCommandEnvelope({
      commandId: "command-review-1",
      runId,
      expectedRevision: 5,
      submittedAt: at,
      command: {
        type: "record_human_review",
        review: {
          reviewId: "review-1",
          attemptId: "attempt-1",
          nodeId: "node-1",
          candidate: { manifestDigest: "sha256:manifest-one", commitOid: candidate, treeOid: "b".repeat(40) },
          rubricDigest: "sha256:rubric-one",
          authority: "operator",
          reviewerId: "operator:franc",
          decision: "approved",
          reviewedAt: at
        }
      }
    }, sha256);

    const first = await actor(journal).submit(command);
    const replay = await actor(journal).submit(command);
    const recovered = await actor(journal).submit(command);

    expect(replay).toEqual(first);
    expect(recovered).toEqual(first);
    expect(journal.events.filter((event) => event.type === "command.accepted")).toHaveLength(1);
    expect(journal.events.filter((event) => event.type === "human_review.recorded")).toHaveLength(1);
    expect(foldRun(journal.events).humanReviews["review-1"]).toMatchObject({
      status: "active",
      candidate: { commitOid: candidate },
      rubricDigest: "sha256:rubric-one"
    });
  });

  it("refuses a review that names an older candidate after the node has advanced", async () => {
    const journal = new MemoryJournal([
      ...seedEvents(),
      event(6, "attempt.started", { attemptId: "attempt-2", nodeId: "node-1", inputFingerprint: "sha256:input-two", executorProfile: { id: "fake", revision: "1" } }),
      event(7, "attempt.candidate_created", {
        attemptId: "attempt-2", nodeId: "node-1", candidateCommit: "c".repeat(40), outputDigest: "sha256:output-two", changedFiles: ["src/a.ts"],
        candidate: { manifestDigest: "sha256:manifest-two", commitOid: "c".repeat(40), treeOid: "d".repeat(40) }
      })
    ]);
    const command = buildRunCommandEnvelope({
      commandId: "command-stale-review",
      runId,
      expectedRevision: 7,
      submittedAt: at,
      command: reviewCommand("review-stale")
    }, sha256);

    await expect(actor(journal).submit(command)).rejects.toThrow(/stale for node/i);
    expect(journal.events).toHaveLength(7);
  });
});

function actor(journal: MemoryJournal): RunActor {
  const application = createProductRunApplication({
    hasher: sha256,
    clock: () => at,
    executionProcess: () => ({ executable: process.execPath, argv: ["-e", ""], cwd: process.cwd(), env: {} })
  });
  return new RunActor({
    runId,
    daemonEpoch: "daemon-stage7",
    journal,
    dispatcher: { observe: async () => [], reconcile: async () => [] },
    inputStore: { put: async () => { throw new Error("No effect is expected for a human review."); } },
    decide: application.decide,
    react: application.react,
    hasher: sha256,
    clock: () => at
  });
}

class MemoryJournal {
  readonly events: RunEvent[];

  constructor(events: RunEvent[]) {
    this.events = events;
  }

  async load(): Promise<RunEvent[]> { return structuredClone(this.events); }
  async assertAuthority(): Promise<void> {}
  async appendAndFlush(input: { runId: string; expectedRevision: number; daemonEpoch: string; events: Array<Omit<RunEvent, "runId" | "sequence">> }): Promise<RunEvent[]> {
    if (input.runId !== runId || input.daemonEpoch !== "daemon-stage7" || input.expectedRevision !== this.events.length) throw new Error("Unexpected actor journal write.");
    const appended = input.events.map((event, index) => RunEventSchema.parse({ ...event, runId, sequence: this.events.length + index + 1 }));
    this.events.push(...appended);
    return appended;
  }
}

function seedEvents(): RunEvent[] {
  return [
    event(1, "run.created", { goal: "Review exact candidate" }),
    event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
    event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
    event(4, "attempt.started", { attemptId: "attempt-1", nodeId: "node-1", inputFingerprint: "sha256:input", executorProfile: { id: "fake", revision: "1" } }),
    event(5, "attempt.candidate_created", {
      attemptId: "attempt-1", nodeId: "node-1", candidateCommit: candidate, outputDigest: "sha256:output", changedFiles: ["src/a.ts"],
      candidate: { manifestDigest: "sha256:manifest-one", commitOid: candidate, treeOid: "b".repeat(40) }
    })
  ];
}

function reviewCommand(reviewId: string) {
  return {
    type: "record_human_review" as const,
    review: {
      reviewId,
      attemptId: "attempt-1",
      nodeId: "node-1",
      candidate: { manifestDigest: "sha256:manifest-one", commitOid: candidate, treeOid: "b".repeat(40) },
      rubricDigest: "sha256:rubric-one",
      authority: "operator" as const,
      reviewerId: "operator:franc",
      decision: "approved" as const,
      reviewedAt: at
    }
  };
}

function event(sequence: number, type: string, payload: Record<string, unknown>): RunEvent {
  return RunEventSchema.parse({ eventId: `event-${sequence}`, runId, sequence, occurredAt: at, type, payload });
}
