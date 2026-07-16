import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const consumers = [
  "apps/web/src/lib/server/runs/planning-host.ts",
  "apps/web/src/lib/server/runs/replan-service.ts",
  "apps/web/src/app/api/runs/[id]/nodes/[taskId]/regen/route.ts"
];

describe("planning invocation consumers", () => {
  it("route all productive planning through PlanningInvocationService", async () => {
    for (const path of consumers) {
      const source = await readFile(path, "utf8");
      expect(source, path).toContain("planning-invocation-service");
      expect(source, path).not.toMatch(/\bpickDecomposer\b/);
      expect(source, path).not.toMatch(/\brunMockPlanningFlow\b/);
    }
  });
});
