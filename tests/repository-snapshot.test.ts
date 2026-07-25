import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RepositoryFileIndexSchema,
  RepositorySnapshotBuilder,
  RepositorySnapshotSchema,
  type RepositoryIndexer
} from "@manyhands/repository-index";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RepositorySnapshotBuilder", () => {
  it("keeps historical file index records without size metrics replayable", () => {
    expect(RepositoryFileIndexSchema.safeParse({
      path: "src/historical.ts",
      kind: "source",
      contentHash: "a".repeat(64),
      exportedSymbols: [],
      importedSymbols: [],
      declaredSymbols: []
    }).success).toBe(true);
  });

  it("produces the same identity for the same target, commit and content", async () => {
    const root = await repository({
      "package.json": JSON.stringify({
        name: "booking-app",
        packageManager: "pnpm@11.7.0",
        scripts: { test: "vitest run", typecheck: "tsc --noEmit" },
        dependencies: { react: "19.2.0" },
        devDependencies: { typescript: "5.7.2", vitest: "2.1.9" }
      }),
      "src/booking.ts": "export function book(id: string): string { return id; }"
    });
    const builder = new RepositorySnapshotBuilder();
    const input = {
      rootPath: root,
      repositoryId: "booking-app",
      targetFingerprint: "target-fingerprint",
      baseCommit: "1111111111111111111111111111111111111111"
    };

    const first = await builder.build({ ...input, capturedAt: "2026-07-17T00:00:00.000Z" });
    const second = await builder.build({ ...input, capturedAt: "2026-07-17T01:00:00.000Z" });

    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first.inspectionDisposition).toBe("complete");
    expect(first.capabilities).toMatchObject({
      packageManager: { name: "pnpm", version: "11.7.0" },
      scripts: { test: "vitest run", typecheck: "tsc --noEmit" }
    });
    expect(first.capabilities.baselineCommands).toEqual([
      { kind: "test", command: "pnpm", args: ["test"], sourceScript: "test" },
      { kind: "typecheck", command: "pnpm", args: ["typecheck"], sourceScript: "typecheck" }
    ]);
    expect(first.capabilities.stack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "react", confidence: 1 }),
        expect.objectContaining({ name: "typescript", confidence: 1 }),
        expect.objectContaining({ name: "vitest", confidence: 1 })
      ])
    );
    expect(RepositorySnapshotSchema.safeParse(first).success).toBe(true);
  });

  it("changes identity when the base commit or repository content changes", async () => {
    const root = await repository({
      "package.json": JSON.stringify({ name: "booking-app" }),
      "src/booking.ts": "export const bookingStatus = 'open';"
    });
    const builder = new RepositorySnapshotBuilder();
    const common = {
      rootPath: root,
      repositoryId: "booking-app",
      targetFingerprint: "target-fingerprint",
      baseCommit: "1111111111111111111111111111111111111111",
      capturedAt: "2026-07-17T00:00:00.000Z"
    };

    const first = await builder.build(common);
    const otherCommit = await builder.build({
      ...common,
      baseCommit: "2222222222222222222222222222222222222222"
    });
    await writeFile(path.join(root, "src", "booking.ts"), "export const bookingStatus = 'closed';", "utf8");
    const otherContent = await builder.build(common);

    expect(otherCommit.snapshotId).not.toBe(first.snapshotId);
    expect(otherContent.snapshotId).not.toBe(first.snapshotId);
    expect(otherContent.indexHash).not.toBe(first.indexHash);
  });

  it("labels a repository without supported source files as partial", async () => {
    const root = await repository({
      "package.json": JSON.stringify({ name: "docs-only", scripts: { lint: "markdownlint ." } }),
      "README.md": "# Docs only"
    });

    const snapshot = await new RepositorySnapshotBuilder().build({
      rootPath: root,
      repositoryId: "docs-only",
      targetFingerprint: "docs-target",
      baseCommit: "1111111111111111111111111111111111111111",
      capturedAt: "2026-07-17T00:00:00.000Z"
    });

    expect(snapshot.inspectionDisposition).toBe("partial");
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "no_supported_source_files", severity: "warning" })
      ])
    );
    expect(snapshot.capabilities.languages).toEqual([]);
  });

  it("returns an unavailable snapshot instead of disguising indexer failure", async () => {
    const root = await repository({ "package.json": JSON.stringify({ name: "broken-index" }) });
    const unavailableIndexer: RepositoryIndexer = {
      index: async () => {
        throw new Error("indexer exploded");
      }
    };

    const snapshot = await new RepositorySnapshotBuilder({ indexer: unavailableIndexer }).build({
      rootPath: root,
      repositoryId: "broken-index",
      targetFingerprint: "broken-target",
      baseCommit: "1111111111111111111111111111111111111111",
      capturedAt: "2026-07-17T00:00:00.000Z"
    });

    expect(snapshot.inspectionDisposition).toBe("unavailable");
    expect(snapshot.index).toBeUndefined();
    expect(snapshot.indexHash).toBeUndefined();
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ code: "index_unavailable", severity: "error", message: "indexer exploded" })
    ]);
  });
});

async function repository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-repository-snapshot-"));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}
