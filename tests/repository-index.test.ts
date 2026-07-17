import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRepositoryIndex,
  summarizeRepositoryIndex
} from "@manyhands/repository-index";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TypeScriptRepositoryIndexer", () => {
  it("indexes symbols and includes file content in the deterministic hash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-repository-index-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    const source = path.join(root, "src", "booking.ts");
    await writeFile(source, "export const bookingStatus = 'open';", "utf8");

    const first = await buildRepositoryIndex({ rootPath: root, repositoryId: "booking-app" });
    const firstSummary = summarizeRepositoryIndex(first);
    expect(first.files).toEqual([
      expect.objectContaining({
        path: "src/booking.ts",
        kind: "source",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
      })
    ]);
    expect(first.symbols).toEqual([
      expect.objectContaining({ name: "bookingStatus", exported: true, filePath: "src/booking.ts" })
    ]);

    await writeFile(source, "export const bookingStatus = 'closed';", "utf8");
    const second = await buildRepositoryIndex({ rootPath: root, repositoryId: "booking-app" });
    const secondSummary = summarizeRepositoryIndex(second);

    expect(second.files[0]?.declaredSymbols).toEqual(first.files[0]?.declaredSymbols);
    expect(second.files[0]?.contentHash).not.toBe(first.files[0]?.contentHash);
    expect(secondSummary.indexHash).not.toBe(firstSummary.indexHash);
  });
});
