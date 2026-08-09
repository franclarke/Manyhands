import test from "node:test";
import assert from "node:assert/strict";
import { buildRunRequest } from "./run-experiment-request.mjs";

test("buildRunRequest forwards the frozen semantic acceptance criteria", () => {
  const request = buildRunRequest({
    goal: "goal",
    acceptanceCriteria: ["criterion one", "criterion two"],
    planningSelection: { executorId: "codex-cli", model: "gpt-5.4-mini", effort: "medium" },
    executionSelection: { executorId: "codex-cli", model: "gpt-5.4-mini", effort: "medium" },
    repairSelection: { executorId: "codex-cli", model: "gpt-5.4-mini", effort: "medium" },
    executionConfig: { maxParallel: 2 }
  }, "workspace-1");

  assert.deepEqual(request.acceptanceCriteria, ["criterion one", "criterion two"]);
  assert.equal(request.workspaceId, "workspace-1");
});

test("buildRunRequest does not invent criteria for legacy configs", () => {
  const request = buildRunRequest({
    goal: "goal",
    planningSelection: { executorId: "codex-cli", model: "gpt-5.4-mini", effort: "medium" },
    executionSelection: { executorId: "codex-cli", model: "gpt-5.4-mini", effort: "medium" },
    executionConfig: { maxParallel: 2 }
  }, "workspace-1");

  assert.equal("acceptanceCriteria" in request, false);
});
