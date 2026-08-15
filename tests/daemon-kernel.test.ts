import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, appendFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  EffectKindSchema,
  buildEffectIntent,
  type DigestHasher,
  type EffectInputSpec
} from "@manyhands/contracts";
import {
  CommandReceiptSchema,
  buildCommandReceipt,
  buildRunCommandEnvelope,
  type IpcCapabilityOsProtection,
  type RunCommandEnvelope
} from "@manyhands/run-coordinator";
import { FileEffectInputStore, JsonlRunEventStore } from "@manyhands/run-store";
import type { PhysicalEffectAdapter } from "@manyhands/run-engine";
import { startDaemonKernel } from "../apps/daemon/src/daemon-kernel.js";
import {
  createWindowsIpcAclProtector,
  createWindowsIpcAclVerifier,
  verifyWindowsRestrictedNamedPipe
} from "../apps/daemon/src/windows-ipc-acl.js";
import { createLocalIpcClient } from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
let windowsAclSuiteRoot: string | undefined;
let windowsAclHelperPath: string | undefined;

beforeAll(async () => {
  if (process.platform !== "win32") return;
  windowsAclSuiteRoot = await mkdtemp(path.join(os.tmpdir(), "mh-daemon-kernel-acl-"));
  windowsAclHelperPath = path.join(windowsAclSuiteRoot, "manyhands-windows-ipc-acl.exe");
  await execFileAsync("rustc.exe", [
    "--edition=2021",
    path.resolve("native/windows-ipc-acl/src/main.rs"),
    "-O",
    "-o",
    windowsAclHelperPath
  ], { windowsHide: true });
  await access(windowsAclHelperPath);
}, 60_000);

