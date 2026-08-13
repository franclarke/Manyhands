import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Stage 3 cancellation retirement", () => {
  it("keeps the productive cancel route unreachable from the V2 web owner", async () => {
    const source = await readFile(
      path.resolve("apps/web/src/app/api/runs/[id]/cancel/route.ts"),
      "utf8"
    );
    expect(source).toContain("submitProductRunCommand");
    expect(source).not.toMatch(/registerLiveProcess|run-operation-lease|runner-state|JsonlRunEventStore/);
  });
});
