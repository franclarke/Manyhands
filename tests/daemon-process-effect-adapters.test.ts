import { describe, expect, it, vi } from "vitest";
import type {
  EffectInputSpec,
  EffectIntent,
  PhysicalEffectReceipt,
  ProcessIdentity
} from "@manyhands/contracts";
import type {
  ProcessSpawnRequest,
  ProcessSupervisorFinalReceipt,
  ProcessSupervisorStartedReceipt,
  SupervisedProcess
} from "@manyhands/execution-core";
import type {
  PhysicalEffectAdapterContext,
  PhysicalEffectObservationInput
} from "@manyhands/run-engine";
import {
  createProcessSpawnPhysicalEffectAdapter,
  createProcessTerminatePhysicalEffectAdapter,
  type ProcessSupervisorPort
} from "../apps/daemon/src/process-effect-adapters.js";

describe("daemon process physical effect adapters", () => {
  it("records durable started and final process_spawn receipts with the supervised identity", async () => {
    const started = startedReceipt();
    const final = finalReceipt(started, "succeeded");
    const handle: SupervisedProcess = {
      started,
      custodianPid: started.custodianIdentity.pid,
      completion: Promise.resolve(final),
      terminate: vi.fn()
    };
    const supervisor = fakeSupervisor({
      spawn: vi.fn<ProcessSupervisorPort["spawn"]>().mockResolvedValue(handle)
    });
    const adapter = createProcessSpawnPhysicalEffectAdapter({ supervisor });
    const observed = recordingContext("process_spawn", spawnPayload());
    const effect = intent("process_spawn");

    await adapter.execute(effect, observed.context);

    expect(supervisor.spawn).toHaveBeenCalledWith({
      effectId: effect.effectId,
      inputDigest: effect.inputDigest,
      daemonEpoch: effect.daemonEpoch,
      ...(effect.attemptId === undefined ? {} : { attemptId: effect.attemptId }),
      executable: "C:/runtime/node.exe",
      argv: ["worker.mjs", "--once"],
      cwd: "C:/work/attempt-1",
      env: { CI: "1", NODE_ENV: "test" },
      timeoutMs: 30_000
    } satisfies ProcessSpawnRequest);
    expect(observed.records).toEqual([
      {
        observation: "started",
        observedAt: "2026-08-12T22:00:00.000Z",
        processIdentity: PROCESS_IDENTITY
      },
      {
        observation: "succeeded",
        observedAt: "2026-08-12T22:00:02.000Z",
        processIdentity: PROCESS_IDENTITY,
        resultDigest: `sha256:${"b".repeat(64)}`
      }
    ]);
  });

  it("reconciles a durable start by terminating the old tree without spawning a duplicate", async () => {
    const started = startedReceipt();
    const interrupted = finalReceipt(started, "terminated", {
      reason: "reconcile_interrupted_process_spawn"
    });
    const supervisor = fakeSupervisor({
      readReceipts: vi.fn<ProcessSupervisorPort["readReceipts"]>().mockResolvedValue([started]),
      terminate: vi.fn<ProcessSupervisorPort["terminate"]>().mockResolvedValue(interrupted)
    });
    const adapter = createProcessSpawnPhysicalEffectAdapter({ supervisor });
    const observed = recordingContext("process_spawn", spawnPayload(), [physicalStartedReceipt()]);

    await adapter.reconcile(intent("process_spawn"), observed.context);

    expect(supervisor.spawn).not.toHaveBeenCalled();
    expect(supervisor.terminate).toHaveBeenCalledOnce();
    expect(supervisor.terminate).toHaveBeenCalledWith(
      "sha256:effect-process_spawn",
      "reconcile_interrupted_process_spawn"
    );
    expect(observed.records).toEqual([{
      observation: "failed",
      observedAt: "2026-08-12T22:00:02.000Z",
      processIdentity: PROCESS_IDENTITY,
      resultDigest: `sha256:${"b".repeat(64)}`
    }]);
  });

  it("never repeats process_spawn when recovery has no supervisor evidence", async () => {
    const supervisor = fakeSupervisor();
    const adapter = createProcessSpawnPhysicalEffectAdapter({ supervisor });
    const observed = recordingContext("process_spawn", spawnPayload());

    await adapter.reconcile(intent("process_spawn"), observed.context);

    expect(supervisor.readReceipts).toHaveBeenCalledWith("sha256:effect-process_spawn");
    expect(supervisor.spawn).not.toHaveBeenCalled();
    expect(supervisor.terminate).not.toHaveBeenCalled();
    expect(observed.records).toEqual([]);
  });

  it("adopts a durable final process_spawn receipt during recovery", async () => {
    const started = startedReceipt();
    const final = finalReceipt(started, "succeeded");
    const supervisor = fakeSupervisor({
      readReceipts: vi.fn<ProcessSupervisorPort["readReceipts"]>()
        .mockResolvedValue([started, final])
    });
    const adapter = createProcessSpawnPhysicalEffectAdapter({ supervisor });
    const observed = recordingContext("process_spawn", spawnPayload(), [physicalStartedReceipt()]);

    await adapter.reconcile(intent("process_spawn"), observed.context);

    expect(supervisor.spawn).not.toHaveBeenCalled();
    expect(supervisor.terminate).not.toHaveBeenCalled();
    expect(observed.records).toEqual([expect.objectContaining({
      observation: "succeeded",
      processIdentity: PROCESS_IDENTITY
    })]);
  });

  it("rejects unknown fields and secret-bearing environment variables before spawning", async () => {
    const supervisor = fakeSupervisor();
    const adapter = createProcessSpawnPhysicalEffectAdapter({ supervisor });
    const withUnknownField = recordingContext("process_spawn", {
      ...spawnPayload(),
      shell: true
    });
    const withSecret = recordingContext("process_spawn", {
      ...spawnPayload(),
      env: { API_TOKEN: "must-not-be-persisted" }
    });

    await expect(adapter.execute(intent("process_spawn"), withUnknownField.context))
      .rejects.toThrow(/exactly/i);
    await expect(adapter.execute(intent("process_spawn"), withSecret.context))
      .rejects.toThrow(/must not persist secret-bearing/i);
    expect(supervisor.spawn).not.toHaveBeenCalled();
  });

  it("records process_terminate success only after the matching tree has a verified final receipt", async () => {
    const started = startedReceipt();
    const terminated = finalReceipt(started, "terminated", { reason: "operator_cancelled" });
    const supervisor = fakeSupervisor({
      readReceipts: vi.fn<ProcessSupervisorPort["readReceipts"]>().mockResolvedValue([started]),
      terminate: vi.fn<ProcessSupervisorPort["terminate"]>().mockResolvedValue(terminated)
    });
    const adapter = createProcessTerminatePhysicalEffectAdapter({ supervisor });
    const observed = recordingContext("process_terminate", terminatePayload());

    await adapter.execute(intent("process_terminate"), observed.context);

    expect(supervisor.terminate).toHaveBeenCalledWith(
      "sha256:effect-process_spawn",
      "operator_cancelled"
    );
    expect(observed.records).toEqual([{
      observation: "succeeded",
      observedAt: "2026-08-12T22:00:02.000Z",
      processIdentity: PROCESS_IDENTITY,
      resultDigest: `sha256:${"b".repeat(64)}`
    }]);
  });

  it.each([
    ["PID", { ...PROCESS_IDENTITY, pid: PROCESS_IDENTITY.pid + 1 }],
    ["creation identity", { ...PROCESS_IDENTITY, creationIdentity: "windows:reused-pid" }]
  ] satisfies Array<[string, ProcessIdentity]>) (
    "refuses a process_terminate %s mismatch without killing anything",
    async (_label, mismatchedIdentity) => {
      const started = startedReceipt();
      const supervisor = fakeSupervisor({
        readReceipts: vi.fn<ProcessSupervisorPort["readReceipts"]>().mockResolvedValue([started])
      });
      const adapter = createProcessTerminatePhysicalEffectAdapter({ supervisor });
      const observed = recordingContext("process_terminate", {
        ...terminatePayload(),
        expectedProcessIdentity: mismatchedIdentity
      });

      await expect(adapter.execute(intent("process_terminate"), observed.context))
        .rejects.toThrow(/identity does not match/i);

      expect(supervisor.terminate).not.toHaveBeenCalled();
      expect(observed.records).toEqual([]);
    }
  );

  it("replays process_terminate by adopting verified final death without killing twice", async () => {
    const started = startedReceipt();
    const final = finalReceipt(started, "terminated", { reason: "operator_cancelled" });
    const supervisor = fakeSupervisor({
      readReceipts: vi.fn<ProcessSupervisorPort["readReceipts"]>()
        .mockResolvedValue([started, final])
    });
    const adapter = createProcessTerminatePhysicalEffectAdapter({ supervisor });
    const observed = recordingContext("process_terminate", terminatePayload());

    await adapter.reconcile(intent("process_terminate"), observed.context);

    expect(supervisor.terminate).not.toHaveBeenCalled();
    expect(observed.records).toEqual([expect.objectContaining({
      observation: "succeeded",
      processIdentity: PROCESS_IDENTITY
    })]);
  });

  it("fails closed when process_terminate has no durable target evidence", async () => {
    const supervisor = fakeSupervisor();
    const adapter = createProcessTerminatePhysicalEffectAdapter({ supervisor });
    const observed = recordingContext("process_terminate", terminatePayload());

    await expect(adapter.reconcile(intent("process_terminate"), observed.context))
      .rejects.toThrow(/no durable identity evidence/i);

    expect(supervisor.terminate).not.toHaveBeenCalled();
    expect(observed.records).toEqual([]);
  });
});

