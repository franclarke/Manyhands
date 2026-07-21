import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const runViewSource = readFileSync(
  path.join(process.cwd(), "apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx"),
  "utf8"
);
const loadingSource = readFileSync(
  path.join(process.cwd(), "apps/web/src/app/runs/[runId]/loading.tsx"),
  "utf8"
);

describe("run loading skeleton", () => {
  it("mirrors the current cockpit regions and dimensions", () => {
    const sharedLayoutClasses = [
      "px-6 py-4",
      "grid-cols-[minmax(0,1fr)_340px]",
      "border-r border-[var(--color-border)]",
      "bg-[var(--color-surface)]"
    ];

    for (const className of sharedLayoutClasses) {
      expect(runViewSource).toContain(className);
      expect(loadingSource).toContain(className);
    }

    expect(loadingSource).toContain("Graph workspace skeleton");
    expect(loadingSource).toContain("Inspector skeleton");
    expect(loadingSource).toContain("w-[230px]");
    expect(loadingSource).not.toContain("Chat panel skeleton");
    expect(loadingSource).not.toContain("w-[30%]");
  });
});