afterAll(async () => {
  if (windowsAclSuiteRoot !== undefined) {
    await rm(windowsAclSuiteRoot, { recursive: true, force: true });
  }
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("durable daemon composition root", () => {
  it("reconciles journals with pending effects on startup", async () => {
    const root = await temporaryRoot();
    const runId = "run:startup-recovery";
    const intent = await seedPendingEffect(root, runId);
    const reconciled: Array<{ effectId: string; inputSpec: EffectInputSpec }> = [];

    const kernel = await startKernel(root, "daemon:recovery", {
      adapters: recoveryAdapters((effectId, inputSpec) => {
        reconciled.push({ effectId, inputSpec: structuredClone(inputSpec) });
      })
    });
    try {
      // The endpoint binds before recovery finishes, so the guarantee is
      // awaited explicitly rather than inferred from startup returning.
      await kernel.startupRecovery;
      expect(reconciled).toEqual([{
        effectId: intent.effectId,
        inputSpec: {
          schemaVersion: 1,
          kind: "cleanup",
          payload: { operation: "recover-on-daemon-startup" }
        }
      }]);

      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const projection = await client.query({ runId, query: "projection" });
      expect(projection).toMatchObject({
        runId,
        sequence: 5,
        effectTerminals: {
          [intent.effectId]: { status: "completed" }
        }
      });
      expect((await kernel.eventStore.load(runId)).map((event) => event.type)).toEqual([
        "run.created",
        "command.accepted",
        "effect.requested",
        "effect.observed",
        "effect.completed"
      ]);
    } finally {
      await kernel.close();
    }

    const replayedReconciliations: string[] = [];
    const restarted = await startKernel(root, "daemon:recovery-restart", {
      adapters: recoveryAdapters((effectId) => replayedReconciliations.push(effectId))
    });
    try {
      expect(replayedReconciliations).toEqual([]);
      expect((await restarted.eventStore.load(runId))).toHaveLength(5);
    } finally {
      await restarted.close();
    }
  });

  it("fails startup when journal discovery exceeds its explicit bound", async () => {
    const root = await temporaryRoot();
    await seedRun(root, "run:bounded-a");
    await seedRun(root, "run:bounded-b");

    await expect(startKernel(root, "daemon:bounded", {
      startupRecoveryRunLimit: 1
    })).rejects.toThrow(/more than the configured limit of 1 runs/i);
  });

  it("serves IPC while startup recovery is still running", async () => {
    // Startup awaited every pending effect of every run before binding the
    // endpoint, so a daemon recovering one slow effect was indistinguishable
    // from a dead one: the UI only saw connect ENOENT for as long as it took.
    const root = await temporaryRoot();
    await seedPendingEffect(root, "run:slow-recovery");
    let released: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { released = resolve; });
    const adapters = noEffectAdapters().map((adapter) => adapter.kind === "cleanup"
      ? { kind: adapter.kind, execute: async () => blocked, reconcile: async () => blocked }
      : adapter);

    const kernel = await Promise.race([
      startKernel(root, "daemon:slow-recovery", { adapters }),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error("startup blocked on recovery")),
        5_000
      ))
    ]);
    try {
      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      // Reachable and answering while the effect is still in flight.
      await expect(client.query({ runId: "run:slow-recovery", query: "projection" }))
        .resolves.toMatchObject({ runId: "run:slow-recovery" });
    } finally {
      released();
      await kernel.startupRecovery;
      await kernel.close().catch(() => undefined);
    }
  });

  it("fails startup closed when a discovered journal is corrupt", async () => {
    const root = await temporaryRoot();
    const runId = "run:corrupt-startup";
    const store = await seedRun(root, runId);
    await appendFile(store.eventLogPath(runId), "not-json\n", "utf8");

    await expect(startKernel(root, "daemon:corrupt"))
      .rejects.toThrow(/run event log.*corrupt/i);
  });

  it("survives client and daemon restarts without inventing lifecycle events", async () => {
    const root = await temporaryRoot();
    await seedRun(root, "run:kernel");
    const first = await startKernel(root, "daemon:epoch-1");
    const firstClient = createLocalIpcClient({
      endpoint: first.endpoint,
      capabilityFilePath: first.capabilityFilePath,
      production: false
    });
    const command = commandEnvelope();

    const accepted = CommandReceiptSchema.parse(await firstClient.submit(command));
    expect(accepted.commandId).toBe(command.commandId);
    expect((await firstClient.query({ runId: "run:kernel", query: "projection" })))
      .toMatchObject({ runId: "run:kernel", sequence: 2 });

    const replacementClient = createLocalIpcClient({
      endpoint: first.endpoint,
      capabilityFilePath: first.capabilityFilePath,
      production: false
    });
    expect((await replacementClient.eventsReady({ runId: "run:kernel", afterSequence: 1 })))
      .toMatchObject({ nextSequence: 2, events: [{ type: "command.accepted" }] });
    expect((await first.eventStore.load("run:kernel"))).toHaveLength(2);
    await first.close();

    const second = await startKernel(root, "daemon:epoch-2");
    try {
      const secondClient = createLocalIpcClient({
        endpoint: second.endpoint,
        capabilityFilePath: second.capabilityFilePath,
        production: false
      });
      const replay = CommandReceiptSchema.parse(await secondClient.submit(command));
      expect(replay).toEqual(accepted);
      expect((await secondClient.query({ runId: "run:kernel", query: "projection" })))
        .toMatchObject({ sequence: 2 });
      expect((await second.eventStore.load("run:kernel"))).toHaveLength(2);
    } finally {
      await second.close();
    }
  });

  it("refuses a second daemon while the installation lease is live", async () => {
    const root = await temporaryRoot();
    const first = await startKernel(root, "daemon:owner-1");
    try {
      await expect(startKernel(root, "daemon:owner-2")).rejects.toThrow(/unavailable \(same\)/i);
    } finally {
      await first.close();
    }
  });

  it("does not expose unsupported query operations over IPC", async () => {
    const root = await temporaryRoot();
    await seedRun(root, "run:kernel");
    const kernel = await startKernel(root, "daemon:query");
    try {
      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      await expect(client.query({ runId: "run:kernel", query: "mutate_cache" }))
        .rejects.toMatchObject({ code: "request_failed" });
      expect((await kernel.eventStore.load("run:kernel"))).toHaveLength(1);
    } finally {
      await kernel.close();
    }
  });

  it("composes Windows production IPC with physical capability and named-pipe ACLs", async () => {
    if (process.platform !== "win32") return;
    const root = await temporaryRoot();
    const runId = "run:kernel-acl";
    await seedRun(root, runId);
    const protectedPaths: string[] = [];
    const verifiedPaths: string[] = [];
    const helperPath = windowsAclHelperPath!;
    const physicalProtect = createWindowsIpcAclProtector(helperPath);
    const physicalVerify = createWindowsIpcAclVerifier(helperPath);
    const protect: IpcCapabilityOsProtection = async (targetPath, kind) => {
      protectedPaths.push(`${kind}:${targetPath}`);
      await physicalProtect(targetPath, kind);
    };
    const verify: IpcCapabilityOsProtection = async (targetPath, kind) => {
      verifiedPaths.push(`${kind}:${targetPath}`);
      await physicalVerify(targetPath, kind);
    };

    const kernel = await startKernel(root, "daemon:acl", {
      production: true,
      protectCapabilityPath: protect,
      assertOsRestrictedCapabilityPath: verify,
      windowsPipeAclHelperPath: helperPath
    });
    try {
      expect(kernel.transportSecurity).toBe("os_restricted");
      await expect(verifyWindowsRestrictedNamedPipe(helperPath, kernel.endpoint))
        .resolves.toBeUndefined();
      expect(protectedPaths.map((entry) => entry.split(":", 1)[0])).toEqual([
        "directory",
        "file",
        "directory",
        "file"
      ]);
      expect(verifiedPaths.map((entry) => entry.split(":", 1)[0])).toEqual([
        "directory",
        "file"
      ]);
      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: true,
        assertOsRestrictedCapabilityPath: verify
      });
      await expect(client.query({ runId, query: "projection" }))
        .resolves.toMatchObject({ runId, sequence: 1 });
    } finally {
      await kernel.close();
    }
  });
});

interface StartKernelOverrides {
  production?: boolean;
  adapters?: readonly PhysicalEffectAdapter[];
  startupRecoveryRunLimit?: number;
  protectCapabilityPath?: IpcCapabilityOsProtection;
  assertOsRestrictedCapabilityPath?: IpcCapabilityOsProtection;
  windowsPipeAclHelperPath?: string;
}

