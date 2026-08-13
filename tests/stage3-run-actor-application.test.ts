import { createHash } from "node:crypto";

import {
  buildEffectInput,
  buildEffectIntent,
  buildPhysicalEffectReceipt,
  type DigestHasher,
  type EffectInputSpec,
  type EffectIntent,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";
import {
  RunActor,
  type RunActorDispatcherPort,
  type RunActorJournalPort
} from "@manyhands/run-engine";
import { describe, expect, it } from "vitest";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 3 run actor application authority", () => {
  it("bootstraps run.created and accepts create_run in one actor-owned durable batch", async () => {
    const journal = new MemoryApplicationJournal();
    const actor = new RunActor({
      runId: "run:stage3",
      daemonEpoch: "epoch:stage3",
      journal,
      dispatcher: noEffects(),
      inputStore: {
        put: async (spec) => buildEffectInput(spec, sha256)
      },
      decide: (_command, context) => ({
        eventsBeforeAcceptance: [{
          eventId: "run:stage3:created",
          occurredAt: "2026-08-13T03:00:00.000Z",
          type: "run.created",
          payload: { goal: "Prove daemon ownership" }
        }],
        eventsAfterAcceptance: [],
        effects: [],
        observedRevision: context.currentRevision
      }),
      hasher: sha256,
      clock: () => "2026-08-13T03:00:00.000Z"
    });

    const receipt = await actor.submit(buildRunCommandEnvelope({
      commandId: "command:create:stage3",
      runId: "run:stage3",
      expectedRevision: 0,
      submittedAt: "2026-08-13T02:59:59.000Z",
      command: { type: "create_run", goal: "Prove daemon ownership" }
    }, sha256));

    expect(receipt.acceptedRevision).toBe(2);
    expect(journal.events.map((event) => event.type)).toEqual([
      "run.created",
      "command.accepted"
    ]);
  });

  it("decides from the current projection and reacts to an effect terminal through the same mailbox", async () => {
    const journal = new MemoryApplicationJournal([createdEvent()]);
    let observedLifecycle: string | undefined;
    const execution = effect("epoch:stage3");
    const dispatcher: RunActorDispatcherPort = {
      observe: async () => [successfulReceipt(execution.intent)],
      reconcile: async () => [successfulReceipt(execution.intent)]
    };
    const actor = new RunActor({
      runId: "run:stage3",
      daemonEpoch: "epoch:stage3",
      journal,
      dispatcher,
      inputStore: {
        put: async (spec) => buildEffectInput(spec, sha256)
      },
      decide: (_command, context) => {
        observedLifecycle = context.projection?.lifecycle;
        return {
          eventsBeforeAcceptance: [],
          eventsAfterAcceptance: [{
            eventId: "graph:stage3:proposed",
            occurredAt: "2026-08-13T03:00:01.000Z",
            type: "graph.revision.proposed",
            payload: { graphId: "graph:stage3", revision: 1 }
          }],
          effects: [execution]
        };
      },
      react: (_terminal, context) => ({
        domainEvents: [{
          eventId: "run:stage3:effect-result-adopted",
          occurredAt: "2026-08-13T03:00:03.000Z",
          type: "run.failed",
          payload: { reason: "deterministic terminal reaction", area: "domain" }
        }],
        effects: [],
        observedRevision: context.currentRevision
      }),
      hasher: sha256,
      clock: () => "2026-08-13T03:00:01.000Z"
    });

    await actor.submit(buildRunCommandEnvelope({
      commandId: "command:start:stage3",
      runId: "run:stage3",
      expectedRevision: 1,
      submittedAt: "2026-08-13T03:00:00.000Z",
      command: { type: "start_run" }
    }, sha256));
    await actor.drainEffects();

    expect(observedLifecycle).toBe("planning");
    expect(journal.events.map((event) => event.type)).toEqual([
      "run.created",
      "command.accepted",
      "graph.revision.proposed",
      "effect.requested",
      "effect.observed",
      "effect.completed",
      "run.failed"
    ]);
  });
});

class MemoryApplicationJournal implements RunActorJournalPort {
  readonly events: RunEvent[];

  constructor(events: RunEvent[] = []) {
    this.events = structuredClone(events);
  }

  async load(): Promise<RunEvent[]> {
    return structuredClone(this.events);
  }

  async assertAuthority(_runId: string, daemonEpoch: string): Promise<void> {
    if (daemonEpoch !== "epoch:stage3") throw new Error("stale daemon epoch");
  }

  async appendAndFlush(input: {
    runId: string;
    expectedRevision: number;
    daemonEpoch: string;
    events: RunEventInput[];
  }): Promise<RunEvent[]> {
    if (input.expectedRevision !== this.events.length) throw new Error("revision conflict");
    await this.assertAuthority(input.runId, input.daemonEpoch);
    const appended = input.events.map((event, index) => ({
      ...structuredClone(event),
      runId: input.runId,
      sequence: input.expectedRevision + index + 1
    })) as RunEvent[];
    this.events.push(...appended);
    return structuredClone(appended);
  }
}

function noEffects(): RunActorDispatcherPort {
  return {
    observe: async () => [],
    reconcile: async () => []
  };
}

function createdEvent(): RunEvent {
  return {
    eventId: "run:stage3:created",
    runId: "run:stage3",
    sequence: 1,
    occurredAt: "2026-08-13T03:00:00.000Z",
    type: "run.created",
    payload: { goal: "Prove daemon ownership" }
  };
}

function effect(daemonEpoch: string) {
  const inputSpec: EffectInputSpec = {
    schemaVersion: 1,
    kind: "process_spawn",
    payload: { operation: "deterministic_fake" }
  };
  return {
    inputSpec,
    intent: buildEffectIntent({
      runId: "run:stage3",
      attemptId: "attempt:stage3",
      kind: "process_spawn",
      inputDigest: buildEffectInput(inputSpec, sha256).inputDigest,
      daemonEpoch,
      idempotency: "reconcile_then_repeat",
      requestedAt: "2026-08-13T03:00:01.000Z"
    }, sha256)
  };
}

function successfulReceipt(intent: EffectIntent): PhysicalEffectReceipt {
  return buildPhysicalEffectReceipt({
    effectId: intent.effectId,
    observation: "succeeded" as const,
    inputDigest: intent.inputDigest,
    daemonEpoch: intent.daemonEpoch,
    resultDigest: "sha256:deterministic-result",
    observedAt: "2026-08-13T03:00:02.000Z"
  }, sha256);
}
