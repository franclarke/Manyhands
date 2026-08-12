import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  FastRepositoryIndexer,
  INDEXER_PROFILE,
  fastIndexCachePath
} from "../packages/repository-index/src/fast-indexer";
import { buildFastRepositorySnapshot } from "../packages/repository-index/src/index";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];
const performanceIt =
  process.env.MANYHANDS_PERF_GATE === "1" && process.platform === "win32"
    ? it
    : it.skip;

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FastRepositoryIndexer", () => {
  performanceIt("keeps cold-cache p95 below 750ms on the supported Windows workstation", async () => {
    const root = await createRepository();
    await writeFile(path.join(root, ".gitignore"), "ignored/\n", "utf8");
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "ignored"), { recursive: true });
    const candidateSourcePaths = Array.from(
      { length: 300 },
      (_, index) => `src/module-${index}.ts`
    );
    await Promise.all(
      candidateSourcePaths.map((relativePath, index) =>
        writeFile(
          path.join(root, relativePath),
          `export const symbol${index} = ${index};\n`,
          "utf8"
        )
      )
    );
    await writeFile(path.join(root, "ignored", "secret.ts"), "export const secret = true;\n", "utf8");
    await commitAll(root, "large fixture");

    const headSha = await git(root, ["rev-parse", "HEAD"]);
    const cachePath = fastIndexCachePath(root, headSha);
    const indexer = new FastRepositoryIndexer({
      openExactView: async ({ repositoryRoot }) => ({
        sourceRoot: repositoryRoot,
        candidateSourcePaths,
        dispose: async () => undefined
      })
    });
    const samples: Array<{ elapsedMs: number; timings: unknown }> = [];
    for (let sample = 0; sample < 20; sample += 1) {
      await rm(cachePath, { force: true });
      const startedAt = performance.now();
      const receipt = await indexer.indexWithReceipt({
        rootPath: root,
        baseCommit: headSha
      });
      samples.push({
        elapsedMs: performance.now() - startedAt,
        timings: receipt.timings
      });
      expect(receipt.cacheHit).toBe(false);
      expect(receipt.index.files).toHaveLength(300);
      expect(receipt.index.files.some((file) => file.path.includes("ignored"))).toBe(false);
      expect(receipt.index.files[0]?.exportedSymbols).toEqual(["symbol0"]);
    }
    const ordered = [...samples].sort((left, right) => left.elapsedMs - right.elapsedMs);
    const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1]!;

    const fastest = ordered[0]!;
    const slowest = ordered.at(-1)!;
    const evidence =
      `cold-cache elapsed ms: p95=${p95.elapsedMs.toFixed(2)}, min=${fastest.elapsedMs.toFixed(2)}, max=${slowest.elapsedMs.toFixed(2)}; p95 timings=${JSON.stringify(p95.timings)}`;
    console.info(evidence);
    expect(p95.elapsedMs, evidence).toBeLessThan(750);
  });

  it("uses rg --files with hidden and gitignore semantics", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "ignored"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "ignored/\n", "utf8");
    await writeFile(path.join(root, "src", "visible.ts"), "export const visible = true;\n", "utf8");
    await writeFile(path.join(root, "ignored", "secret.ts"), "export const secret = true;\n", "utf8");
    const headSha = await commitAll(root, "ignore fixture");
    const result = await new FastRepositoryIndexer({
      openExactView: async ({ repositoryRoot }) => ({
        sourceRoot: repositoryRoot,
        candidateSourcePaths: ["src/visible.ts", "ignored/secret.ts"],
        dispose: async () => undefined
      })
    }).index({
      rootPath: root,
      baseCommit: headSha
    });

    expect(result.files.map((file) => file.path)).toEqual(["src/visible.ts"]);
  });

  it("reuses the HEAD-addressed cache without invoking rg again", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    const sourcePath = path.join(root, "src", "api.ts");
    await writeFile(
      sourcePath,
      [
        "export interface Booking { id: string }",
        "export async function createBooking(): Promise<void> {}",
        "export { createBooking as book };"
      ].join("\n"),
      "utf8"
    );
    const headSha = await commitAll(root, "initial");
    const first = await new FastRepositoryIndexer().indexWithReceipt({
      rootPath: root,
      baseCommit: headSha
    });
    let rgInvocations = 0;
    const cachedIndexer = new FastRepositoryIndexer({
      runRg: async () => {
        rgInvocations += 1;
        throw new Error("cache lookup must not invoke rg");
      }
    });

    await writeFile(sourcePath, "export const uncommittedChange = true;\n", "utf8");
    const second = await cachedIndexer.indexWithReceipt({ rootPath: root, baseCommit: headSha });

    expect(rgInvocations).toBe(0);
    expect(second.cacheHit).toBe(true);
    expect(second.index.files).toEqual(first.index.files);
    expect(second.index.files[0]?.exportedSymbols).toEqual(["Booking", "book", "createBooking"]);
    expect(
      JSON.parse(await readFile(fastIndexCachePath(root, headSha), "utf8"))
    ).toMatchObject({
      schemaVersion: 2,
      baseCommit: headSha,
      // The envelope records the profile the indexer is *running*. Pinning its
      // literal value here would make every legitimate bump fail this test,
      // which is exactly the discouragement the invalidation mechanism cannot
      // afford: the profile is the only lever that expires a payload whose
      // deriving code changed.
      indexerProfile: INDEXER_PROFILE,
      index: { files: first.index.files }
    });
  });

  performanceIt("keeps warm-cache p95 below 25ms on the supported Windows workstation", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "api.ts"), "export const api = true;\n", "utf8");
    const headSha = await commitAll(root, "warm-cache performance fixture");
    const indexer = new FastRepositoryIndexer();
    await indexer.indexWithReceipt({ rootPath: root, baseCommit: headSha });

    const samples: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const receipt = await indexer.indexWithReceipt({ rootPath: root, baseCommit: headSha });
      expect(receipt.cacheHit).toBe(true);
      samples.push(receipt.timings.totalMs);
    }
    const ordered = [...samples].sort((left, right) => left - right);
    const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1]!;

    expect(p95, `warm-cache p95=${p95.toFixed(2)}ms; samples=${ordered.map((value) => value.toFixed(2)).join(",")}`)
      .toBeLessThan(25);
  });

  it("builds one coherent exact-commit index when the working tree is dirty", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "committed.ts"), "export const committed = true;\n", "utf8");
    const headSha = await commitAll(root, "committed source");

    await writeFile(path.join(root, "src", "committed.ts"), "export const dirty = true;\n", "utf8");
    await writeFile(path.join(root, "src", "phantom.ts"), "export const phantom = true;\n", "utf8");

    const result = await new FastRepositoryIndexer().indexWithReceipt({
      rootPath: root,
      baseCommit: headSha
    });

    expect(result.index.files.map((file) => file.path)).toEqual(["src/committed.ts"]);
    expect(result.index.files[0]?.exportedSymbols).toEqual(["committed"]);
    expect(result.index.files[0]).toMatchObject({
      byteSize: Buffer.byteLength("export const committed = true;\n", "utf8"),
      lineCount: 2
    });
  });

  it("uses ignore rules from the exact commit instead of dirty workspace rules", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "\n", "utf8");
    await writeFile(path.join(root, "src", "committed.ts"), "export const committed = true;\n", "utf8");
    const headSha = await commitAll(root, "committed ignore rules");
    await writeFile(path.join(root, ".gitignore"), "src/\n", "utf8");

    const index = await new FastRepositoryIndexer().index({
      rootPath: root,
      baseCommit: headSha
    });

    expect(index.files.map((file) => file.path)).toEqual(["src/committed.ts"]);
  });

  it("discovers snapshot capabilities from the exact commit instead of the dirty workspace", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "api.ts"), "export const api = true;\n", "utf8");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.0.0",
        scripts: { test: "vitest run --committed" },
        devDependencies: { vitest: "3.0.0" }
      }),
      "utf8"
    );
    const headSha = await commitAll(root, "committed capabilities");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        packageManager: "npm@11.0.0",
        scripts: { test: "echo dirty", build: "echo dirty" },
        dependencies: { react: "99.0.0" }
      }),
      "utf8"
    );

    const snapshot = await buildFastRepositorySnapshot({
      rootPath: root,
      targetFingerprint: "sha256:test-target",
      baseCommit: headSha
    });

    expect(snapshot.capabilities.packageManager).toEqual({
      name: "pnpm",
      version: "10.0.0",
      evidence: "package.json#packageManager"
    });
    expect(snapshot.capabilities.scripts).toEqual({ test: "vitest run --committed" });
    expect(snapshot.capabilities.stack.map((signal) => signal.name)).toEqual(["vitest"]);
  });

  it("extracts multiline and aliased exports with the canonical AST parser", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "api.ts"),
      [
        "const internal = 1;",
        "const other = 2;",
        "export {",
        "  internal as publicValue,",
        "  other",
        "};",
        "export default function createApi() {}",
        "export * as models from './models.js';",
        "export const first = 1, second = 2;",
        "export const third = 3; export const fourth = 4;"
      ].join("\n"),
      "utf8"
    );
    const headSha = await commitAll(root, "multiline exports");

    const index = await new FastRepositoryIndexer().index({ rootPath: root, baseCommit: headSha });

    expect(index.files[0]?.exportedSymbols).toEqual([
      "createApi",
      "first",
      "fourth",
      "models",
      "other",
      "publicValue",
      "second",
      "third"
    ]);
  });

  it("indexes every parseable source extension, including the module variants", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "src", "plain.ts"), "export const plain = 1;\n", "utf8"),
      writeFile(path.join(root, "src", "component.tsx"), "export const Component = () => null;\n", "utf8"),
      writeFile(path.join(root, "src", "legacy.js"), "export const legacy = 1;\n", "utf8"),
      writeFile(path.join(root, "src", "widget.jsx"), "export const widget = 1;\n", "utf8"),
      writeFile(path.join(root, "src", "esm.mjs"), "export const esm = 1;\n", "utf8"),
      writeFile(path.join(root, "src", "common.cjs"), "module.exports = { common: 1 };\n", "utf8"),
      writeFile(path.join(root, "src", "typed.mts"), "export const typed = 1;\n", "utf8"),
      writeFile(path.join(root, "src", "script.cts"), "export const script = 1;\n", "utf8"),
      writeFile(path.join(root, "src", "excluded.json"), "{}\n", "utf8"),
      writeFile(path.join(root, "src", "excluded.md"), "# no\n", "utf8")
    ]);
    const headSha = await commitAll(root, "source extensions");

    const index = await new FastRepositoryIndexer().index({ rootPath: root, baseCommit: headSha });

    // An all-`.mjs` repository used to index as empty, so its planner received
    // no path evidence at all. Data files stay out: this indexer parses source.
    expect(index.files.map((file) => file.path)).toEqual([
      "src/common.cjs",
      "src/component.tsx",
      "src/esm.mjs",
      "src/legacy.js",
      "src/plain.ts",
      "src/script.cts",
      "src/typed.mts",
      "src/widget.jsx"
    ]);
  });

  it("publishes one valid cache under concurrent cold writers and removes temporaries", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "api.ts"), "export const api = true;\n", "utf8");
    const headSha = await commitAll(root, "cache race");

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        new FastRepositoryIndexer().indexWithReceipt({ rootPath: root, baseCommit: headSha })
      )
    );
    const cachePath = fastIndexCachePath(root, headSha);
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as {
      payloadChecksum: string;
      index: unknown;
    };
    const cacheEntries = await readdir(path.dirname(cachePath));

    expect(new Set(results.map((result) => JSON.stringify(result.index))).size).toBe(1);
    expect(cache.payloadChecksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(cache.index).toBeDefined();
    expect(cacheEntries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("rebuilds a cache whose checksum is invalid", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "api.ts"), "export const api = true;\n", "utf8");
    const headSha = await commitAll(root, "corrupt cache");
    const indexer = new FastRepositoryIndexer();
    await indexer.index({ rootPath: root, baseCommit: headSha });
    const cachePath = fastIndexCachePath(root, headSha);
    const corrupt = JSON.parse(await readFile(cachePath, "utf8")) as Record<string, unknown>;
    corrupt.payloadChecksum = `sha256:${"0".repeat(64)}`;
    await writeFile(cachePath, JSON.stringify(corrupt), "utf8");

    const rebuilt = await indexer.indexWithReceipt({ rootPath: root, baseCommit: headSha });

    expect(rebuilt.cacheHit).toBe(false);
    expect(rebuilt.index.files[0]?.exportedSymbols).toEqual(["api"]);
  });

  /**
   * The profile is the only thing that expires a cached payload whose deriving
   * code changed — the envelope is otherwise keyed by commit, and the checksum
   * covers the payload, not the code that produced it. D11's fix was invisible
   * on the real smoke-01 target until its profile was bumped, so this guards
   * the mechanism that made the bump work.
   */
  it("rebuilds a cache written under a different indexer profile", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "api.ts"), "export const api = true;\n", "utf8");
    const headSha = await commitAll(root, "profile fixture");
    const indexer = new FastRepositoryIndexer();
    await indexer.index({ rootPath: root, baseCommit: headSha });
    const cachePath = fastIndexCachePath(root, headSha);
    const stale = JSON.parse(await readFile(cachePath, "utf8")) as Record<string, unknown>;
    stale.indexerProfile = "some-earlier-profile";
    await writeFile(cachePath, JSON.stringify(stale), "utf8");

    const rebuilt = await indexer.indexWithReceipt({ rootPath: root, baseCommit: headSha });

    expect(rebuilt.cacheHit).toBe(false);
    expect(JSON.parse(await readFile(cachePath, "utf8")).indexerProfile).toBe(INDEXER_PROFILE);
  });

  /**
   * D11 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`, through
   * the path production actually uses.
   *
   * The fixture-level regression in `repository-snapshot.test.ts` runs
   * `RepositorySnapshotBuilder`; runs go through `buildFastRepositorySnapshot`,
   * which reaches the same derivation via the indexer's cached capability
   * result. Covering only the former left the productive answer unasserted —
   * and the cache is keyed by commit, not by the deriving code, so a stale
   * entry can outlive a fix to it.
   */
  it("derives baseline commands for a lockfile-less target on the productive snapshot path", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "lockfile-less-target",
      private: true,
      type: "module",
      scripts: { test: "node --test test/*.test.mjs" }
    }), "utf8");
    await writeFile(path.join(root, "src.mjs"), "export const orders = [];\n", "utf8");
    const headSha = await commitAll(root, "target");

    const snapshot = await buildFastRepositorySnapshot({
      rootPath: root,
      repositoryId: "lockfile-less-target",
      targetFingerprint: "target-fingerprint",
      baseCommit: headSha
    });

    expect(snapshot.capabilities.packageManager).toBeUndefined();
    expect(snapshot.capabilities.baselineCommands).toEqual([
      { kind: "test", command: "npm", args: ["test"], sourceScript: "test" }
    ]);
  });
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-fast-index-"));
  tempRoots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "tests@manyhands.local"]);
  await git(root, ["config", "user.name", "ManyHands Tests"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  return stdout.trim();
}
