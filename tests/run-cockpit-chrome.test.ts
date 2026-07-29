import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("run cockpit chrome", () => {
  it("lets the operator switch between real runs and the demo laboratory", () => {
    const sidebar = source("apps/web/src/components/app-sidebar.tsx");

    expect(sidebar).toContain('href="/runs/proto"');
    expect(sidebar).toContain('aria-label="Abrir laboratorio de runs"');
    expect(sidebar).toContain('const realRunHref = recentRuns[0] === undefined ? "/" : `/runs/${recentRuns[0].id}`');
    expect(sidebar).toContain("href={realRunHref}");
    expect(sidebar).toContain('aria-label="Volver a runs reales"');
  });

  it("lets the operator collapse and restore the right inspector", () => {
    const cockpit = source("apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx");

    expect(cockpit).toContain("const [inspectorCollapsed, setInspectorCollapsed] = useState(false)");
    expect(cockpit).toContain('aria-label={inspectorCollapsed ? "Mostrar panel de detalles" : "Ocultar panel de detalles"}');
    expect(cockpit).toContain('aria-hidden={inspectorCollapsed}');
  });

  it("keeps demo playback in a compact single-row toolbar", () => {
    const fixture = source("apps/web/src/app/runs/proto/[fixture]/cockpit-fixture-view.client.tsx");

    expect(fixture).toContain('data-layout="compact-playback"');
    expect(fixture).toContain('const ICON_BUTTON = "flex size-8');
    expect(fixture).not.toContain('const ICON_BUTTON = "grid size-8');
    expect(fixture).not.toContain("<AutoFitSwitch");
    expect(fixture).not.toContain("RunViewportControls");
    expect(fixture).toContain("fixtureToolbar={toolbar}");
    expect(fixture).not.toContain("flex flex-wrap items-center");
    expect(fixture).not.toContain('className="mt-2 flex items-center gap-3"');
  });

  it("guards delivery with the exact verified matrix and renders criterion evidence", () => {
    const cockpit = source("apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx");

    expect(cockpit).toContain("const canDeliver = isFinalCandidateDeliverable({");
    expect(cockpit).toContain("disabled={!canDeliver}");
    expect(cockpit).toContain("<EvidenceDetails matrices={model.evidenceMatrices}");
    expect(cockpit).toContain("matrixId={model.projection?.finalCandidate?.evidenceMatrixId}");
    expect(cockpit).toContain("Matriz de evidencia");
    expect(cockpit).toContain("evidenceRefs");
  });
});
