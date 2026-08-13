import { describe, expect, it } from "vitest";
import { EffectIntentSchema, PhysicalEffectReceiptSchema } from "@manyhands/contracts";
import { CommandReceiptSchema, RunEventSchema, foldRun } from "@manyhands/run-coordinator";

describe("run coordinator command and effect facts", () => {
  it("round-trips a strict durable command receipt", () => {
    const receipt = {
      schemaVersion: 1,
      receiptId: "receipt:command:1",
      commandId: "command:1",
      runId: "run:1",
      commandDigest: "digest:command:1",
      acceptedRevision: 2,
      daemonEpoch: "daemon:epoch:1",
      acceptedAt: "2026-08-12T15:00:00.000Z"
    } as const;

    expect(CommandReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(CommandReceiptSchema.safeParse({ ...receipt, acceptedRevision: 0 }).success).toBe(false);
    expect(CommandReceiptSchema.safeParse({ ...receipt, transportState: "sent" }).success).toBe(false);
  });

  it("round-trips strict command, physical-effect and actor-terminal facts", () => {
    const commandReceipt = commandReceiptFixture();
    const intent = effectIntentFixture();
    const physicalReceipt = physicalReceiptFixture();
    const events = [
      event(2, "command.accepted", { receipt: commandReceipt }),
      event(3, "effect.requested", { intent }),
      event(4, "effect.observed", { receipt: physicalReceipt }),
      event(5, "effect.interrupted", {
        effectId: intent.effectId,
        receiptId: physicalReceipt.receiptId,
        reason: "operator cancellation superseded the physical observation"
      })
    ];

    expect(CommandReceiptSchema.parse(commandReceipt)).toEqual(commandReceipt);
    expect(EffectIntentSchema.parse(intent)).toEqual(intent);
    expect(PhysicalEffectReceiptSchema.parse(physicalReceipt)).toEqual(physicalReceipt);
    expect(events.map((item) => RunEventSchema.parse(item))).toEqual(events);
    expect(RunEventSchema.safeParse({
      ...event(3, "effect.requested", { intent }),
      payload: { intent, dispatcherStatus: "started" }
    }).success).toBe(false);
    expect(RunEventSchema.safeParse(event(5, "effect.completed", {
      effectId: intent.effectId,
      receiptId: physicalReceipt.receiptId,
      reason: "success events do not carry failure reasons"
    })).success).toBe(false);
    expect(RunEventSchema.safeParse(event(5, "effect.failed", {
      effectId: intent.effectId,
      receiptId: physicalReceipt.receiptId
    })).success).toBe(false);
  });

  it("rebuilds an accepted command and pending effect intent from the journal", () => {
    const commandReceipt = commandReceiptFixture();
    const intent = effectIntentFixture();
    const state = foldRun([
      RunEventSchema.parse(event(1, "run.created", { goal: "Build safely" })),
      RunEventSchema.parse(event(2, "command.accepted", { receipt: commandReceipt })),
      RunEventSchema.parse(event(3, "effect.requested", { intent }))
    ]);

    expect(state.commandReceipts).toEqual({ [commandReceipt.commandId]: commandReceipt });
    expect(state.effectIntents).toEqual({ [intent.effectId]: intent });
    expect(state.physicalEffectReceipts).toEqual({});
    expect(state.effectTerminals).toEqual({});
    expect(Object.keys(state.effectIntents).filter((effectId) => state.effectTerminals[effectId] === undefined))
      .toEqual([intent.effectId]);
    expect(state.lifecycle).toBe("planning");
  });

  it("indexes a physical receipt without treating it as lifecycle or attempt success", () => {
    const intent = effectIntentFixture();
    const receipt = {
      ...physicalReceiptFixture(),
      observation: "succeeded" as const,
      daemonEpoch: "daemon:epoch:2"
    };
    const state = foldRun([
      RunEventSchema.parse(event(1, "run.created", { goal: "Build safely" })),
      RunEventSchema.parse(event(2, "effect.requested", { intent })),
      RunEventSchema.parse(event(3, "effect.observed", { receipt }))
    ]);

    expect(state.physicalEffectReceipts).toEqual({ [receipt.receiptId]: receipt });
    expect(state.effectTerminals).toEqual({});
    expect(state.lifecycle).toBe("planning");
    expect(state.attempts).toEqual({});
    expect(state.outcomes).toEqual({ execution: "pending", artifact: "missing", delivery: "not_started" });
  });

  it("resolves pending work only from an actor-owned terminal event", () => {
    const intent = effectIntentFixture();
    const receipt = {
      ...physicalReceiptFixture(),
      observation: "succeeded" as const,
      resultDigest: "digest:result:1"
    };
    const state = foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.observed", { receipt }),
      event(4, "effect.completed", {
        effectId: intent.effectId,
        receiptId: receipt.receiptId
      })
    ));

    expect(state.effectTerminals).toEqual({
      [intent.effectId]: {
        status: "completed",
        receiptId: receipt.receiptId
      }
    });
    expect(Object.keys(state.effectIntents).filter((effectId) => state.effectTerminals[effectId] === undefined))
      .toEqual([]);
  });

  it("keeps a successful physical receipt while interruption remains the logical outcome", () => {
    const intent = effectIntentFixture();
    const receipt = {
      ...physicalReceiptFixture(),
      observation: "succeeded" as const,
      resultDigest: "digest:result:1"
    };
    const state = foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.observed", { receipt }),
      event(4, "effect.interrupted", {
        effectId: intent.effectId,
        receiptId: receipt.receiptId,
        reason: "attempt:1 became stale before adoption"
      })
    ));

    expect(state.physicalEffectReceipts[receipt.receiptId]).toEqual(receipt);
    expect(state.effectTerminals[intent.effectId]).toEqual({
      status: "interrupted",
      receiptId: receipt.receiptId,
      reason: "attempt:1 became stale before adoption"
    });
  });

  it("rejects terminal events that do not bind to their intent and physical receipt", () => {
    const intent = effectIntentFixture();
    const succeeded = {
      ...physicalReceiptFixture(),
      observation: "succeeded" as const,
      resultDigest: "digest:result:1"
    };
    const failed = {
      ...physicalReceiptFixture(),
      receiptId: "receipt:physical:failed",
      observation: "failed" as const
    };

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.completed", { effectId: intent.effectId, receiptId: succeeded.receiptId })
    ))).toThrow(/physical receipt/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.observed", { receipt: failed }),
      event(4, "effect.completed", { effectId: intent.effectId, receiptId: failed.receiptId })
    ))).toThrow(/succeeded/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.observed", { receipt: succeeded }),
      event(4, "effect.completed", { effectId: intent.effectId, receiptId: succeeded.receiptId }),
      event(5, "effect.interrupted", { effectId: intent.effectId, reason: "too late" })
    ))).toThrow(/already terminal/i);
  });

  it("rejects command, effect and receipt identity reuse", () => {
    const commandReceipt = commandReceiptFixture();
    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "command.accepted", { receipt: commandReceipt }),
      event(3, "command.accepted", {
        receipt: { ...commandReceipt, commandDigest: "digest:changed", acceptedRevision: 3 }
      })
    ))).toThrow(/command.*already/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "command.accepted", { receipt: commandReceipt }),
      event(3, "command.accepted", {
        receipt: { ...commandReceipt, commandId: "command:2", commandDigest: "digest:command:2" }
      })
    ))).toThrow(/receipt.*already/i);

    const intent = effectIntentFixture();
    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.requested", {
        intent: { ...intent, inputDigest: "digest:changed" }
      })
    ))).toThrow(/effect.*already/i);

    const receipt = physicalReceiptFixture();
    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.observed", { receipt }),
      event(4, "effect.observed", {
        receipt: { ...receipt, observation: "failed" }
      })
    ))).toThrow(/receipt.*already/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "command.accepted", { receipt: commandReceipt }),
      event(3, "effect.requested", { intent }),
      event(4, "effect.observed", {
        receipt: { ...receipt, receiptId: commandReceipt.receiptId }
      })
    ))).toThrow(/receipt.*already/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent }),
      event(3, "effect.observed", { receipt }),
      event(4, "command.accepted", {
        receipt: { ...commandReceipt, receiptId: receipt.receiptId }
      })
    ))).toThrow(/receipt.*already/i);
  });

  it("rejects cross-run facts, orphan receipts and mismatched physical inputs", () => {
    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "command.accepted", {
        receipt: { ...commandReceiptFixture(), runId: "run:other" }
      })
    ))).toThrow(/another run/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", {
        intent: { ...effectIntentFixture(), runId: "run:other" }
      })
    ))).toThrow(/another run/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.observed", { receipt: physicalReceiptFixture() })
    ))).toThrow(/no requested effect/i);

    expect(() => foldRun(parseEvents(
      event(1, "run.created", { goal: "Build safely" }),
      event(2, "effect.requested", { intent: effectIntentFixture() }),
      event(3, "effect.observed", {
        receipt: { ...physicalReceiptFixture(), inputDigest: "digest:other-input" }
      })
    ))).toThrow(/input digest/i);
  });
});

