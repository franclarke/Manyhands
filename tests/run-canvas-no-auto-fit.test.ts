import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("run canvas viewport ownership", () => {
  it("starts auto-fit enabled and only reacts to structural graph changes", () => {
    const source = readFileSync(path.join(process.cwd(), "apps/web/src/components/run-model/minimal-run-graph.tsx"), "utf8");
    const cockpit = readFileSync(path.join(process.cwd(), "apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx"), "utf8");
    expect(source).toContain("const initializedViewport = useRef(false)");
    expect(cockpit).toContain("const [autoFit, setAutoFit] = useState(true)");
    expect(cockpit).toContain("autoFit={autoFit}");
    expect(cockpit).toContain("onAutoFitChange={setAutoFit}");
    expect(source).toContain("onInit={initializeViewport}");
    expect(source).toMatch(/function initializeViewport\(\)[\s\S]{0,400}flow\.setCenter/);
    expect(source).toMatch(/const fitGraph = useCallback\([\s\S]{0,300}flow\.fitView/);
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]{0,500}!autoFit[\s\S]{0,500}fitGraph[\s\S]{0,300}\[autoFit, fitGraph, graphStructureKey\]/);
    expect(source).toContain("onClick={fitGraph}");
    expect(source).toContain('role="switch"');
    expect(source).toContain("aria-checked={autoFit}");
    expect(source).toContain("onAutoFitChange(!autoFit)");
    expect(source).not.toContain("fitView={");
    expect(source.match(/flow\.setCenter/g)).toHaveLength(1);
    expect(source.match(/flow\.fitView/g)).toHaveLength(1);
  });
});
