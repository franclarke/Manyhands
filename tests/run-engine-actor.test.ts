import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEffectInput,
  buildEffectIntent,
  buildPhysicalEffectReceipt,
  type DigestHasher,
  type EffectInput,
  type EffectInputSpec,
  type EffectIntent,
  type EffectIntentMaterial,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import { buildRunCommandEnvelope } from "@manyhands/run-coordinator";
import type { RunEvent } from "@manyhands/run-coordinator";
import {
  RunActor,
  type EffectInputStorePort,
  type RunActorEffectRequest,
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
    expect(journal.events.filter((event) => event.type === "effect.completed")).toHaveLength(1);
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

  it("persists the exact effect input before appending its intent", async () => {
    const journal = new MemoryJournal("epoch:1");
    const dispatcher = new RecordingDispatcher(journal);
    const actor = createActor(journal, dispatcher);

    await actor.submit(command("command:input-order", 1));
    await actor.drainEffects();

    const requested = journal.events.find(
      (event): event is Extract<RunEvent, { type: "effect.requested" }> =>
        event.type === "effect.requested"
    )!;
    expect(journal.inputStore.inputs.get(requested.payload.intent.inputDigest)).toEqual({
      inputDigest: requested.payload.intent.inputDigest,
      spec: {
        schemaVersion: 1,
        kind: "process_spawn",
        payload: { operation: "process_spawn" }
      }
    });
    expect(journal.timeline.indexOf(`put:${requested.payload.intent.inputDigest}`))
      .toBeLessThan(journal.timeline.indexOf("appendAndFlush:1"));
  });

  it("leaves a benign orphan input when the journal crashes before intent append", async () => {
    const journal = new MemoryJournal("epoch:1");
    journal.failBeforeIntentAppend = true;
    const dispatcher = new RecordingDispatcher(journal);
    const actor = createActor(journal, dispatcher);

    await expect(actor.submit(command("command:orphan", 1))).rejects.toThrow("crash before intent append");

    expect(journal.inputStore.inputs.size).toBe(1);
    expect(journal.events.map((event) => event.type)).toEqual(["run.created"]);
    expect(dispatcher.observed).toEqual([]);
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
      type: "effect.completed",
      payload: expect.objectContaining({ effectId: recovered.reconciled[0]?.effectId })
    }));
    expect(journal.events.at(-2)).toEqual(expect.objectContaining({
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
      inputStore: journal.inputStore,
      hasher: sha256,
      clock: () => "2026-08-12T20:00:00.000Z",
      decide: (_command, context) => [effectRequest({
        runId: context.runId,
        attemptId: "attempt:slow",
        kind: "process_spawn",
        daemonEpoch: context.daemonEpoch,
        idempotency: "reconcile_then_repeat",
        requestedAt: "2026-08-12T20:00:01.000Z"
      })]
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
    expect(journal.events.slice(-2).map((event) => event.type)).toEqual([
      "effect.observed",
      "effect.completed"
    ]);
    expect(journal.appendBatches.at(-1)?.map((event) => event.type)).toEqual([
      "effect.observed",
      "effect.completed"
    ]);
  });

  it("accepts another command while prior physical work remains in flight", async () => {
    const journal = new MemoryJournal("epoch:1");
    const physical = deferred<PhysicalEffectReceipt[]>();
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:1",
      journal,
      inputStore: journal.inputStore,
      dispatcher: {
        observe: () => physical.promise,
        reconcile: () => physical.promise
      },
      hasher: sha256,
      clock: () => "2026-08-12T20:00:00.000Z",
      decide: (envelope, context) => envelope.command.type === "slow"
        ? [effectRequest({
          runId: context.runId,
          attemptId: "attempt:mailbox",
          kind: "process_spawn",
          daemonEpoch: context.daemonEpoch,
          idempotency: "reconcile_then_repeat",
          requestedAt: "2026-08-12T20:00:01.000Z"
        })]
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

  it("keeps started physical evidence pending until an actor terminal event exists", async () => {
    const journal = new MemoryJournal("epoch:1");
    let reconciliations = 0;
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:1",
      journal,
      inputStore: journal.inputStore,
      dispatcher: {
        observe: async (intent) => [physicalReceipt(intent, "epoch:1", "started")],
        reconcile: async (intent) => {
          reconciliations += 1;
          return [physicalReceipt(intent, "epoch:1", "succeeded")];
        }
      },
      hasher: sha256,
      clock: () => "2026-08-12T20:00:00.000Z",
      decide: (_command, context) => [effectRequest({
        runId: context.runId,
        attemptId: "attempt:started",
        kind: "process_spawn",
        daemonEpoch: context.daemonEpoch,
        idempotency: "reconcile_then_repeat",
        requestedAt: "2026-08-12T20:00:01.000Z"
      })]
    });

    await actor.submit(command("command:started", 1));
    await actor.drainEffects();
    expect(journal.events.at(-1)?.type).toBe("effect.observed");
    expect(journal.events.some((event) => event.type === "effect.completed")).toBe(false);

    await actor.recoverPendingEffects();
    expect(reconciliations).toBe(1);
    expect(journal.events.at(-1)?.type).toBe("effect.completed");
  });

  it("preserves successful physical evidence but interrupts a concurrently cancelled effect", async () => {
    const journal = new MemoryJournal("epoch:1");
    const physical = deferred<PhysicalEffectReceipt[]>();
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:1",
      journal,
      inputStore: journal.inputStore,
      dispatcher: { observe: () => physical.promise, reconcile: () => physical.promise },
      hasher: sha256,
      clock: () => "2026-08-12T20:00:05.000Z",
      decide: (_command, context) => [effectRequest({
        runId: context.runId,
        attemptId: "attempt:cancelled",
        kind: "process_spawn",
        daemonEpoch: context.daemonEpoch,
        idempotency: "reconcile_then_repeat",
        requestedAt: "2026-08-12T20:00:01.000Z"
      })]
    });

    await actor.submit(command("command:cancelled", 1));
    journal.events.push({
      eventId: "event:cancel",
      runId: "run:1",
      sequence: 4,
      occurredAt: "2026-08-12T20:00:03.000Z",
      type: "operation.cancel_requested",
      payload: { invalidationReceiptId: "invalidation:1", reason: "operator cancelled" }
    });
    const intent = journal.events.find(
      (event): event is Extract<RunEvent, { type: "effect.requested" }> => event.type === "effect.requested"
    )!.payload.intent;
    physical.resolve([physicalReceipt(intent, "epoch:1")]);
    await actor.drainEffects();

    expect(journal.events.slice(-2).map((event) => event.type)).toEqual([
      "effect.observed",
      "effect.interrupted"
    ]);
    expect(journal.events.at(-1)).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        receiptId: expect.any(String),
        reason: expect.stringMatching(/cancel/i)
      })
    }));
  });

  it("interrupts stale attempt work even when the physical receipt succeeded", async () => {
    const journal = new MemoryJournal("epoch:1");
    const physical = deferred<PhysicalEffectReceipt[]>();
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:1",
      journal,
      inputStore: journal.inputStore,
      dispatcher: { observe: () => physical.promise, reconcile: () => physical.promise },
      hasher: sha256,
      clock: () => "2026-08-12T20:00:05.000Z",
      decide: (_command, context) => [effectRequest({
        runId: context.runId,
        attemptId: "attempt:stale",
        kind: "validation",
        daemonEpoch: context.daemonEpoch,
        idempotency: "repeat_safe",
        requestedAt: "2026-08-12T20:00:01.000Z"
      })]
    });

    await actor.submit(command("command:stale", 1));
    journal.events.push({
      eventId: "event:stale",
      runId: "run:1",
      sequence: 4,
      occurredAt: "2026-08-12T20:00:03.000Z",
      type: "attempt.stale",
      payload: {
        attemptId: "attempt:stale",
        nodeId: "node:1",
        attemptedFingerprint: "sha256:old",
        currentFingerprint: "sha256:new",
        reason: "inputs changed"
      }
    });
    const intent = journal.events.find(
      (event): event is Extract<RunEvent, { type: "effect.requested" }> => event.type === "effect.requested"
    )!.payload.intent;
    physical.resolve([physicalReceipt(intent, "epoch:1")]);
    await actor.drainEffects();

    expect(journal.events.at(-1)).toEqual(expect.objectContaining({
      type: "effect.interrupted",
      payload: expect.objectContaining({ reason: expect.stringMatching(/stale/i) })
    }));
  });

  it("interrupts never-repeat recovery with no evidence without executing it", async () => {
    const journal = new MemoryJournal("epoch:2");
    const intent = buildEffectIntent({
      runId: "run:1",
      attemptId: "attempt:unknown",
      kind: "delivery",
      inputDigest: "sha256:unknown-input",
      daemonEpoch: "epoch:1",
      idempotency: "never_repeat_unknown",
      requestedAt: "2026-08-12T20:00:01.000Z"
    }, sha256);
    journal.events.push({
      eventId: "event:intent:unknown",
      runId: "run:1",
      sequence: 2,
      occurredAt: intent.requestedAt,
      type: "effect.requested",
      payload: { intent }
    });
    let observed = 0;
    let reconciled = 0;
    const actor = new RunActor({
      runId: "run:1",
      daemonEpoch: "epoch:2",
      journal,
      inputStore: journal.inputStore,
      dispatcher: {
        async observe() {
          observed += 1;
          throw new Error("must not execute");
        },
        async reconcile() {
          reconciled += 1;
          return [];
        }
      },
      hasher: sha256,
      clock: () => "2026-08-12T20:00:05.000Z",
      decide: () => []
    });

    await actor.recoverPendingEffects();

    expect(observed).toBe(0);
    expect(reconciled).toBe(1);
    expect(journal.events.at(-1)).toEqual(expect.objectContaining({
      type: "effect.interrupted",
      payload: {
        effectId: intent.effectId,
        reason: expect.stringMatching(/unknown/i)
      }
    }));
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
    inputStore: journal.inputStore,
    hasher: sha256,
    clock: () => "2026-08-12T20:00:00.000Z",
    decide: (_command, context) => [effectRequest({
      runId: context.runId,
      attemptId: "attempt:1",
      kind: "process_spawn",
      daemonEpoch: context.daemonEpoch,
      idempotency: "reconcile_then_repeat",
      requestedAt: "2026-08-12T20:00:01.000Z"
    })]
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

function effectRequest(
  material: Omit<EffectIntentMaterial, "inputDigest">,
  payload: EffectInputSpec["payload"] = { operation: material.kind }
): RunActorEffectRequest {
  const inputSpec: EffectInputSpec = {
    schemaVersion: 1,
    kind: material.kind,
    payload
  };
  const effectInput = buildEffectInput(inputSpec, sha256);
  return {
    inputSpec,
    intent: buildEffectIntent({ ...material, inputDigest: effectInput.inputDigest }, sha256)
  };
}

class MemoryEffectInputStore implements EffectInputStorePort {
  readonly inputs = new Map<string, EffectInput>();

  constructor(private readonly timeline: string[] = []) {}

  async put(spec: EffectInputSpec): Promise<EffectInput> {
    const effectInput = buildEffectInput(spec, sha256);
    this.timeline.push(`put:${effectInput.inputDigest}`);
    this.inputs.set(effectInput.inputDigest, structuredClone(effectInput));
    return structuredClone(effectInput);
  }

  async get(inputDigest: string): Promise<EffectInput | undefined> {
    const input = this.inputs.get(inputDigest);
    return input === undefined ? undefined : structuredClone(input);
  }
}

class MemoryJournal implements RunActorJournalPort {
  readonly timeline: string[] = [];
  readonly inputStore = new MemoryEffectInputStore(this.timeline);
  events: RunEvent[] = [{
    eventId: "event:created",
    runId: "run:1",
    sequence: 1,
    occurredAt: "2026-08-12T19:00:00.000Z",
    type: "run.created",
    payload: { goal: "Build safely" }
  }];
  operations: string[] = [];
  appendBatches: RunActorJournalInput[][] = [];
  epochAfterNextAppend: string | undefined;
  failBeforeIntentAppend = false;

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
    this.timeline.push(`appendAndFlush:${input.expectedRevision}`);
    this.appendBatches.push(structuredClone(input.events));
    if (input.daemonEpoch !== this.currentEpoch) throw new Error("stale daemon epoch");
    if (input.runId !== "run:1") throw new Error("run mismatch");
    if (input.expectedRevision !== this.events.length) throw new Error("revision conflict");
    if (this.failBeforeIntentAppend && input.events.some((event) => event.type === "effect.requested")) {
      this.failBeforeIntentAppend = false;
      throw new Error("crash before intent append");
    }
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

function physicalReceipt(
  intent: EffectIntent,
  daemonEpoch: string,
  observation: "started" | "succeeded" | "failed" = "succeeded"
): PhysicalEffectReceipt {
  return buildPhysicalEffectReceipt({
    effectId: intent.effectId,
    observation,
    inputDigest: intent.inputDigest,
    daemonEpoch,
    ...(observation === "started" ? {} : { resultDigest: "sha256:result" }),
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
