/**
 * Canvas viewport ownership guard (target UI decision A17).
 *
 * The run canvas must never recenter, refocus, or fit the viewport in reaction
 * to run events, node creation, or status changes. The productive canvas
 * (CockpitRunGraph) owns a static `defaultViewport`; the only viewport movement
 * comes from explicit user pan/zoom gestures. This guard forbids every
 * programmatic viewport-motion API across the web app so the invariant cannot
 * silently regress in any canvas surface (run workspace, fixtures, previews).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_SRC = join(REPO_ROOT, "apps", "web", "src");
const COCKPIT_GRAPH = join(WEB_SRC, "app", "runs", "[runId]", "_components", "cockpit-run-graph.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Programmatic viewport movement APIs (React Flow instance methods and the
 *  `fitView` prop). `showFitView` never matches: `\bfitView` requires a word
 *  boundary immediately before the lowercase `f`. */
const FORBIDDEN_VIEWPORT_MOTION = [
  /\.fitView\(/,
  /\.setCenter\(/,
  /\.setViewport\(/,
  /\.fitBounds\(/,
  /\.zoomTo\(/,
  /\bfitView\s*=/,
  /\sfitView\s*[>/]/
];

describe("run canvas viewport ownership", () => {
  it("no web component moves the viewport programmatically", () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_SRC)) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_VIEWPORT_MOTION) {
        if (pattern.test(source)) offenders.push(`${file.slice(WEB_SRC.length + 1)} matches ${pattern}`);
      }
    }
    expect(offenders, `programmatic viewport motion found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the productive cockpit canvas owns a static viewport", () => {
    const source = readFileSync(COCKPIT_GRAPH, "utf8");
    expect(source).toContain("defaultViewport={");
    expect(source).toContain("showFitView={false}");
  });
});
