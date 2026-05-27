import { describe, expect, it } from "vitest";
import {
  WORKSPACE_FILE_VERSION,
  WorkspaceCreateInputSchema,
  WorkspaceFileSchema,
  WorkspaceSchema,
  WorkspaceUpdateInputSchema
} from "@/lib/server/workspaces/schema";

describe("workspace schema", () => {
  it("accepts a minimal workspace", () => {
    const result = WorkspaceSchema.safeParse({
      id: "abc",
      slug: "abc",
      name: "ABC",
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z"
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = WorkspaceCreateInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects names longer than 80 chars", () => {
    const result = WorkspaceCreateInputSchema.safeParse({ name: "x".repeat(81) });
    expect(result.success).toBe(false);
  });

  it("rejects descriptions longer than 400 chars", () => {
    const result = WorkspaceCreateInputSchema.safeParse({
      name: "ok",
      description: "x".repeat(401)
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed color", () => {
    const result = WorkspaceCreateInputSchema.safeParse({ name: "ok", color: "not-a-color" });
    expect(result.success).toBe(false);
  });

  it("accepts hex colors", () => {
    expect(WorkspaceCreateInputSchema.safeParse({ name: "ok", color: "#cc785c" }).success).toBe(true);
    expect(WorkspaceCreateInputSchema.safeParse({ name: "ok", color: "#abc" }).success).toBe(true);
  });

  it("update input accepts partial payloads", () => {
    expect(WorkspaceUpdateInputSchema.safeParse({}).success).toBe(true);
    expect(WorkspaceUpdateInputSchema.safeParse({ name: "new" }).success).toBe(true);
  });

  it("file schema enforces version literal", () => {
    expect(
      WorkspaceFileSchema.safeParse({
        version: WORKSPACE_FILE_VERSION,
        workspaces: []
      }).success
    ).toBe(true);
    expect(
      WorkspaceFileSchema.safeParse({ version: 99, workspaces: [] }).success
    ).toBe(false);
  });
});
