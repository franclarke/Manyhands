import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEffectIntent,
  buildPhysicalEffectReceipt,
  type DigestHasher,
  type EffectIntent,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import { buildRunCommandEnvelope } from "@manyhands/run-coordinator";
import type { RunEvent } from "@manyhands/run-coordinator";
import {
  RunActor,
  type RunActorDispatcherPort,
  type RunActorJournalEvent,
  type RunActorJournalInput,
  type RunActorJournalPort
} from "@manyhands/run-engine";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("RunActor durable command authority", () => {
  it("serializes concurrent identical submissions and returns one durable receipt", async () => {
    const journal = new MemoryJournal("epoch:1");
    const dispatcher = new RecordingDispatcher(journal);
    const actor = createActor(journal, dispatcher);
    const envelope = command("command:1", 1);

    const [first, replay] = await Promise.all([actor.submit(envelope), actor.submit(envelope)]);
    await actor.drainEffects();

    expect(replay).toEqual(first);
    expect(journal.events.filter((event) => event.type === "command.accepted")).toHaveLength(1);
    expect(journal.events.filter((event) => event.type === "effect.observed")).toHaveLength(1);
    expect(dispatcher.observed).toHaveLength(1);
  });

  it("accepts only one of two distinct commands competing for the same revision", async () => {
    const journal = new MemoryJournal("epoch:1");
    const actor = createActor(journal, new RecordingDispatcher(journal));

    const results = await Promise.allSettled([
      actor.submit(command("command:1", 1)),
      actor.submit(command("command:2", 1))
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("flushes command and effect intent before the dispatcher can observe it", async () => {
    const journal = new MemoryJournal("epoch:1");
    const dispatcher = new RecordingDispatcher(journal);
    const actor = createActor(journal, dispatcher);

    await actor.submit(command("command:1", 1));
    await actor.drainEffects();

    expect(dispatcher.observedAtRevision).toEqual([3]);
    expect(journal.operations).toEqual([
      "assert:epoch:1",
      "load",
      "appendAndFlush:1",
      "assert:epoch:1",
      "assert:epoch:1",
      "load",
      "appendAndFlush:3"
    ]);
  });

  it("rejects stale daemon authority before accepting a command", async () => {
    const journal = new MemoryJournal("epoch:2");
    const actor = createActor(journal, new RecordingDispatcher(journal), "epoch:1");

    await expect(actor.submit(command("command:1", 1))).rejects.toThrow(/stale daemon epoch/i);
    expect(journal.events).toHaveLength(1);
  });

  it("reconciles a durable intent after a crash without claiming it never ran", async () => {
    const journal = new MemoryJournal("epoch:1");
    const crashing = new RecordingDispatcher(journal, true);
    const firstActor = createActor(journal, crashing);

    await expect(firstActor.submit(command("command:1", 1))).resolves.toEqual(
      expect.objectContaining({ commandId: "command:1" })
    );
    await expect(firstActor.drainEffects()).rejects.toThrow("simulated crash");
    expect(journal.events.map((event) => event.type)).toEqual([
      "run.created",
      "command.accepted",
      "effect.requested"
    ]);

    journal.currentEpoch = "epoch:2";
    const recovered = new RecordingDispatcher(journal);
    const secondActor = createActor(journal, recovered, "epoch:2");
    await secondActor.recoverPendingEffects();

    expect(recovered.reconciled).toEqual([
      expect.objectContaining({ intentEpoch: "epoch:1", observerEpoch: "epoch:2" })
    ]);
    expect(journal.events.at(-1)).toEqual(expect.objectContaining({
      type: "effect.observed",
      payload: { receipt: expect.objectContaining({ observation: "succeeded", daemonEpoch: "epoch:2" }) }
    }));
  });

  it("revalidates authority after intent flush and before starting the physical effect", async () => {
    const journal = new MemoryJournal("epoch:1");
    journal.epochAfterNextAppend = "epoch:2";
    const dispatcher = new RecordingDispatcher(journal);
    const actor = createActor(journal, dispatcher);

    await expect(actor.submit(command("command:1", 1))).resolves.toEqual(
      expect.objectContaining({ commandId: "command:1" })
    );
    await expect(actor.drainEffects()).rejects.toThrow(/stale daemon epoch/i);

    expect(journal.events.map((event) => event.type)).toEqual([
      "run.created",
      "command.accepted",
      "effect.requested"
    ]);
    expect(dispatcher.observed).toEqual([]);
  });

  it("acknowledges durable acceptance before long physical work completes", async () => {
    const journal = new MemoryJournal("epoch:1");
    const physical = deferred<PhysicalEffectReceipt[]>();
    const dispatcher: RunActorDispatcherPort = {
      observe: () => physical.promise,
      reconcile: () => physical.promise
    };
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:1",
      journal,
      dispatcher,
      hasher: sha256,
      clock: () => "2026-08-12T20:00:00.000Z",
      decide: (_command, context) => [buildEffectIntent({
        runId: context.runId,
        attemptId: "attempt:slow",
        kind: "process_spawn",
        inputDigest: "sha256:slow-input",
        daemonEpoch: context.daemonEpoch,
        idempotency: "reconcile_then_repeat",
        requestedAt: "2026-08-12T20:00:01.000Z"
      }, sha256)]
    });

    const receipt = await actor.submit(command("command:slow", 1));

    expect(receipt.commandId).toBe("command:slow");
    expect(journal.events.map((event) => event.type)).toEqual([
      "run.created",
      "command.accepted",
      "effect.requested"
    ]);

    const intent = (journal.events.at(-1) as Extract<RunEvent, { type: "effect.requested" }>).payload.intent;
    physical.resolve([physicalReceipt(intent, "epoch:1")]);
    await actor.drainEffects();
    expect(journal.events.at(-1)?.type).toBe("effect.observed");
  });

  it("accepts another command while prior physical work remains in flight", async () => {
    const journal = new MemoryJournal("epoch:1");
    const physical = deferred<PhysicalEffectReceipt[]>();
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:1",
      journal,
      dispatcher: {
        observe: () => physical.promise,
        reconcile: () => physical.promise
      },
      hasher: sha256,
      clock: () => "2026-08-12T20:00:00.000Z",
      decide: (envelope, context) => envelope.command.type === "slow"
        ? [buildEffectIntent({
          runId: context.runId,
          attemptId: "attempt:mailbox",
          kind: "process_spawn",
          inputDigest: "sha256:mailbox-input",
          daemonEpoch: context.daemonEpoch,
          idempotency: "reconcile_then_repeat",
          requestedAt: "2026-08-12T20:00:01.000Z"
        }, sha256)]
        : []
    });
    const slow = buildRunCommandEnvelope({
      commandId: "command:slow",
      runId: "run:1",
      expectedRevision: 1,
      submittedAt: "2026-08-12T19:59:59.000Z",
      command: { type: "slow" }
    }, sha256);
    const pause = buildRunCommandEnvelope({
      commandId: "command:pause",
      runId: "run:1",
      expectedRevision: 3,
      submittedAt: "2026-08-12T20:00:02.000Z",
      command: { type: "pause" }
    }, sha256);

    await actor.submit(slow);
    await expect(actor.submit(pause)).resolves.toEqual(
      expect.objectContaining({ commandId: "command:pause", acceptedRevision: 4 })
    );
    expect(journal.events.filter((event) => event.type === "command.accepted")).toHaveLength(2);
    expect(journal.events.filter((event) => event.type === "effect.observed")).toHaveLength(0);

    const intent = journal.events.find(
      (event): event is Extract<RunEvent, { type: "effect.requested" }> =>
        event.type === "effect.requested"
    )!.payload.intent;
    physical.resolve([physicalReceipt(intent, "epoch:1")]);
    await actor.drainEffects();
  });
});

