import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(css: string, source: string): Promise<{ cssPath: string; sourcePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "manyhands-token-check-"));
  temporaryDirectories.push(directory);
  const cssPath = join(directory, "globals.css");
  const sourcePath = join(directory, "surface.tsx");
  await Promise.all([writeFile(cssPath, css), writeFile(sourcePath, source)]);
  return { cssPath, sourcePath };
}

function runTokenCheck(cssPath: string, sourcePath: string): string {
  return execFileSync(process.execPath, ["scripts/token-check.mjs", "--css", cssPath, "--source", sourcePath], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function tokenCheckError(cssPath: string, sourcePath: string): string {
  try {
    runTokenCheck(cssPath, sourcePath);
  } catch (error) {
    const failure = error as { stderr?: string | Buffer };
    return failure.stderr === undefined ? String(error) : failure.stderr.toString();
  }
  throw new Error("Expected the token checker to fail.");
}

describe("token-check", () => {
  it("accepts custom properties declared by the theme", async () => {
    const { cssPath, sourcePath } = await fixture(":root { --color-text: #111; }", "const color = 'var(--color-text)';");

    expect(runTokenCheck(cssPath, sourcePath)).toContain("Token check passed");
  });

  it("reports every custom property that has no declaration", async () => {
    const { cssPath, sourcePath } = await fixture(":root { --color-text: #111; }", "const color = 'var(--color-danger) var(--color-text)';");

    expect(tokenCheckError(cssPath, sourcePath)).toContain("--color-danger");
  });
});
