import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFixtureRepoProvisioner,
  RepoProvisionError
} from "@/lib/server/runs/repo-provisioner";
import { rmWithRetry } from "@/lib/server/runs/fs-retry";

let tempDir: string;
let benchmarksRoot: string;
let workRoot: string;

const FIXTURE_ID = "sample-api";

async function seedFixture(): Promise<void> {
  const fixtureDir = path.join(benchmarksRoot, FIXTURE_ID);
  await mkdir(path.join(fixtureDir, "src"), { recursive: true });
  await writeFile(path.join(fixtureDir, "package.json"), '{"name":"sample-api"}\n');
  await writeFile(path.join(fixtureDir, "src", "index.ts"), "export const x = 1;\n");
  // Excluded directory: must not be copied into the provisioned repo.
  await mkdir(path.join(fixtureDir, "node_modules", "left-pad"), { recursive: true });
  await writeFile(path.join(fixtureDir, "node_modules", "left-pad", "index.js"), "// junk\n");
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-provisioner-"));
  benchmarksRoot = path.join(tempDir, "benchmarks");
  workRoot = path.join(tempDir, "work");
  await seedFixture();
});

afterEach(async () => {
  await rmWithRetry(tempDir);
});

describe("createFixtureRepoProvisioner", () => {
  it("copies the fixture into a per-run repo with a real base commit", async () => {
    const provisioner = createFixtureRepoProvisioner({ benchmarksRoot, workRoot });
    const provisioned = await provisioner.provision({
      spec: { kind: "fixture", fixtureId: FIXTURE_ID },
      runId: "run-1"
    });

    expect(provisioned.baseBranch).toBe("main");
    expect(provisioned.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(path.join(provisioned.repoRoot, "package.json"))).toBe(true);
    expect(existsSync(path.join(provisioned.repoRoot, "src", "index.ts"))).toBe(true);

    // The base commit is real and reachable in the provisioned repo.
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: provisioned.repoRoot,
      encoding: "utf8"
    }).trim();
    expect(head).toBe(provisioned.baseCommit);
  });

  it("excludes node_modules from the provisioned repo", async () => {
    const provisioner = createFixtureRepoProvisioner({ benchmarksRoot, workRoot });
    const provisioned = await provisioner.provision({
      spec: { kind: "fixture", fixtureId: FIXTURE_ID },
      runId: "run-1"
    });
    expect(existsSync(path.join(provisioned.repoRoot, "node_modules"))).toBe(false);
  });

  it("isolates each run in its own directory", async () => {
    const provisioner = createFixtureRepoProvisioner({ benchmarksRoot, workRoot });
    const a = await provisioner.provision({ spec: { kind: "fixture", fixtureId: FIXTURE_ID }, runId: "run-a" });
    const b = await provisioner.provision({ spec: { kind: "fixture", fixtureId: FIXTURE_ID }, runId: "run-b" });

    expect(a.repoRoot).not.toBe(b.repoRoot);
    expect(existsSync(a.repoRoot)).toBe(true);
    expect(existsSync(b.repoRoot)).toBe(true);
  }, 30000);

  it("cleanup removes the per-run working directory", async () => {
    const provisioner = createFixtureRepoProvisioner({ benchmarksRoot, workRoot });
    const provisioned = await provisioner.provision({
      spec: { kind: "fixture", fixtureId: FIXTURE_ID },
      runId: "run-1"
    });
    await provisioned.cleanup();
    expect(existsSync(provisioned.repoRoot)).toBe(false);
  });

  it("throws RepoProvisionError when the fixture does not exist", async () => {
    const provisioner = createFixtureRepoProvisioner({ benchmarksRoot, workRoot });
    await expect(
      provisioner.provision({ spec: { kind: "fixture", fixtureId: "missing" }, runId: "run-1" })
    ).rejects.toBeInstanceOf(RepoProvisionError);
  });
});
