#!/usr/bin/env node
/**
 * Executes the pre-registered G5 cells in order.
 *
 * Runs one cell at a time — the cells share a single target repository and a
 * single worktree pool, so concurrency would let one cell's baseline reset
 * corrupt another's evidence. Between cells the target is returned to the
 * frozen baseline under guards strict enough that the reset cannot discard
 * anything but ManyHands' own delivered commits (see `resetToBaseline`).
 *
 * A failed cell does NOT stop the series: a failure is data the protocol asks
 * for, and skipping the remaining cells would bias the sample toward whatever
 * happened to succeed early.
 *
 * Usage:
 *   node run-g5.mjs --cells <dir> --out <dir> [--from <position>] [--only <cellId>]
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

const cellsDir = resolve(argOf("--cells") ?? "docs/tesis/evidence/experiment/cells");
const outRoot = resolve(argOf("--out") ?? "docs/tesis/evidence/experiment/runs");
const from = Number(argOf("--from") ?? 1);
const only = argOf("--only");
await mkdir(outRoot, { recursive: true });

const cells = [];
for (const name of (await readdir(cellsDir)).filter((file) => file.endsWith(".json") && file !== "manifest.json")) {
  cells.push(JSON.parse(await readFile(join(cellsDir, name), "utf8")));
}
cells.sort((left, right) => left.position - right.position);

const selected = cells.filter((cell) =>
  (only === undefined || cell.cellId === only) && cell.position >= from);
log(`series: ${selected.length} of ${cells.length} cells`);

const ledger = [];
for (const cell of selected) {
  log(`=== cell ${cell.position}/12 ${cell.cellId} (${cell.taskId}, condition ${cell.condition})`);
  try {
    await resetToBaseline(cell);
  } catch (error) {
    log(`  SKIPPED: cannot restore the baseline safely -- ${error.message}`);
    ledger.push({ cellId: cell.cellId, position: cell.position, outcome: "skipped", reason: error.message });
    continue;
  }
  const cellOut = join(outRoot, cell.cellId);
  const started = new Date().toISOString();
  const code = await drive(join(cellsDir, `${cell.cellId}.json`), cellOut);
  ledger.push({
    cellId: cell.cellId,
    position: cell.position,
    taskId: cell.taskId,
    condition: cell.condition,
    repetition: cell.repetition,
    outcome: code === 0 ? "completed" : "not_delivered",
    exitCode: code,
    startedAt: started,
    finishedAt: new Date().toISOString()
  });
  await writeFile(join(outRoot, "series-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  log(`  cell ${cell.cellId} -> ${code === 0 ? "delivered" : "not delivered"}`);
}

log(`series finished: ${ledger.filter((entry) => entry.outcome === "completed").length}/${ledger.length} delivered`);

function drive(configPath, cellOut) {
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      [join(here, "run-experiment.mjs"), "--config", configPath, "--out", cellOut],
      { env: process.env, maxBuffer: 64 * 1024 * 1024 },
      () => undefined
    );
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => done(code ?? 1));
  });
}

/**
 * Returns the target to the frozen baseline.
 *
 * `git reset --hard` is destructive, so it runs only after proving it can
 * destroy nothing but ManyHands' own output:
 *
 *  1. the repository is the one the cell names;
 *  2. the baseline commit is an ancestor of HEAD, so the commits being dropped
 *     were all created after it;
 *  3. every commit being dropped was authored by a ManyHands run (its message
 *     carries the run marker) -- a hand-written commit aborts the reset;
 *  4. the working tree holds nothing but ManyHands' own runtime directory.
 *
 * If any check fails the cell is skipped rather than forced.
 */
async function resetToBaseline(cell) {
  const repo = cell.targetRepo;
  const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
  if (head === cell.baseSha) {
    await assertOnlyRuntimeDirt(repo);
    return;
  }
  const toplevel = (await git(repo, ["rev-parse", "--show-toplevel"])).trim();
  if (normalize(toplevel) !== normalize(repo)) {
    throw new Error(`${repo} is not a repository root (${toplevel})`);
  }
  await exec("git", ["-C", repo, "merge-base", "--is-ancestor", cell.baseSha, head])
    .catch(() => { throw new Error(`${cell.baseSha} is not an ancestor of HEAD ${head}`); });

  const dropped = (await git(repo, ["log", "--format=%H %s", `${cell.baseSha}..${head}`]))
    .split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const foreign = dropped.filter((line) => !/\bmh(-v2)?(-repair|-code-repair)?:|^\S+ Integrate /u.test(line));
  if (foreign.length > 0) {
    throw new Error(`refusing to drop commits not produced by a run: ${foreign.join(" | ")}`);
  }
  await assertOnlyRuntimeDirt(repo);
  await git(repo, ["reset", "--hard", cell.baseSha]);
  log(`  target reset to ${cell.baseSha.slice(0, 7)} (dropped ${dropped.length} run commits)`);
}

async function assertOnlyRuntimeDirt(repo) {
  const dirt = (await git(repo, ["status", "--porcelain"]))
    .split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
    .filter((line) => !line.endsWith(".manyhands/"));
  if (dirt.length > 0) throw new Error(`target has uncommitted work: ${dirt.join(" | ")}`);
}

function git(repo, argv) {
  return exec("git", ["-C", repo, ...argv], { maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout);
}

function normalize(value) {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}

function argOf(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function log(message) { process.stdout.write(`[${new Date().toISOString()}] ${message}\n`); }