function createActor(
  journal: MemoryJournal,
  dispatcher: RecordingDispatcher,
  daemonEpoch = "epoch:1"
): RunActor {
  return new RunActor({
    runId: "run:1",
    daemonEpoch,
    journal,
    dispatcher,
    hasher: sha256,
    clock: () => "2026-08-12T20:00:00.000Z",
    decide: (_command, context) => [buildEffectIntent({
      runId: context.runId,
      attemptId: "attempt:1",
      kind: "process_spawn",
      inputDigest: "sha256:input",
      daemonEpoch: context.daemonEpoch,
      idempotency: "reconcile_then_repeat",
      requestedAt: "2026-08-12T20:00:01.000Z"
    }, sha256)]
  });
}

function command(commandId: string, expectedRevision: number) {
  return buildRunCommandEnvelope({
    commandId,
    runId: "run:1",
    expectedRevision,
    submittedAt: "2026-08-12T19:59:59.000Z",
    command: { type: "start" }
  }, sha256);
}

class MemoryJournal implements RunActorJournalPort {
  events: RunEvent[] = [{
    eventId: "event:created",
    runId: "run:1",
    sequence: 1,
    occurredAt: "2026-08-12T19:00:00.000Z",
    type: "run.created",
    payload: { goal: "Build safely" }
  }];
  operations: string[] = [];
  epochAfterNextAppend: string | undefined;

