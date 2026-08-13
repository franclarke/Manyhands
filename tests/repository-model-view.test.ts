import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  composeRepositoryView,
  inspectRepositoryModel,
  inspectRepositoryModelWithSnapshot
} from "@manyhands/repository-index";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RepositoryModel", () => {
  it("derives deterministic evidence-bearing facts from the exact Git tree", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({
        name: "trip-planner",
        type: "module",
        exports: { ".": "./src/index.ts" },
        scripts: { test: "vitest run", build: "tsc --noEmit" }
      }),
      "src/index.ts": "export { createTrip } from './trip.js';\n",
      "src/trip.ts": "export function createTrip(name: string): string { return name; }\n",
      "tests/trip.test.ts": "import { createTrip } from '../src/trip.js';\nvoid createTrip('demo');\n"
    });
    const baseCommit = await commitAll(root, "base");
    const treeSha = await git(root, ["rev-parse", `${baseCommit}^{tree}`]);

    await writeFile(path.join(root, "src", "trip.ts"), "export const dirty = true;\n", "utf8");
    const first = await inspectRepositoryModel({
      rootPath: root,
      repositoryId: "trip-planner",
      targetFingerprint: "target:trip-planner",
      baseCommit,
      capturedAt: "2026-08-13T00:00:00.000Z"
    });
    const second = await inspectRepositoryModel({
      rootPath: root,
      repositoryId: "trip-planner",
      targetFingerprint: "target:trip-planner",
      baseCommit,
      capturedAt: "2026-08-13T01:00:00.000Z"
    });

    expect(first.digest).toBe(second.digest);
    expect(first.treeSha).toBe(treeSha);
    expect(first.packages).toEqual([
      expect.objectContaining({
        name: "trip-planner",
        rootPath: "",
        evidenceRefs: expect.arrayContaining([expect.stringMatching(/^evidence:/u)])
      })
    ]);
    expect(first.modules.map((module) => module.path)).toEqual([
      "src/index.ts",
      "src/trip.ts",
      "tests/trip.test.ts"
    ]);
    expect(first.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromModulePath: "tests/trip.test.ts",
          moduleSpecifier: "../src/trip.js",
          resolvedModulePath: "src/trip.ts",
          epistemic: expect.objectContaining({ state: "known" })
        })
      ])
    );
    expect(first.tests).toEqual([
      expect.objectContaining({
        path: "tests/trip.test.ts",
        sourceModulePaths: ["src/trip.ts"],
        evidenceRefs: expect.any(Array)
      })
    ]);
    expect(first.evidence.length).toBeGreaterThan(0);
    const evidenceIds = new Set(first.evidence.map((item) => item.id));
    for (const fact of [
      ...first.packages,
      ...first.modules,
      ...first.symbols,
      ...first.relationships,
      ...first.publicInterfaces,
      ...first.tests,
      ...first.commands,
      ...first.resources,
      ...first.conventions,
      ...first.diagnostics
    ]) {
      expect(fact.evidenceRefs.length).toBeGreaterThan(0);
      expect(fact.evidenceRefs.every((evidenceRef) => evidenceIds.has(evidenceRef))).toBe(true);
    }
    expect(first.modules.find((module) => module.path === "src/trip.ts")?.exportedSymbols)
      .toContain("createTrip");
  });

  it("derives the object format and stable identities from a SHA-256 repository", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({ name: "sha256-repository" }),
      "src/index.ts": "export const exact = true;\n"
    }, "sha256");
    const baseCommit = await commitAll(root, "base");
    const first = await inspectRepositoryModel({
      rootPath: root,
      targetFingerprint: "target:sha256-repository",
      baseCommit
    });
    const second = await inspectRepositoryModel({
      rootPath: root,
      targetFingerprint: "target:sha256-repository",
      baseCommit
    });

    expect(first.objectFormat).toBe("sha256");
    expect(first.gitEntries.every((entry) => entry.oid.length === 64)).toBe(true);
    expect(first.digest).toBe(second.digest);
  });

  it("composes ordered exact overlays without floating to the working tree", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({ name: "trip-planner", type: "module" }),
      "src/old-trip.ts": "export const tripName = 'old';\n"
    });
    const baseCommit = await commitAll(root, "base");
    const baseTreeSha = await git(root, ["rev-parse", `${baseCommit}^{tree}`]);
    const oldOid = await git(root, ["rev-parse", `${baseCommit}:src/old-trip.ts`]);
    await git(root, ["mv", "src/old-trip.ts", "src/trip.ts"]);
    await writeFile(path.join(root, "src", "trip.ts"), "export const tripName = 'new';\n", "utf8");
    const overlayCommit = await commitAll(root, "rename trip module");
    const resultTreeSha = await git(root, ["rev-parse", `${overlayCommit}^{tree}`]);
    const newOid = await git(root, ["rev-parse", `${overlayCommit}:src/trip.ts`]);
    const inspection = await inspectRepositoryModelWithSnapshot({
      rootPath: root,
      repositoryId: "trip-planner",
      targetFingerprint: "target:trip-planner",
      baseCommit,
      capturedAt: "2026-08-13T00:00:00.000Z"
    });

    await writeFile(path.join(root, "src", "trip.ts"), "export const dirty = 'ignored';\n", "utf8");
    const input = {
      rootPath: root,
      inspection,
      overlays: [{
        manifestDigest: "sha256:rename-trip",
        baseTreeSha,
        resultTreeSha,
        entries: [
          { operation: "delete" as const, oldPath: "src/old-trip.ts", oldOid, oldMode: "100644" },
          {
            operation: "add" as const,
            newPath: "src/trip.ts",
            newOid,
            newMode: "100644",
            detectedRenameFrom: "src/old-trip.ts"
          }
        ]
      }]
    };
    const first = await composeRepositoryView(input);
    const second = await composeRepositoryView(input);

    expect(first.digest).toBe(second.digest);
    expect(first.treeSha).toBe(resultTreeSha);
    expect(first.baseModelDigest).toBe(inspection.model.digest);
    expect(first.appliedManifestDigests).toEqual(["sha256:rename-trip"]);
    expect(first.model.modules.map((module) => module.path)).toEqual(["src/trip.ts"]);
    expect(first.model.modules[0]?.exportedSymbols).toEqual(["tripName"]);
    expect(first.resourceCatalogDigest).toBe(first.catalog.digest);
    expect(first.catalog.resolve("path:src/old-trip.ts")).toMatchObject({
      state: "known",
      resource: { canonicalLocator: "path:src/trip.ts" }
    });
    expect(first.catalog.overlaps("path:src/old-trip.ts", "path:src/trip.ts")).toBe("yes");

    await expect(composeRepositoryView({
      rootPath: root,
      inspection,
      overlays: [{
        ...input.overlays[0]!,
        entries: [
          { operation: "delete", oldPath: "src/old-trip.ts", oldOid: newOid, oldMode: "100644" },
          input.overlays[0]!.entries[1]!
        ]
      }]
    })).rejects.toThrow(/stale preimage/u);
    await expect(composeRepositoryView({
      rootPath: root,
      inspection,
      overlays: [{ ...input.overlays[0]!, resultTreeSha: baseTreeSha }]
    })).rejects.toThrow(/does not describe/u);
    await expect(composeRepositoryView({
      rootPath: root,
      inspection,
      overlays: [input.overlays[0]!, input.overlays[0]!]
    })).rejects.toThrow(/applied more than once/u);
  });
});

async function createRepository(
  files: Record<string, string>,
  objectFormat: "sha1" | "sha256" = "sha1"
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-repository-model-"));
  tempRoots.push(root);
  await git(root, objectFormat === "sha1" ? ["init"] : ["init", "--object-format=sha256"]);
  await git(root, ["config", "user.email", "tests@manyhands.local"]);
  await git(root, ["config", "user.name", "ManyHands Tests"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  return stdout.trim();
}
