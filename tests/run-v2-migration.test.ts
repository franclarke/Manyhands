import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldRun } from "@manyhands/run-coordinator";
import { JsonlRunEventStore } from "@manyhands/run-store";
import { RunFileSchema } from "@/lib/server/runs/schema";
import { migrateLegacyRunFile } from "@/lib/server/runs/v2/migrate-run";

const importedAt = "2026-07-18T12:00:00.000Z";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-migrate-v2-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("V1 to V2 migration", () => {
  it("blocks a legacy record that cannot prove the physical repository identity", async () => {
    const filePath = await writeLegacy("missing-identity", legacyRecord());

    const report = await migrateLegacyRunFile({ filePath });

    expect(report.disposition).toBe("blocked_target_identity");
    expect(await new JsonlRunEventStore({ directory }).load("missing-identity")).toEqual([]);
  });

  it("blocks an active legacy operation even when its target identity is complete", async () => {
    const legacy = withPhysicalIdentity(legacyRecord());
    legacy.status = "running";
    legacy.activeOperation = {
      operationId: "77777777-7777-4777-8777-777777777777",
      kind: "execution",
      fencingToken: 3,
      acquiredAt: importedAt,
      heartbeatAt: importedAt
    };
    const filePath = await writeLegacy("active-run", legacy);

    const report = await migrateLegacyRunFile({ filePath });

    expect(report.disposition).toBe("blocked_active");
  });

  it("backs up and imports a safe V1 run without inventing evidence, candidates or delivery", async () => {
    const legacy = withPhysicalIdentity(legacyRecord());
    legacy.status = "interrupted";
    legacy.executionOutcome = "succeeded";
    legacy.finalCommitSha = "3".repeat(40);
    legacy.finalArtifactManifest = { verificationDisposition: "verified", validationResults: [{ passed: true }] };
    const filePath = await writeLegacy("safe-run", legacy);
    const backupDirectory = path.join(directory, "backups");

    const dryRun = await migrateLegacyRunFile({ filePath });
    expect(dryRun.disposition).toBe("dry_run");
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ status: "interrupted" });

    const report = await migrateLegacyRunFile({
      filePath,
      apply: true,
      approvedBy: "migration-operator",
      backupDirectory,
      importedAt
    });

    expect(report.disposition).toBe("migrated");
    const envelope = RunFileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    expect(envelope.run.projection).toMatchObject({ lifecycle: "interrupted", eventSequence: 2 });
    expect(envelope.run).not.toHaveProperty("finalArtifactManifest");
    expect(envelope.run).not.toHaveProperty("executionOutcome");
    expect(await readFile(report.backupPath!, "utf8")).toContain('"status": "interrupted"');

    const events = await new JsonlRunEventStore({ directory }).load("safe-run");
    const state = foldRun(events);
    expect(events.map((event) => event.type)).toEqual(["run.created", "legacy.run_imported"]);
    expect(state.lifecycle).toBe("interrupted");
    expect(state.evidenceMatrices).toEqual([]);
    expect(state.finalCandidate).toBeUndefined();
    expect(state.deliveryReceipt).toBeUndefined();

    const second = await migrateLegacyRunFile({
      filePath,
      apply: true,
      approvedBy: "migration-operator",
      backupDirectory,
      importedAt
    });
    expect(second.disposition).toBe("already_v2");
  });
});

async function writeLegacy(runId: string, record: Record<string, unknown>): Promise<string> {
  const filePath = path.join(directory, `${runId}.json`);
  record.runId = runId;
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return filePath;
}

function legacyRecord(): Record<string, unknown> {
  return {
    runId: "legacy-run",
    workspaceId: "workspace-legacy",
    userPrompt: "Add appointment booking",
    title: "Appointment booking",
    model: "claude-sonnet-4-5",
    version: 4,
    mutationFence: 2,
    status: "failed",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T01:00:00.000Z",
    targetContext: {
      sourceRealPath: "C:/work/example-app",
      gitCommonDir: "C:/work/example-app/.git",
      sourceBranch: "main",
      sourceBaseCommit: "1".repeat(40),
      fingerprint: "sha256:target-v1",
      capturedAt: "2026-07-17T00:00:00.000Z"
    }
  };
}

function withPhysicalIdentity(record: Record<string, unknown>): Record<string, unknown> {
  const target = record.targetContext as Record<string, unknown>;
  target.physicalIdentity = { version: 1, device: "11", file: "22" };
  return record;
}
