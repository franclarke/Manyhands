import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  composeRepositoryView,
  inspectRepositoryModelWithSnapshot
} from "@manyhands/repository-index";
import { buildGraphRevision, validateGraphRevision, type GraphRevisionMaterial } from "@manyhands/task-graph";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ResourceCatalog", () => {
  it("makes nesting, generated files, symlinks and gitlinks explicit and fails closed on unknown overlap", async () => {
    const root = await createRepository({
      "package.json": JSON.stringify({
        name: "trip-planner",
        scripts: { generate: "node scripts/generate.mjs" }
      }),
      "src/trip.ts": "export const trip = true;\n",
      "src/other.ts": "export const other = true;\n",
      "generated/client.ts": "export const generatedClient = true;\n",
      "packages/maps/package.json": JSON.stringify({ name: "maps" }),
      "packages/maps/src/index.ts": "export const map = true;\n",
      "scripts/generate.mjs": "// generator\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n"
    });
    const initialCommit = await commitAll(root, "initial");
    const linkTargetFile = path.join(root, ".link-target");
    await writeFile(linkTargetFile, "trip.ts", "utf8");
    const linkOid = await git(root, ["hash-object", "-w", ".link-target"]);
    await unlink(linkTargetFile);
    await git(root, ["update-index", "--add", "--cacheinfo", `120000,${linkOid},src/current-trip.ts`]);
    await git(root, ["update-index", "--add", "--cacheinfo", `160000,${initialCommit},vendor/maps`]);
    await git(root, ["commit", "-m", "add git edge entries"]);
    const baseCommit = await git(root, ["rev-parse", "HEAD"]);
    const inspection = await inspectRepositoryModelWithSnapshot({
      rootPath: root,
      repositoryId: "trip-planner",
      targetFingerprint: "target:trip-planner",
      baseCommit,
      capturedAt: "2026-08-13T00:00:00.000Z"
    });
    const view = await composeRepositoryView({ rootPath: root, inspection, overlays: [] });
    const packageResource = view.catalog.resolve("package:.");
    const tripResource = view.catalog.resolve("path:src/trip.ts");

    expect(packageResource.state).toBe("known");
    expect(tripResource.state).toBe("known");
    expect(view.catalog.overlaps("package:.", "path:src/trip.ts")).toBe("yes");
    expect(view.catalog.overlaps("package:packages/maps", "path:packages/maps/src/index.ts")).toBe("yes");
    expect(view.catalog.overlaps("module:src/trip.ts", "path:src/trip.ts")).toBe("yes");
    expect(view.catalog.overlaps("path:src/current-trip.ts", "path:src/trip.ts")).toBe("yes");
    expect(view.model.modules.map((module) => module.path)).not.toContain("src/current-trip.ts");
    expect(view.catalog.overlaps("path:src/trip.ts", "path:src/other.ts")).toBe("no");
    const gitlinkResource = view.catalog.resolve("path:vendor/maps");
    expect(gitlinkResource).toMatchObject({
      state: "known",
      resource: { gitEntryKind: "gitlink" }
    });
    if (gitlinkResource.state !== "known") throw new Error("Expected the gitlink resource to resolve.");
    expect(view.catalog.overlaps("path:vendor/maps", "path:vendor/maps/src/index.ts")).toBe("unknown");
    expect(view.catalog.resolve("path:generated/client.ts")).toMatchObject({
      state: "known",
      resource: {
        generated: {
          state: "generated",
          regenerationCommand: "node scripts/generate.mjs"
        }
      }
    });
    expect(view.catalog.resolve("path:pnpm-lock.yaml")).toMatchObject({
      state: "known",
      resource: { generated: { state: "generated" } }
    });
    for (const resource of Object.values(view.catalog.resources)) {
      expect(resource.evidenceRefs.length).toBeGreaterThan(0);
    }

    const graph = buildGraphRevision(
      graphWithUnknownGitlinkWriter(gitlinkResource.resource.id),
      (value) => `digest:${JSON.stringify(value).length}`
    );
    expect(validateGraphRevision(graph, { resourceOverlap: view.catalog.asOverlapQuery() }).map((finding) => finding.code))
      .toContain("resource_overlap_unknown");
  });
});

function graphWithUnknownGitlinkWriter(gitlinkResourceId: string): GraphRevisionMaterial {
  const ref = (id: string) => ({ id, revision: 1, digest: `digest:${id}` });
  const epistemic = { state: "known" as const, confidence: "high" as const, evidenceRefs: ["evidence:gitlink"] };
  return {
    graphId: "graph:gitlink",
    revision: 1,
    semanticPlan: ref("plan:gitlink"),
    repositoryView: { digest: "view", treeSha: "tree", resourceCatalogDigest: "catalog" },
    rootId: "root",
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "Root", goal: "Integrate", contractRef: ref("contract:root") },
      left: { id: "left", parentId: "root", kind: "leaf", title: "Left", goal: "Left", contractRef: ref("contract:left") },
      right: { id: "right", parentId: "root", kind: "leaf", title: "Right", goal: "Right", contractRef: ref("contract:right") }
    },
    artifactRequirements: [],
    seamBindings: [],
    contractRefs: [ref("contract:root"), ref("contract:left"), ref("contract:right"), ref("artifact:left"), ref("artifact:right")],
    resourceClaims: [
      {
        id: "claim:left",
        nodeId: "left",
        resourceId: gitlinkResourceId,
        source: "planner",
        evidenceRefs: ["evidence:gitlink"],
        epistemic,
        access: "modify",
        ownerPhase: "implementation",
        inputVersion: { kind: "repository_view", digest: "view" },
        outputArtifact: ref("artifact:left")
      },
      {
        id: "claim:right",
        nodeId: "right",
        resourceId: "resource:gitlink-descendant",
        source: "planner",
        evidenceRefs: ["evidence:gitlink-child"],
        epistemic,
        access: "modify",
        ownerPhase: "implementation",
        inputVersion: { kind: "repository_view", digest: "view" },
        outputArtifact: ref("artifact:right")
      }
    ],
    runtimeLeaseClaims: []
  };
}

async function createRepository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-resource-catalog-"));
  tempRoots.push(root);
  await git(root, ["init"]);
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