function commandReceiptFixture() {
  return {
    schemaVersion: 1,
    receiptId: "receipt:command:1",
    commandId: "command:1",
    runId: "run:1",
    commandDigest: "digest:command:1",
    acceptedRevision: 2,
    daemonEpoch: "daemon:epoch:1",
    acceptedAt: "2026-08-12T15:00:00.000Z"
  } as const;
}

function effectIntentFixture() {
  return {
    effectId: "effect:1",
    runId: "run:1",
    attemptId: "attempt:1",
    kind: "process_spawn",
    inputDigest: "digest:input:1",
    daemonEpoch: "daemon:epoch:1",
    idempotency: "reconcile_then_repeat",
    requestedAt: "2026-08-12T15:00:01.000Z"
  } as const;
}

function physicalReceiptFixture() {
  return {
    receiptId: "receipt:physical:1",
    effectId: "effect:1",
    observation: "started",
    inputDigest: "digest:input:1",
    daemonEpoch: "daemon:epoch:1",
    observedAt: "2026-08-12T15:00:02.000Z"
  } as const;
}

function event(sequence: number, type: string, payload: unknown) {
  return {
    eventId: `event:${sequence}`,
    runId: "run:1",
    sequence,
    occurredAt: "2026-08-12T15:00:00.000Z",
    type,
    payload
  };
}

function parseEvents(...events: ReturnType<typeof event>[]) {
  return events.map((item) => RunEventSchema.parse(item));
}
