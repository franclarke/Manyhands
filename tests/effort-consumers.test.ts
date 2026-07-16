import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EFFORT_LEVELS } from "@manyhands/shared";
import {
  MODEL_OPTIONS,
  effortLevelsForSelection,
  supportsEffortForSelection
} from "@/lib/models";

describe("web model options derive effort from the registry", () => {
  it("exposes Codex models with exactly the declared efforts and a default", () => {
    for (const model of MODEL_OPTIONS.filter((m) => m.executorId === "codex-cli")) {
      expect(model.supportsEffort, `${model.id}`).toBe(true);
      expect(model.efforts, `${model.id}`).toEqual(["low", "medium", "high", "xhigh"]);
      expect(model.defaultEffort, `${model.id}`).toBe("medium");
    }
  });

  it("exposes Claude models with no effort control", () => {
    for (const model of MODEL_OPTIONS.filter((m) => m.executorId === "claude-code-cli")) {
      expect(model.supportsEffort, `${model.id}`).toBe(false);
      expect(model.efforts, `${model.id}`).toBeNull();
      expect(model.defaultEffort, `${model.id}`).toBeUndefined();
    }
  });

  it("makes xhigh reachable for the UI once the registry declares it", () => {
    const levels = effortLevelsForSelection({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(levels).toEqual([...EFFORT_LEVELS]);
    expect(levels).toContain("xhigh");
    expect(effortLevelsForSelection({ executorId: "claude-code-cli", model: "sonnet" })).toBeNull();
  });

  it("derives supportsEffort from the shared registry, not a hardcoded set", () => {
    expect(supportsEffortForSelection({ executorId: "codex-cli", model: "gpt-5.4-mini" })).toBe(true);
    expect(supportsEffortForSelection({ executorId: "claude-code-cli", model: "opus" })).toBe(false);
  });
});

describe("single canonical EffortLevel definition", () => {
  // Tripwire: no source file outside the shared registry may re-declare the
  // reasoning-effort union `"low" | "medium" | "high" | "xhigh"` (in any order)
  // nor a bare `EffortLevel = ...` alias. Risk levels (`blocking`) and
  // decomposer aggressiveness (`auto`) are DIFFERENT domains and are ignored.
  const root = path.resolve(__dirname, "..");
  const canonical = path.join("packages", "shared", "src", "executor-registry.ts");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("finds no parallel reasoning-effort union or EffortLevel alias outside the registry", () => {
    const effortUnion = /["'](?:low|medium|high|xhigh)["']\s*\|\s*["'](?:low|medium|high|xhigh)["']\s*\|\s*["'](?:low|medium|high|xhigh)["']\s*\|\s*["']xhigh["']/;
    // A real alias DECLARATION (`type EffortLevel = ...`), not an import/re-export of it.
    const effortAlias = /\btype\s+EffortLevel\s*[=<]/;
    const offenders: string[] = [];
    for (const dir of [path.join(root, "packages"), path.join(root, "apps", "web", "src")]) {
      for (const file of sourceFiles(dir)) {
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (rel === canonical.split(path.sep).join("/")) continue;
        const text = readFileSync(file, "utf8");
        if (effortUnion.test(text) || effortAlias.test(text)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
