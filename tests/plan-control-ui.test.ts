import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL(
  "../apps/web/src/app/runs/[runId]/_components/plan-control-surface.client.tsx",
  import.meta.url
);
const workspacePath = new URL(
  "../apps/web/src/app/runs/[runId]/_components/run-workspace-surfaces.client.tsx",
  import.meta.url
);

describe("plan control UI", () => {
  it("gives every productive plan-control route an explicit user control", async () => {
    const source = await readFile(componentPath, "utf8");
    const routeFragments = [
      "/plan-review",
      "/nodes/${encodeURIComponent(",
      "/regen`",
      "/run`",
      "/review`",
      "/risks/acknowledge",
      "/auto-resolve",
      "/serialize",
      "/dependencies",
      "/integrator",
      "/fork",
      "/diagnostics"
    ];

    for (const route of routeFragments) {
      expect(source, `missing UI consumer for ${route}`).toContain(route);
    }
  });

  it("exposes the plan as a first-class dock surface", async () => {
    const source = await readFile(workspacePath, "utf8");
    expect(source).toContain('"agents" | "plan" | "node"');
    expect(source).toContain("<PlanControlSurface");
    expect(source).toContain('onOpenSurface("plan")');
  });

  it("explains that canonical dependencies order tasks without materializing upstream files", async () => {
    const source = await readFile(componentPath, "utf8");
    expect(source).toContain("barrera de orden");
    expect(source).toContain("mismo commit base");
    expect(source).toContain("no recibe los archivos");
  });

  it("does not offer impossible per-node executor choices for fixed runs", async () => {
    const source = await readFile(componentPath, "utf8");
    expect(source).toContain("routing={control.routing}");
    expect(source).toContain('routing === "complexity"');
    expect(source).toContain("routing fijo");
    expect(source).toContain("Quitar override legacy");
  });
});