const PROCESS_IDENTITY: ProcessIdentity = {
  pid: 5104,
  creationIdentity: "windows:134156472000000000",
  supervisorNonce: "nonce:process-one"
};

const CUSTODIAN_IDENTITY: ProcessIdentity = {
  pid: 4104,
  creationIdentity: "windows:134156471999000000",
  supervisorNonce: "nonce:process-one"
};

function intent(kind: EffectIntent["kind"]): EffectIntent {
  return {
    effectId: `sha256:effect-${kind}`,
    runId: "run:process-adapters",
    attemptId: "attempt:one",
    kind,
    inputDigest: `sha256:input-${kind}`,
    daemonEpoch: "daemon:epoch-one",
    idempotency: "never_repeat_unknown",
    requestedAt: "2026-08-12T21:59:00.000Z"
  };
}

function spawnPayload(): EffectInputSpec["payload"] {
  return {
    executable: "C:/runtime/node.exe",
    argv: ["worker.mjs", "--once"],
    cwd: "C:/work/attempt-1",
    env: { NODE_ENV: "test", CI: "1" },
    timeoutMs: 30_000
  };
}

function terminatePayload(): EffectInputSpec["payload"] {
  return {
    targetEffectId: "sha256:effect-process_spawn",
    expectedProcessIdentity: PROCESS_IDENTITY,
    reason: "operator_cancelled"
  };
}

