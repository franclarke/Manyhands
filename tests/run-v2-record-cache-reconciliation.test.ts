import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DigestHasher, EffectKind } from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  type ProductRunDefinition,
  type RunCommandPayload,
  type RunEventInput
} from "@manyhands/run-coordinator";
import type { PhysicalEffectAdapter } from "@manyhands/run-engine";
import { startProductiveDaemon, type DaemonKernel } from "../apps/daemon/src/index.js";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { createLocalIpcClient } from "@/lib/server/daemon/local-ipc-client";

const at = "2026-08-13T03:00:00.000Z";
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
let directory: string;
let kernel: DaemonKernel;
let previousDaemonRoot: string | undefined;
let previousEndpoint: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage3-pure-get-"));
  previousDaemonRoot = process.env.MANYHANDS_DAEMON_STATE_ROOT;
  previousEndpoint = process.env.MANYHANDS_DAEMON_ENDPOINT;
  process.env.MANYHANDS_DAEMON_STATE_ROOT = path.join(directory, "daemon");
  process.env.MANYHANDS_DAEMON_ENDPOINT = endpoint();
  kernel = await startProductiveDaemon({
    stateRoot: process.env.MANYHANDS_DAEMON_STATE_ROOT,
    endpoint: process.env.MANYHANDS_DAEMON_ENDPOINT,
    processStartIdentity: "process:pure-get:1",
    processIdentityProbe: { probe: async () => "dead" as const },
    createDaemonEpoch: () => "daemon:pure-get",
    clock: () => at,
    production: false,
    profile: {
      kind: "transitional_unsafe",
      adapters: adapters(),
      loadPlanningResult: async (effectId) => deterministicPlanningResult(effectId),
      executionProcess: () => ({ executable: process.execPath, argv: ["-e", ""], cwd: process.cwd(), env: {} })
    }
  });
});

afterEach(async () => {
  await kernel.close();
  restore("MANYHANDS_DAEMON_STATE_ROOT", previousDaemonRoot);
  restore("MANYHANDS_DAEMON_ENDPOINT", previousEndpoint);
  await rm(directory, { recursive: true, force: true });
});

describe("Stage 3 GET purity", () => {
  it("observes the terminal daemon projection without appending or repairing lifecycle state", async () => {
    const runId = "run:terminal:daemon";
    const client = createLocalIpcClient({
      endpoint: kernel.endpoint,
      capabilityFilePath: kernel.capabilityFilePath,
      production: false
    });
    await client.submit(buildRunCommandEnvelope({
      commandId: "command:create:pure-get",
      runId,
      expectedRevision: 0,
      submittedAt: at,
      command: { type: "create_run", definition: definition() } as unknown as RunCommandPayload
    }, sha256));
    await kernel.drainEffects();
    const current = await kernel.engine.query(runId);
    await client.submit(buildRunCommandEnvelope({
      commandId: "command:cancel:pure-get",
      runId,
      expectedRevision: current.sequence,
      submittedAt: at,
      command: { type: "cancel_run", reason: "test terminal projection" }
    }, sha256));
    await kernel.drainEffects();

    const before = await kernel.engine.query(runId);
    const beforeEvents = await kernel.engine.eventsReady(runId, 0);

    const response = await getRun(new Request(`http://localhost/api/runs/${runId}`), {
      params: Promise.resolve({ id: runId })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: { runId, lifecycle: "interrupted" }
    });
    const after = await kernel.engine.query(runId);
    const afterEvents = await kernel.engine.eventsReady(runId, 0);
    expect(after.sequence).toBe(before.sequence);
    expect(afterEvents).toEqual(beforeEvents);
  });
});

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:pure-get",
    userPrompt: "Prove GET is pure",
    acceptanceCriteria: [],
    title: "Pure GET",
    planningSelection: { executorId: "codex-cli", model: "fake" },
    executionSelection: { executorId: "codex-cli", model: "fake" },
    repairSelection: { executorId: "codex-cli", model: "fake" },
    executionConfig: {},
    targetContext: { fingerprint: "target:pure", sourceBaseCommit: "abc", sourceRealPath: process.cwd() }
  };
}

function adapters(): PhysicalEffectAdapter[] {
  const kinds: EffectKind[] = [
    "model_call", "process_spawn", "process_terminate", "sandbox_create", "git_mutation",
    "artifact_materialize", "validation", "delivery", "cleanup"
  ];
  return kinds.map((kind) => ({
    kind,
    execute: async (intent, context) => {
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    },
    reconcile: async (intent, context) => {
      if (context.priorReceipts.some((receipt) => receipt.observation !== "started")) return;
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    }
  }));
}

function deterministicPlanningResult(effectId: string): RunEventInput[] {
  const suffix = createHash("sha256").update(effectId).digest("hex").slice(0, 16);
  const graphId = `graph:pure-get:${suffix}`;
  const decisionId = `approve-plan:${graphId}:r1`;
  return [
    {
      eventId: `planning:${suffix}`,
      occurredAt: at,
      type: "planning.completed",
      payload: { semanticPlan: { id: `plan:pure-get:${suffix}`, revision: 1 }, trace: {} }
    },
    {
      eventId: `compiled:${suffix}`,
      occurredAt: at,
      type: "graph.compiled",
      payload: { graphId, revision: 1, graph: {}, contracts: [], review: {}, trace: {} }
    },
    {
      eventId: `proposed:${suffix}`,
      occurredAt: at,
      type: "graph.revision.proposed",
      payload: { graphId, revision: 1 }
    },
    {
      eventId: decisionId,
      occurredAt: at,
      type: "decision.raised",
      payload: {
        decision: {
          id: decisionId,
          kind: "approve_plan",
          question: "Approve deterministic planning result?",
          options: [{ id: "approve", label: "Approve" }, { id: "reject", label: "Reject" }],
          affectedNodeIds: ["node:pure-get"],
          evidenceRefs: [],
          impact: "architecture",
          raisedAtGraphRevision: 1
        }
      }
    }
  ];
}

function endpoint(): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\mh-stage3-pure-get-${randomUUID()}`
    : path.join(os.tmpdir(), `mh-stage3-pure-get-${randomUUID()}.sock`);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
