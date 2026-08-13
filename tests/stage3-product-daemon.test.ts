import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DigestHasher, EffectKind } from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  type ProductRunDefinition,
  type RunCommandPayload
} from "@manyhands/run-coordinator";
import type { PhysicalEffectAdapter } from "@manyhands/run-engine";
import { startProductiveDaemon } from "../apps/daemon/src/productive-daemon.js";
import { createLocalIpcClient } from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const roots: string[] = [];
const at = "2026-08-13T02:00:00.000Z";
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Stage 3 productive daemon boundary", () => {
  it("owns create, idempotent multi-client commands and pure query/event pages", async () => {
    const root = await temporaryRoot();
    const counts = new Map<EffectKind, number>();
    const kernel = await startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("product"),
      processStartIdentity: "process:test:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => "daemon:product:test",
      clock: () => at,
      production: false,
      profile: {
        kind: "transitional_unsafe",
        adapters: adapters(counts),
        executionProcess: () => ({ executable: process.execPath, argv: ["-e", ""], cwd: process.cwd(), env: {} })
      }
    });
    try {
      const first = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const second = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const runId = "run:stage3:product";
      const create = buildRunCommandEnvelope({
        commandId: "command:create:stage3",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: { type: "create_run", definition: definition() } as unknown as RunCommandPayload
      }, sha256);

      const [left, right] = await Promise.all([first.submit(create), second.submit(create)]);
      expect(left).toEqual(right);
      await kernel.drainEffects();
      expect(counts.get("model_call")).toBe(1);

      const projection = await first.query({ runId, query: "projection" });
      expect(projection).toMatchObject({
        runId,
        lifecycle: "needs_approval",
        definition: { userPrompt: "Build deterministic stage three" }
      });

      const domain = await kernel.engine.query(runId);
      const decisionId = Object.values(domain.decisions).find((decision) =>
        decision.kind === "approve_plan" && decision.status === "pending")?.id;
      expect(decisionId).toBeDefined();
      const approve = buildRunCommandEnvelope({
        commandId: "command:approve:stage3",
        runId,
        expectedRevision: domain.sequence,
        submittedAt: at,
        command: { type: "resolve_decision", decisionId: decisionId!, optionId: "approve" }
      }, sha256);
      const approvals = await Promise.all([first.submit(approve), second.submit(approve)]);
      expect(approvals[0]).toEqual(approvals[1]);
      await kernel.drainEffects();
      expect(counts.get("process_spawn")).toBe(1);

      const runFiles = (await readdir(path.join(root, "runs")))
        .filter((name) => name.endsWith(".events.v2.jsonl"));
      expect(runFiles).toHaveLength(1);
      const journalPath = path.join(root, "runs", runFiles[0]!);
      const before = await readFile(journalPath, "utf8");
      for (let index = 0; index < 5; index += 1) {
        await second.query({ runId, query: "projection" });
        const page = await second.eventsReady({ runId, afterSequence: 0 });
        expect(page).toMatchObject({ nextSequence: expect.any(Number) });
      }
      expect(await readFile(journalPath, "utf8")).toBe(before);

      const listed = await first.query({
        runId: "installation:runs",
        query: "list",
        arguments: { workspaceId: "workspace:stage3", limit: 10 }
      });
      expect(listed).toMatchObject([{ runId }]);
    } finally {
      await kernel.close();
    }
  });

  it("fails closed when a command id is reused with different content", async () => {
    const root = await temporaryRoot();
    const kernel = await startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("conflict"),
      processStartIdentity: "process:test:2",
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => "daemon:conflict:test",
      clock: () => at,
      production: false,
      profile: {
        kind: "transitional_unsafe",
        adapters: adapters(new Map()),
        executionProcess: () => ({ executable: process.execPath, argv: ["-e", ""], cwd: process.cwd(), env: {} })
      }
    });
    try {
      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const runId = "run:stage3:conflict";
      await client.submit(buildRunCommandEnvelope({
        commandId: "command:reused",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: { type: "create_run", definition: definition() } as unknown as RunCommandPayload
      }, sha256));
      await expect(client.submit(buildRunCommandEnvelope({
        commandId: "command:reused",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: {
          type: "create_run",
          definition: { ...definition(), title: "Different" }
        } as unknown as RunCommandPayload
      }, sha256))).rejects.toMatchObject({ code: "request_failed" });
    } finally {
      await kernel.close();
    }
  });
});

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage3",
    userPrompt: "Build deterministic stage three",
    acceptanceCriteria: ["survives restarts"],
    title: "Stage three",
    planningSelection: { executorId: "codex-cli", model: "fake" },
    executionSelection: { executorId: "codex-cli", model: "fake" },
    repairSelection: { executorId: "codex-cli", model: "fake" },
    executionConfig: {},
    targetContext: {
      fingerprint: "target:fingerprint",
      sourceBaseCommit: "0123456789abcdef",
      sourceRealPath: process.cwd()
    }
  };
}

function adapters(counts: Map<EffectKind, number>): PhysicalEffectAdapter[] {
  const kinds: EffectKind[] = [
    "model_call", "process_spawn", "process_terminate", "sandbox_create", "git_mutation",
    "artifact_materialize", "validation", "delivery", "cleanup"
  ];
  return kinds.map((kind) => ({
    kind,
    execute: async (intent, context) => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    },
    reconcile: async (intent, context) => {
      if (context.priorReceipts.some((receipt) => receipt.observation !== "started")) return;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    }
  }));
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-stage3-product-"));
  roots.push(root);
  return root;
}

function endpointFor(label: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\mh-stage3-${label}-${randomUUID()}`
    : path.join(os.tmpdir(), `mh-stage3-${label}-${randomUUID()}.sock`);
}