function startedReceipt(
  overrides: Partial<ProcessSupervisorStartedReceipt> = {}
): ProcessSupervisorStartedReceipt {
  return {
    schemaVersion: 1,
    effectId: "sha256:effect-process_spawn",
    inputDigest: "sha256:input-process_spawn",
    daemonEpoch: "daemon:epoch-one",
    attemptId: "attempt:one",
    processIdentity: PROCESS_IDENTITY,
    custodianIdentity: CUSTODIAN_IDENTITY,
    platformOwnership: "Local\\ManyHands-process-one",
    phase: "started",
    startedAtEpochMs: Date.parse("2026-08-12T22:00:00.000Z"),
    stdoutPath: "C:/state/process-one/stdout.log",
    stderrPath: "C:/state/process-one/stderr.log",
    receiptChecksum: `sha256:${"a".repeat(64)}`,
    ...overrides
  };
}

function finalReceipt(
  started: ProcessSupervisorStartedReceipt,
  outcome: ProcessSupervisorFinalReceipt["outcome"],
  overrides: Partial<ProcessSupervisorFinalReceipt> = {}
): ProcessSupervisorFinalReceipt {
  return {
    schemaVersion: 1,
    effectId: started.effectId,
    inputDigest: started.inputDigest,
    daemonEpoch: started.daemonEpoch,
    ...(started.attemptId === undefined ? {} : { attemptId: started.attemptId }),
    processIdentity: started.processIdentity,
    custodianIdentity: started.custodianIdentity,
    platformOwnership: started.platformOwnership,
    phase: "final",
    outcome,
    exitCode: outcome === "succeeded" ? 0 : null,
    completedAtEpochMs: Date.parse("2026-08-12T22:00:02.000Z"),
    stdoutPath: started.stdoutPath,
    stderrPath: started.stderrPath,
    startedReceiptChecksum: started.receiptChecksum,
    receiptChecksum: `sha256:${"b".repeat(64)}`,
    ...overrides
  };
}

function physicalStartedReceipt(): PhysicalEffectReceipt {
  return {
    receiptId: "sha256:physical-started",
    effectId: "sha256:effect-process_spawn",
    observation: "started",
    inputDigest: "sha256:input-process_spawn",
    daemonEpoch: "daemon:epoch-one",
    processIdentity: PROCESS_IDENTITY,
    observedAt: "2026-08-12T22:00:00.000Z"
  };
}

function fakeSupervisor(
  overrides: Partial<ProcessSupervisorPort> = {}
): ProcessSupervisorPort {
  return {
    spawn: vi.fn<ProcessSupervisorPort["spawn"]>(),
    terminate: vi.fn<ProcessSupervisorPort["terminate"]>(),
    readReceipts: vi.fn<ProcessSupervisorPort["readReceipts"]>().mockResolvedValue([]),
    ...overrides
  };
}

function recordingContext(
  kind: EffectIntent["kind"],
  payload: EffectInputSpec["payload"],
  priorReceipts: readonly PhysicalEffectReceipt[] = []
): {
  context: PhysicalEffectAdapterContext;
  records: PhysicalEffectObservationInput[];
} {
  const records: PhysicalEffectObservationInput[] = [];
  return {
    records,
    context: {
      observerDaemonEpoch: "daemon:epoch-one",
      inputSpec: { schemaVersion: 1, kind, payload },
      priorReceipts,
      async record(observation) {
        records.push(structuredClone(observation));
        return {} as PhysicalEffectReceipt;
      }
    }
  };
}
