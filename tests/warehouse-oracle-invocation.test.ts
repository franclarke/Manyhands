import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCommandSurface, runPnpm } from "../docs/tesis/evidence/warehouse/oracles/oracle-core.mjs";

const fixture = path.resolve("tests/fixtures/warehouse-probe");

/** The seed's placeholder scripts. A delivery that leaves them is unvalidated. */
const seedScripts = {
  build: "node -e \"console.log('empty seed build: ok')\"",
  test: "node -e \"console.log('empty seed tests: ok')\"",
  typecheck: "node -e \"console.log('empty seed typecheck: ok')\""
};

describe("Warehouse oracle command invocation", () => {
  it("delivers the published `--` separated probe arguments intact", async () => {
    const { stdout } = await runPnpm(
      ["--silent", "study:probe", "--", "--increment", "W1", "--scenario", "thesis-seed-2026", "--format", "json"],
      fixture,
      120_000
    );

    expect(JSON.parse(stdout.trim())).toEqual({
      increment: "W1",
      scenario: "thesis-seed-2026",
      format: "json"
    });
  });

  it("runs a plain pnpm script with --silent", async () => {
    const { stdout } = await runPnpm(["--silent", "test"], fixture, 120_000);

    expect(stdout.trim()).toBe("fixture tests: ok");
  });
});

/**
 * A missing probe and a surviving seed stub both used to surface late and
 * unrecognisably: the first as a shell "command not found" that reads like a
 * broken instrument, the second not at all — the stubs exit 0, so `test:pass`
 * was recorded for a delivery nothing had validated. Both are decidable from
 * the target's manifest in milliseconds, before any build is spent.
 */
describe("Warehouse oracle command surface", () => {
  it("accepts a manifest exposing a real probe and real gates", () => {
    expect(checkCommandSurface({
      scripts: {
        test: "vitest run",
        typecheck: "tsc --noEmit",
        build: "tsc -b",
        "study:probe": "node dist/cli/study-probe.js"
      }
    })).toEqual([]);
  });

  it("names a missing study:probe script", () => {
    const failures = checkCommandSurface({ scripts: { test: "vitest run", typecheck: "tsc --noEmit", build: "tsc -b" } });

    expect(failures.join(" ")).toContain("study:probe");
  });

  it("names every missing gate script", () => {
    const failures = checkCommandSurface({ scripts: { "study:probe": "node probe.js" } });

    for (const script of ["test", "typecheck", "build"]) {
      expect(failures.join(" ")).toContain(script);
    }
  });

  it.each(Object.keys(seedScripts))("rejects the untouched seed stub for %s", (script) => {
    const failures = checkCommandSurface({
      scripts: {
        test: "vitest run",
        typecheck: "tsc --noEmit",
        build: "tsc -b",
        "study:probe": "node probe.js",
        [script]: seedScripts[script as keyof typeof seedScripts]
      }
    });

    expect(failures.join(" ")).toContain(script);
  });

  it("rejects a probe that is itself a stub", () => {
    const failures = checkCommandSurface({
      scripts: {
        test: "vitest run",
        typecheck: "tsc --noEmit",
        build: "tsc -b",
        "study:probe": "node -e \"console.log('{}')\""
      }
    });

    expect(failures.join(" ")).toContain("study:probe");
  });

  it("rejects a manifest with no scripts block at all", () => {
    expect(checkCommandSurface({}).length).toBeGreaterThan(0);
  });
});
