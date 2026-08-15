import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CanonicalNodeExecutor } from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Stage 7 legacy transport reachability", () => {
  it("fails a commit artifact before the canonical daemon executor can invoke an integration transport", async () => {
    const git = new FakeGitRunner();
    const executor = new CanonicalNodeExecutor({
      git,
      repoRoot: "/repo",
      traceStore: { append: async () => ({}) } as never,
      executorFactory: { create: () => { throw new Error("The commit guard must run before an executor is created."); } },
      validator: { validate: async () => { throw new Error("The commit guard must run before validation."); } }
    });

    const outcome = await executor.execute({
      runId: "run-stage7",
      attemptId: "attempt-stage7",
      inputFingerprint: "sha256:input",
      graph: {} as never,
      node: { id: "node-parent" } as never,
      contract: { task: { revision: "1" }, artifacts: [] } as never,
      consumedArtifacts: [{
        artifactId: "artifact:legacy-commit",
        runId: "run-stage7",
        nodeId: "node-child",
        digest: "sha256:legacy",
        producerAttemptId: "attempt-child",
        contract: { id: "artifact:legacy", revision: "1" },
        kind: "commit",
        location: "a".repeat(40),
        adoptedAt: "2026-08-14T12:00:00.000Z"
      }],
      selection: {} as never,
      repairSelection: {} as never,
      config: {} as never,
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "b".repeat(40) }
    });

    expect(outcome).toEqual({
      kind: "failure",
      reason: "Commit artifacts are not accepted by the canonical execution route."
    });
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("keeps the daemon execution entrypoint on canonical manifests rather than the legacy commit driver", async () => {
    const [worker, driver, canonicalExecutor, materializer, integrationManifest] = await Promise.all([
      source("apps/daemon/src/transitional-unsafe-worker.ts"),
      source("packages/orchestrator-graph/src/canonical-execution-driver.ts"),
      source("packages/execution-core/src/v2/node-executor.ts"),
      source("packages/execution-core/src/base/artifact-materializer.ts"),
      source("packages/execution-core/src/integration/manifest.ts")
    ]);

    expect(worker).toContain("CanonicalNodeExecutor");
    expect(worker).not.toContain("V2ExecutionDriver");
    expect(worker).not.toContain("IntegrationAgent");
    expect(worker).not.toMatch(/\.cherryPick\s*\(/u);

    expect(driver).toContain('kind: "manifest"');
    expect(driver).toContain("artifactManifests");
    expect(driver).not.toContain("artifactLocation");
    expect(driver).not.toMatch(/\.cherryPick\s*\(/u);

    const canonicalClass = canonicalExecutor.slice(canonicalExecutor.indexOf("export class CanonicalNodeExecutor"));
    expect(canonicalClass).toContain("GitArtifactBuilder");
    expect(canonicalClass).toContain("artifactManifests");
    expect(canonicalClass).toContain("allowCommitArtifactTransport: false");
    expect(canonicalClass).not.toMatch(/\.cherryPick\s*\(/u);

    expect(materializer).toContain("not materializable on the productive route");
    expect(materializer).not.toMatch(/\.cherryPick\s*\(/u);
    expect(integrationManifest).not.toMatch(/outputArtifacts:\s*\[.*kind:\s*"commit"/u);
  });
});

function source(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}
