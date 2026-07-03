/**
 * Typography & spacing guard (UI/UX design-system loop, foundation v-next).
 *
 * The foundation elevation replaces off-scale arbitrary type sizes with a small
 * set of role tokens (--fs-eyebrow/micro/meta/label + the unchanged base/md/lg/
 * xl/2xl) exposed as Tailwind @theme utilities, and rounds off-grid spacing onto
 * the 4px scale. This test is the guard so the arbitraries never come back:
 *   1. globals.css defines the role tokens AND wires them as @theme utilities.
 *   2. the two CSS defect fixes hold (no faux 650 weight, no orphan 17px).
 *   3. no component carries an off-scale `text-[Npx]` arbitrary.
 *   4. no component carries an off-grid spacing half-step (2.5 / 5.5).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_SRC = join(REPO_ROOT, "apps", "web", "src");
const GLOBALS = join(WEB_SRC, "app", "globals.css");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Off-scale font sizes: `text-[12.5px]`, `text-[11px]`, … (size arbitraries only;
 *  `text-[var(--…)]` color utilities start with a letter and never match). */
const OFF_SCALE_TEXT = /text-\[\d+(?:\.\d+)?px\]/;
/** Off-grid spacing half-steps that must round onto the 4px grid. 0.5/1/1.5 are
 *  the sanctioned sub-grid (hairline insets / 6px control gap) and are allowed. */
const OFF_GRID_SPACE = /\b(?:gap|space-[xy]|[pm][xytblr]?)-(?:2\.5|5\.5)\b/;

describe("foundation v-next — type role tokens", () => {
  const css = readFileSync(GLOBALS, "utf8");

  it("defines the role tokens in globals.css", () => {
    for (const token of ["--fs-eyebrow", "--fs-micro", "--fs-meta", "--fs-label"]) {
      expect(css, `globals.css must define ${token}`).toContain(token);
    }
  });

  it("wires the role scale as Tailwind @theme utilities", () => {
    expect(css).toMatch(/@theme\b/);
    expect(css, "@theme must expose --text-eyebrow (→ text-eyebrow utility)").toContain("--text-eyebrow");
    expect(css).toContain("--text-label");
  });

  it("holds the two CSS defect fixes (no faux 650 weight, no orphan 17px)", () => {
    expect(css).not.toMatch(/font-weight:\s*650/);
    expect(css).not.toMatch(/font-size:\s*17px/);
  });
});

describe("foundation v-next — no off-scale arbitraries in components", () => {
  const files = walk(WEB_SRC);

  it("finds no `text-[Npx]` font-size arbitraries", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (OFF_SCALE_TEXT.test(line)) offenders.push(`${file.slice(WEB_SRC.length + 1)}:${i + 1}`);
      });
    }
    expect(offenders, `off-scale text sizes remain:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("finds no off-grid spacing half-steps (2.5 / 5.5)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (OFF_GRID_SPACE.test(line)) offenders.push(`${file.slice(WEB_SRC.length + 1)}:${i + 1}`);
      });
    }
    expect(offenders, `off-grid spacing remains:\n${offenders.join("\n")}`).toEqual([]);
  });
});
