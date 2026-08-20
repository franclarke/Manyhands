import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonlTraceStore } from "@manyhands/trace-store";

import { readNodeActivity } from "../apps/daemon/src/node-activity.js";

/**
 * A run showed a node as RUNNING and nothing else. The agent's output was
 * already recorded — `V2NodeExecutor` appends every chunk to the trace store —
 * but nothing read it back, so the operator watched a spinner and guessed.
 *
 * Activity is a query over those traces, scoped to one node, resumable by
 * index so a reader that reconnects does not replay what it already has.
 */
describe("readNodeActivity", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function stateRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), "manyhands-activity-"));
    roots.push(root);
    return root;
  }

  function store(root: string, runId: string): JsonlTraceStore {
    return new JsonlTraceStore({ runId, directory: path.join(root, "traces") });
  }

  it("returns only the addressed node's agent activity, in order", () => {
    const root = stateRoot();
    const traces = store(root, "run:1");
    traces.append({ type: "executor_started", actor: "agent", taskId: "unit:domain", payload: {} });
    traces.append({ type: "executor_output", actor: "agent", taskId: "unit:storage", payload: { chunk: "other" } });
    traces.append({ type: "executor_output", actor: "agent", taskId: "unit:domain", payload: { chunk: "reading files" } });
    traces.append({ type: "executor_completed", actor: "agent", taskId: "unit:domain", payload: {} });

    const page = readNodeActivity({ stateRoot: root, runId: "run:1", nodeId: "unit:domain", afterIndex: 0 });

    expect(page.entries.map(({ type, text }) => [type, text])).toEqual([
      ["executor_started", ""],
      ["executor_output", "reading files"],
      ["executor_completed", ""]
    ]);
    // The index counts this node's activity, not every trace in the run, so a
    // reader resuming from it is unaffected by what other nodes wrote.
    expect(page.nextIndex).toBe(3);
  });

  it("resumes after an index so a reconnecting reader sees only what is new", () => {
    const root = stateRoot();
    const traces = store(root, "run:1");
    traces.append({ type: "executor_output", actor: "agent", taskId: "unit:domain", payload: { chunk: "first" } });
    traces.append({ type: "executor_output", actor: "agent", taskId: "unit:domain", payload: { chunk: "second" } });

    const page = readNodeActivity({ stateRoot: root, runId: "run:1", nodeId: "unit:domain", afterIndex: 1 });

    expect(page.entries.map(({ text }) => text)).toEqual(["second"]);
    expect(page.nextIndex).toBe(2);
  });

  it("is empty for a run that has produced no traces yet", () => {
    const page = readNodeActivity({
      stateRoot: stateRoot(),
      runId: "run:absent",
      nodeId: "unit:domain",
      afterIndex: 0
    });

    expect(page).toEqual({ entries: [], nextIndex: 0 });
  });
});
