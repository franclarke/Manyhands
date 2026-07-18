import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("run canvas viewport ownership", () => {
  it("frames once and never fits in response to node or event changes", () => {
    const source = readFileSync(path.join(process.cwd(), "apps/web/src/components/run-model/minimal-run-graph.tsx"), "utf8");
    expect(source).toContain("const framed = useRef(false)");
    expect(source).toContain("if (framed.current || nodes.length === 0) return");
    expect(source).toMatch(/useEffect\([\s\S]{0,500}\[flow, nodes\.length\]/);
    expect(source).not.toMatch(/useEffect\([\s\S]{0,500}\[flow, nodes\]/);
  });
});
