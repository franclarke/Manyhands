import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

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
  foldRun,
  type RunCommandPayload,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";
import {
  RunActor,
  type RunActorDispatcherPort,
  type RunActorJournalPort
} from "@manyhands/run-engine";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 3 cancellation before process start", () => {
  it("interrupts a durably cancelled pending spawn without dispatching it", async () => {
    const journal = new BlockingJournal();
    const dispatched: EffectIntent[] = [];
    const dispatcher: RunActorDispatcherPort = {
      observe: async (intent) => {
        dispatched.push(intent);
        if (intent.kind === "process_spawn") throw new Error("obsolete spawn was dispatched");
        return [successfulReceipt(intent)];
      },
      reconcile: async (intent) => {
        dispatched.push(intent);
        if (intent.kind === "process_spawn") throw new Error("obsolete spawn was reconciled");
        return [successfulReceipt(intent)];
      }
    };
    const spawn = spawnEffect();
    const cleanup = cleanupEffect();
    const actor = new RunActor({
      runId: "run:cancel-before-started",
      daemonEpoch: "epoch:stage3",
      journal,
      dispatcher,
      inputStore: {
        put: async (spec) => buildEffectInput(spec, sha256)
      },
      decide: (command) => command.command.type === "start_run"
        ? { effects: [spawn] }
        : {
            eventsAfterAcceptance: [{
              eventId: "event:cancel-requested",
              occurredAt: "2026-08-13T12:00:02.000Z",
              type: "operation.cancel_requested",
              payload: {
                invalidationReceiptId: "command:cancel",
                reason: "operator cancelled before process start"
              }
            }],
            effects: [cleanup]
          },
      react: (observation, context) => ({
        domainEvents: context.projection.lifecycle === "cancelling"
          && Object.keys(context.projection.effectIntents).every((effectId) =>
            context.projection.effectTerminals[effectId] !== undefined)
          ? [{
              eventId: "event:cancelled",
              occurredAt: "2026-08-13T12:00:03.000Z",
              type: "operation.interrupted",
              payload: {
                processReceiptId: observation.receipts.find((receipt) =>
                  receipt.observation !== "started")?.receiptId
                  ?? `effect:${observation.intent.effectId}`,
                allDead: true
              }
            }]
          : [],
        effects: []
      }),
      hasher: sha256,
      clock: () => "2026-08-13T12:00:03.000Z"
    });

    await actor.submit(command("command:start", 1, { type: "start_run" }));
    await journal.effectDispatchBlocked.promise;
    await actor.submit(command("command:cancel", 3, {
      type: "cancel_run",
      reason: "operator cancelled before process start"
    }));

    journal.allowEffectDispatch.resolve();
    await actor.drainEffects();

    expect(dispatched.map((intent) => intent.kind)).toEqual(["cleanup"]);
    const projection = foldRun(journal.events);
    expect(projection.effectTerminals[spawn.intent.effectId]?.status).toBe("interrupted");
    expect(projection.effectTerminals[cleanup.intent.effectId]?.status).toBe("completed");
    expect(journal.events.filter((event) => event.type === "operation.interrupted")).toHaveLength(1);
    expect(projection.lifecycle).toBe("interrupted");
  });
});

class BlockingJournal implements RunActorJournalPort {
  readonly effectDispatchBlocked = deferred<void>();
  readonly allowEffectDispatch = deferred<void>();
  readonly events: RunEvent[] = [{
    eventId: "event:run-created",
    runId: "run:cancel-before-started",
    sequence: 1,
    occurredAt: "2026-08-13T12:00:00.000Z",
    type: "run.created",
    payload: { goal: "Cancel before spawning a process" }
  }];
  private authorityChecks = 0;

  async load(): Promise<RunEvent[]> {
    return structuredClone(this.events);
  }

  async assertAuthority(_runId: string, daemonEpoch: string): Promise<void> {
    if (daemonEpoch !== "epoch:stage3") throw new Error("stale daemon epoch");
    this.authorityChecks += 1;
    if (this.authorityChecks === 2) {
      this.effectDispatchBlocked.resolve();
      await this.allowEffectDispatch.promise;
    }
  }

  async appendAndFlush(input: {
    runId: string;
    expectedRevision: number;
    daemonEpoch: string;
    events: RunEventInput[];
  }): Promise<RunEvent[]> {
    if (input.daemonEpoch !== "epoch:stage3") throw new Error("stale daemon epoch");
    if (input.expectedRevision !== this.events.length) throw new Error("revision conflict");
    const appended = input.events.map((event, index) => ({
      ...structuredClone(event),
      runId: input.runId,
      sequence: input.expectedRevision + index + 1
    })) as RunEvent[];
    this.events.push(...appended);
    return structuredClone(appended);
  }
}

function spawnEffect() {
  const inputSpec: EffectInputSpec = {
    schemaVersion: 1,
    kind: "process_spawn",
    payload: { operation: "deterministic_fake" }
  };
  return {
    inputSpec,
    intent: buildEffectIntent({
      runId: "run:cancel-before-started",
      attemptId: "stage3:execution",
      kind: "process_spawn",
      inputDigest: buildEffectInput(inputSpec, sha256).inputDigest,
      daemonEpoch: "epoch:stage3",
      idempotency: "reconcile_then_repeat",
      requestedAt: "2026-08-13T12:00:01.000Z"
    }, sha256)
  };
}

function cleanupEffect() {
  const inputSpec: EffectInputSpec = {
    schemaVersion: 1,
    kind: "cleanup",
    payload: {
      resourceKind: "run_control",
      resourceId: "run:cancel-before-started"
    }
  };
  return {
    inputSpec,
    intent: buildEffectIntent({
      runId: "run:cancel-before-started",
      attemptId: "stage3:cancel:cleanup",
      kind: "cleanup",
      inputDigest: buildEffectInput(inputSpec, sha256).inputDigest,
      daemonEpoch: "epoch:stage3",
      idempotency: "repeat_safe",
      requestedAt: "2026-08-13T12:00:02.000Z"
    }, sha256)
  };
}

function successfulReceipt(intent: EffectIntent): PhysicalEffectReceipt {
  return buildPhysicalEffectReceipt({
    effectId: intent.effectId,
    observation: "succeeded",
    inputDigest: intent.inputDigest,
    daemonEpoch: intent.daemonEpoch,
    resultDigest: "sha256:cleanup-complete",
    observedAt: "2026-08-13T12:00:03.000Z"
  }, sha256);
}

function command(
  commandId: string,
  expectedRevision: number,
  payload: RunCommandPayload
) {
  return buildRunCommandEnvelope({
    commandId,
    runId: "run:cancel-before-started",
    expectedRevision,
    submittedAt: "2026-08-13T12:00:00.000Z",
    command: payload
  }, sha256);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
