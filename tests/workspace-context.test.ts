import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveWorkspacePath,
  safeWorkspaceRelativePath
} from "@/lib/server/runs/workspace-context";

describe("safeWorkspaceRelativePath", () => {
  it("normalizes empty and nested relative paths", () => {
    expect(safeWorkspaceRelativePath(null)).toBe("");
    expect(safeWorkspaceRelativePath("src\\app/page.tsx")).toBe("src/app/page.tsx");
    expect(safeWorkspaceRelativePath("./")).toBe("");
  });

  it("rejects absolute paths and traversal", () => {
    expect(() => safeWorkspaceRelativePath("C:/repo/file.ts")).toThrow(/absolute/i);
    expect(() => safeWorkspaceRelativePath("/repo/file.ts")).toThrow(/absolute/i);
    expect(() => safeWorkspaceRelativePath("../secret.txt")).toThrow(/traversal/i);
    expect(() => safeWorkspaceRelativePath("src/../secret.txt")).toThrow(/traversal/i);
  });

  it("rejects sensitive or heavy workspace folders", () => {
    expect(() => safeWorkspaceRelativePath(".git/config")).toThrow(/excluded/i);
    expect(() => safeWorkspaceRelativePath("node_modules/pkg/index.js")).toThrow(/excluded/i);
    expect(() => safeWorkspaceRelativePath("apps/web/.next/server.js")).toThrow(/excluded/i);
    expect(() => safeWorkspaceRelativePath("dist/output.js")).toThrow(/excluded/i);
  });
});

describe("resolveWorkspacePath", () => {
  it("resolves paths inside the workspace root", () => {
    const root = path.resolve("repo");
    expect(resolveWorkspacePath(root, "src/index.ts")).toBe(path.resolve(root, "src/index.ts"));
  });

  it("rejects resolved paths outside the root", () => {
    const root = path.resolve("repo");
    expect(() => resolveWorkspacePath(root, "../outside.ts")).toThrow(/escapes/i);
  });
});
