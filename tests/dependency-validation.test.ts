import { describe, expect, it } from "vitest";
import {
  dependencyAlreadyExists,
  dependencyFormState,
  dependencyWouldCreateCycle
} from "@/lib/dependency-validation";

const nodes = [
  { id: "task-1" },
  { id: "task-2" },
  { id: "task-3" }
];

const edges = [
  { source: "task-1", target: "task-2" },
  { source: "task-2", target: "task-3" }
];

describe("dependency validation", () => {
  it("rejects self-dependencies", () => {
    expect(dependencyFormState({ nodes, edges, fromTaskId: "task-1", toTaskId: "task-1" })).toMatchObject({
      valid: false,
      reason: "self_dependency",
      message: "A task cannot depend on itself"
    });
  });

  it("detects duplicate dependencies", () => {
    expect(dependencyAlreadyExists(edges, "task-1", "task-2")).toBe(true);
    expect(dependencyFormState({ nodes, edges, fromTaskId: "task-1", toTaskId: "task-2" })).toMatchObject({
      valid: false,
      reason: "duplicate_dependency",
      message: "Dependency already exists"
    });
  });

  it("detects edges that would create a cycle", () => {
    expect(dependencyWouldCreateCycle(nodes, edges, "task-3", "task-1")).toBe(true);
    expect(dependencyFormState({ nodes, edges, fromTaskId: "task-3", toTaskId: "task-1" })).toMatchObject({
      valid: false,
      reason: "cycle",
      message: "Dependency would create a cycle"
    });
  });

  it("accepts a valid new dependency", () => {
    expect(dependencyFormState({ nodes, edges, fromTaskId: "task-1", toTaskId: "task-3" })).toEqual({
      valid: true
    });
  });

  it("requires both endpoints", () => {
    expect(dependencyFormState({ nodes, edges, fromTaskId: "", toTaskId: "task-3" })).toMatchObject({
      valid: false,
      reason: "missing_endpoint",
      message: "Choose both endpoints"
    });
  });
});