async function startKernel(
  root: string,
  daemonEpoch: string,
  overrides: StartKernelOverrides = {}
) {
  return startDaemonKernel({
    stateRoot: root,
    endpoint: `\\\\.\\pipe\\manyhands-kernel-${randomUUID()}`,
    processStartIdentity: "test-process:start-1",
    processIdentityProbe: {
      async probe(owner) {
        return owner.pid === process.pid && owner.processStartIdentity === "test-process:start-1"
          ? "same"
          : "dead";
      }
    },
    createDaemonEpoch: () => daemonEpoch,
    createLeaseNonce: () => `nonce:${daemonEpoch}`,
    production: false,
    adapters: noEffectAdapters(),
    decide: () => [],
    hasher: sha256,
    clock: () => "2026-08-12T22:30:00.000Z",
    ...overrides
  });
}

function noEffectAdapters(): PhysicalEffectAdapter[] {
  return EffectKindSchema.options.map((kind) => ({
    kind,
    async execute() {
      throw new Error(`Unexpected ${kind} execution in daemon composition test.`);
    },
    async reconcile() {
      throw new Error(`Unexpected ${kind} reconciliation in daemon composition test.`);
    }
  }));
}

async function seedRun(root: string, runId: string): Promise<JsonlRunEventStore> {
  const store = new JsonlRunEventStore({ directory: path.join(root, "runs") });
  const authority = await store.claimAuthority(runId, "seed");
  await store.appendFenced(runId, 0, authority, [{
    eventId: "event:created",
    occurredAt: "2026-08-12T22:00:00.000Z",
    type: "run.created",
    payload: { goal: "Survive the daemon restart" }
  }]);
  return store;
}

async function seedPendingEffect(root: string, runId: string) {
  const inputSpec: EffectInputSpec = {
    schemaVersion: 1,
    kind: "cleanup",
    payload: { operation: "recover-on-daemon-startup" }
  };
  const inputStore = new FileEffectInputStore({
    directory: path.join(root, "effects", "inputs"),
    hasher: sha256
  });
  const effectInput = await inputStore.put(inputSpec);
  const command = buildRunCommandEnvelope({
    commandId: "command:startup-recovery",
    runId,
    expectedRevision: 1,
    submittedAt: "2026-08-12T22:10:00.000Z",
    command: { type: "start" }
  }, sha256);
  const receipt = buildCommandReceipt({
    schemaVersion: 1,
    commandId: command.commandId,
    runId,
    commandDigest: command.commandDigest,
    acceptedRevision: 2,
    daemonEpoch: "daemon:crashed",
    acceptedAt: "2026-08-12T22:10:01.000Z"
  }, sha256);
  const intent = buildEffectIntent({
    runId,
    attemptId: "attempt:startup-recovery",
    kind: inputSpec.kind,
    inputDigest: effectInput.inputDigest,
    daemonEpoch: "daemon:crashed",
    idempotency: "reconcile_then_repeat",
    requestedAt: "2026-08-12T22:10:02.000Z"
  }, sha256);
  const store = new JsonlRunEventStore({ directory: path.join(root, "runs") });
  const authority = await store.claimAuthority(runId, "daemon:crashed");
  await store.appendFenced(runId, 0, authority, [
    {
      eventId: "event:startup-recovery:created",
      occurredAt: "2026-08-12T22:00:00.000Z",
      type: "run.created",
      payload: { goal: "Recover without command redelivery" }
    },
    {
      eventId: "event:startup-recovery:command",
      occurredAt: receipt.acceptedAt,
      type: "command.accepted",
      payload: { receipt }
    },
    {
      eventId: "event:startup-recovery:effect",
      occurredAt: intent.requestedAt,
      type: "effect.requested",
      payload: { intent }
    }
  ]);
  return intent;
}

function recoveryAdapters(
  onReconcile: (effectId: string, inputSpec: EffectInputSpec) => void
): PhysicalEffectAdapter[] {
  return EffectKindSchema.options.map((kind): PhysicalEffectAdapter => ({
    kind,
    async execute() {
      throw new Error(`Startup recovery must not execute a new ${kind} effect.`);
    },
    async reconcile(intent, context) {
      if (kind !== "cleanup") {
        throw new Error(`Unexpected ${kind} reconciliation during startup.`);
      }
      onReconcile(intent.effectId, context.inputSpec);
      await context.record({
        observation: "succeeded",
        resultDigest: sha256("startup-recovered"),
        observedAt: "2026-08-12T22:30:01.000Z"
      });
    }
  }));
}

function commandEnvelope(): RunCommandEnvelope {
  return buildRunCommandEnvelope({
    commandId: "command:continue",
    runId: "run:kernel",
    expectedRevision: 1,
    submittedAt: "2026-08-12T22:30:00.000Z",
    command: { type: "continue" }
  }, sha256);
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-daemon-kernel-"));
  temporaryRoots.push(root);
  return root;
}
