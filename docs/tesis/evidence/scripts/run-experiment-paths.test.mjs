import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunsDir } from "./run-experiment-paths.mjs";

test("the detached driver uses the authorized MANYHANDS_RUNS_DIR over a stale cell path", () => {
  assert.equal(
    resolveRunsDir(
      { runsDir: "C:\\stale\\runtime\\runs" },
      "C:\\authorized\\runtime\\runs"
    ),
    "C:\\authorized\\runtime\\runs"
  );
});

test("the detached driver falls back to the frozen cell path when no override exists", () => {
  assert.equal(
    resolveRunsDir({ runsDir: "C:\\frozen\\runtime\\runs" }, undefined),
    "C:\\frozen\\runtime\\runs"
  );
});
