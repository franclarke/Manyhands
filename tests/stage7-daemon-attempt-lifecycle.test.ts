import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DigestHasher } from "@manyhands/contracts";
import { buildRunCommandEnvelope, foldRun, RunEventSchema, type RunEvent, type RunEventInput } from "@manyhands/run-coordinator";
import { RunActor } from "@manyhands/run-engine";
import { createProductRunApplication } from "../apps/daemon/src/product-run-application.js";
import { startProductiveDaemon } from "../apps/daemon/src/productive-daemon.js";
import { JsonlRunEventStore } from "@manyhands/run-store";

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

  it("replays a persisted review as stale after a restarted daemon receives a newer integration candidate", async () => {
    const firstCandidate = exactCandidate("a", "b", "one");
    const secondCandidate = exactCandidate("c", "d", "two");
    const journal = new MemoryJournal([
      ...seedEvents(),
      event(6, "integration.started", {
        attemptId: "integration-1", nodeId: "node-1", inputFingerprint: "sha256:integration-one",
        executorProfile: { id: "fake", revision: "1" }, requiredArtifactIds: ["artifact-1"]
      }),
      event(7, "integration.completed", {
        attemptId: "integration-1", nodeId: "node-1", manifestId: "integration-manifest-1",
        candidateCommit: firstCandidate.commitOid, candidate: firstCandidate, matrix: matrix("matrix-integration-1", firstCandidate.commitOid)
      })
    ]);
    const review = buildRunCommandEnvelope({
      commandId: "command-integration-review",
      runId,
      expectedRevision: 7,
      submittedAt: at,
      command: {
        type: "record_human_review",
        review: {
          reviewId: "review-integration-1",
          attemptId: "integration-1",
          nodeId: "node-1",
          candidate: firstCandidate,
          rubricDigest: "sha256:rubric-integration",
          authority: "operator",
          reviewerId: "operator:franc",
          decision: "approved",
          reviewedAt: at
        }
      }
    }, sha256);

    const receipt = await actor(journal).submit(review);
    await journal.appendAndFlush({
      runId,
      expectedRevision: journal.events.length,
      daemonEpoch: "daemon-stage7",
      events: [
        eventInput("integration.started", {
          attemptId: "integration-2", nodeId: "node-1", inputFingerprint: "sha256:integration-two",
          retryOfAttemptId: "integration-1", executorProfile: { id: "fake", revision: "1" }, requiredArtifactIds: ["artifact-1"]
        }),
        eventInput("integration.completed", {
          attemptId: "integration-2", nodeId: "node-1", manifestId: "integration-manifest-2",
          candidateCommit: secondCandidate.commitOid, candidate: secondCandidate, matrix: matrix("matrix-integration-2", secondCandidate.commitOid)
        })
      ]
    });

    const replay = await actor(journal).submit(review);
    expect(replay).toEqual(receipt);
    expect(foldRun(journal.events).humanReviews["review-integration-1"]?.status).toBe("stale");
  });

  it("keeps the stale integration review across a real daemon restart and journal replay", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-daemon-"));
    const events = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
    const firstCandidate = exactCandidate("a", "b", "daemon-one");
    const secondCandidate = exactCandidate("c", "d", "daemon-two");
    const seedAuthority = await events.claimAuthority(runId, "seed:stage7");
    await events.appendFenced(runId, 0, seedAuthority, [
      eventInput("run.created", { goal: "Persist exact integration review" }),
      eventInput("graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      eventInput("graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      eventInput("integration.started", {
        attemptId: "integration-daemon-1", nodeId: "node-1", inputFingerprint: "sha256:daemon-one",
        executorProfile: { id: "fake", revision: "1" }, requiredArtifactIds: ["artifact-1"]
      }),
      eventInput("integration.completed", {
        attemptId: "integration-daemon-1", nodeId: "node-1", manifestId: "integration-daemon-manifest-1",
        candidateCommit: firstCandidate.commitOid, candidate: firstCandidate, matrix: matrix("matrix-daemon-1", firstCandidate.commitOid)
      })
    ]);
    const review = buildRunCommandEnvelope({
      commandId: "command-daemon-integration-review",
      runId,
      expectedRevision: 5,
      submittedAt: at,
      command: {
        type: "record_human_review",
        review: {
          reviewId: "review-daemon-integration-1",
          attemptId: "integration-daemon-1",
          nodeId: "node-1",
          candidate: firstCandidate,
          rubricDigest: "sha256:rubric-daemon-integration",
          authority: "operator",
          reviewerId: "operator:franc",
          decision: "approved",
          reviewedAt: at
        }
      }
    }, sha256);
    const first = await productiveDaemon(stateRoot, "first");
    try {
      await first.engine.submit(review);
    } finally {
      await first.close();
    }
    const workerAuthority = await events.claimAuthority(runId, "worker:stage7");
    await events.appendFenced(runId, 7, workerAuthority, [
      eventInput("integration.started", {
        attemptId: "integration-daemon-2", nodeId: "node-1", inputFingerprint: "sha256:daemon-two",
        retryOfAttemptId: "integration-daemon-1", executorProfile: { id: "fake", revision: "1" }, requiredArtifactIds: ["artifact-1"]
      }),
      eventInput("integration.completed", {
        attemptId: "integration-daemon-2", nodeId: "node-1", manifestId: "integration-daemon-manifest-2",
        candidateCommit: secondCandidate.commitOid, candidate: secondCandidate, matrix: matrix("matrix-daemon-2", secondCandidate.commitOid)
      })
    ]);
    const recovered = await productiveDaemon(stateRoot, "recovered");
    try {
      await recovered.engine.submit(review);
      expect((await recovered.engine.query(runId)).humanReviews["review-daemon-integration-1"]?.status).toBe("stale");
      expect((await events.load(runId)).filter((event) => event.type === "human_review.recorded")).toHaveLength(1);
    } finally {
      await recovered.close();
      await rm(stateRoot, { recursive: true, force: true });
    }
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

function exactCandidate(commit: string, tree: string, manifest: string) {
  return {
    manifestDigest: `sha256:manifest-${manifest}`,
    commitOid: commit.repeat(40),
    treeOid: tree.repeat(40)
  };
}

function matrix(matrixId: string, candidateCommit: string) {
  return {
    matrixId,
    candidateCommit,
    validationContract: { id: "validation-1", revision: "1" },
    criteria: [{
      criterionId: "criterion-1",
      obligationId: "obligation-1",
      status: "satisfied" as const,
      justification: "The exact candidate was validated.",
      evidenceRefs: ["evidence-1"]
    }],
    outcome: "verified" as const,
    validationRecipeDigest: "sha256:recipe-1",
    evidenceBindings: [],
    observations: []
  };
}

function eventInput(type: string, payload: Record<string, unknown>): RunEventInput {
  return { eventId: `worker:${type}:${payload.attemptId as string ?? randomUUID()}`, occurredAt: at, type, payload } as RunEventInput;
}

function event(sequence: number, type: string, payload: Record<string, unknown>): RunEvent {
  return RunEventSchema.parse({ eventId: `event-${sequence}`, runId, sequence, occurredAt: at, type, payload });
}

function productiveDaemon(stateRoot: string, label: string) {
  return startProductiveDaemon({
    stateRoot,
    endpoint: endpoint(label),
    processStartIdentity: `process:stage7:${label}`,
    processIdentityProbe: { probe: async () => "dead" as const },
    createDaemonEpoch: () => `daemon:stage7:${label}`,
    clock: () => at,
    production: false,
    profile: {
      kind: "deterministic_fake",
      nodeExecutable: process.execPath,
      workerScriptPath: process.execPath,
      cwd: process.cwd()
    }
  });
}

function endpoint(label: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\mh-stage7-${label}-${randomUUID()}`
    : path.join(os.tmpdir(), `mh-stage7-${label}-${randomUUID()}.sock`);
}