  constructor(public currentEpoch: string) {}

  async load(_runId: string): Promise<RunEvent[]> {
    this.operations.push("load");
    return structuredClone(this.events);
  }

  async assertAuthority(_runId: string, daemonEpoch: string): Promise<void> {
    this.operations.push(`assert:${daemonEpoch}`);
    if (daemonEpoch !== this.currentEpoch) throw new Error("stale daemon epoch");
  }

  async appendAndFlush(input: {
    runId: string;
    expectedRevision: number;
    daemonEpoch: string;
    events: RunActorJournalInput[];
  }): Promise<RunActorJournalEvent[]> {
    this.operations.push(`appendAndFlush:${input.expectedRevision}`);
    if (input.daemonEpoch !== this.currentEpoch) throw new Error("stale daemon epoch");
    if (input.runId !== "run:1") throw new Error("run mismatch");
    if (input.expectedRevision !== this.events.length) throw new Error("revision conflict");
    const appended = input.events.map((event, index) => ({
      ...structuredClone(event),
      runId: input.runId,
      sequence: input.expectedRevision + index + 1
    })) as RunActorJournalEvent[];
    this.events.push(...appended);
    if (this.epochAfterNextAppend !== undefined) {
      this.currentEpoch = this.epochAfterNextAppend;
      this.epochAfterNextAppend = undefined;
    }
    return structuredClone(appended);
  }
}

class RecordingDispatcher implements RunActorDispatcherPort {
  observed: EffectIntent[] = [];
  observedAtRevision: number[] = [];
  reconciled: Array<{ effectId: string; intentEpoch: string; observerEpoch: string }> = [];

  constructor(
    private readonly journal: MemoryJournal,
    private readonly crashOnObserve = false
  ) {}

  async observe(intent: EffectIntent): Promise<PhysicalEffectReceipt[]> {
    this.observedAtRevision.push(this.journal.events.length);
    if (this.crashOnObserve) throw new Error("simulated crash after durable append");
    this.observed.push(intent);
    return [physicalReceipt(intent, intent.daemonEpoch)];
  }

  async reconcile(intent: EffectIntent, observerDaemonEpoch: string): Promise<PhysicalEffectReceipt[]> {
    this.reconciled.push({
      effectId: intent.effectId,
      intentEpoch: intent.daemonEpoch,
      observerEpoch: observerDaemonEpoch
    });
    return [physicalReceipt(intent, observerDaemonEpoch)];
  }
}

function physicalReceipt(intent: EffectIntent, daemonEpoch: string): PhysicalEffectReceipt {
  return buildPhysicalEffectReceipt({
    effectId: intent.effectId,
    observation: "succeeded",
    inputDigest: intent.inputDigest,
    daemonEpoch,
    resultDigest: "sha256:result",
    observedAt: "2026-08-12T20:00:02.000Z"
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
