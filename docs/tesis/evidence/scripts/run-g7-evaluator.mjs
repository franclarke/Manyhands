#!/usr/bin/env node
/** External, task-frozen evaluator for the compact G7 Warehouse series. */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { evaluateG6Criteria, G6_CRITERION_IDS, G6_PROBE_COMMAND } from "./lib/g6-criteria.mjs";
import { runPnpm } from "../warehouse/oracles/oracle-core.mjs";

const exec = promisify(execFile);
const repository = resolve(argument("--repository") ?? fail("--repository is required"));
const deliveredSha = argument("--delivered-sha") ?? fail("--delivered-sha is required");
const baseSha = argument("--base-sha") ?? fail("--base-sha is required");
const taskId = argument("--task-id") ?? fail("--task-id is required");
const criteriaPath = resolve(argument("--criteria") ?? fail("--criteria is required"));
const outPath = resolve(argument("--out") ?? fail("--out is required"));
if (!/^[0-9a-f]{40}$/u.test(deliveredSha) || !/^[0-9a-f]{40}$/u.test(baseSha)) fail("commit arguments must be full lowercase Git SHAs");

const criteria = JSON.parse(await readFile(criteriaPath, "utf8"));
const expectedIds = criteria.criteria.map((entry) => entry.id);
const expectedT1 = G6_CRITERION_IDS;
if (taskId === "T1" && JSON.stringify(expectedIds) !== JSON.stringify(expectedT1)) fail("T1 criteria drifted from the frozen ten-criterion set");

const target = await mkdtemp(join(tmpdir(), "manyhands-g7-evaluator-"));
let verdict;
try {
  await git(["clone", "--no-hardlinks", "--no-local", repository, target], process.cwd());
  await git(["checkout", "--detach", deliveredSha], target);
  const verifiedSha = (await git(["rev-parse", "HEAD"], target)).stdout.trim();
  if (verifiedSha !== deliveredSha) throw new Error(`verified ${verifiedSha}, expected ${deliveredSha}`);
  const baselineTestFiles = (await git(["ls-tree", "-r", "--name-only", baseSha], target)).stdout.split("\n").filter((file) => file.endsWith(".test.ts"));
  const result = taskId === "T1"
    ? await evaluateT1(target, baselineTestFiles)
    : await evaluateT2(target);
  verdict = { schemaVersion: 1, taskId, repository, baseSha, deliveredSha, verifiedSha, ...result };
} finally {
  await rm(target, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
}
await writeFile(outPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
process.stdout.write(`${verdict.satisfied}/${verdict.total} criterios externos satisfechos -> ${outPath}\n`);

async function evaluateT1(target, baselineTestFiles) {
  return evaluateG6Criteria({
    treePath: target,
    baselineTestFiles,
    runCommand: async (command) => {
      try { await runPnpm(command, target, command[0] === "install" ? 600_000 : 300_000); return { exitCode: 0, stdout: "", stderr: "" }; }
      catch (error) { return { exitCode: 1, stdout: "", stderr: String(error.message ?? error) }; }
    },
    runProbe: async () => {
      try { const result = await runPnpm(G6_PROBE_COMMAND, target, 120_000); return { exitCode: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }; }
      catch (error) { return { exitCode: 1, stdout: "", stderr: String(error.message ?? error) }; }
    }
  });
}

async function evaluateT2(target) {
  const criteria = [];
  const commands = [
    ["install", "--frozen-lockfile"],
    ["test"],
    ["typecheck"],
    ["build"]
  ];
  for (const command of commands) {
    const id = `gate-${command[0]}`;
    try { await runPnpm(command, target, command[0] === "install" ? 600_000 : 300_000); criteria.push({ id, satisfied: true, detail: `${command.join(" ")} exit 0` }); }
    catch (error) { criteria.push({ id, satisfied: false, detail: `${command.join(" ")} failed: ${tail(error.message ?? error)}` }); }
  }
  const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  const commandSurface = typeof manifest.scripts?.["study:stock-summary"] === "string" && !/^node\s+(-e|--eval)\b.*console\.log/u.test(manifest.scripts["study:stock-summary"].trim());
  criteria.push({ id: "command-surface", satisfied: commandSurface, detail: commandSurface ? "study:stock-summary is a real script" : "study:stock-summary is missing or inline" });
  const first = await runSummary(target);
  const second = await runSummary(target);
  const shape = first.ok && isSummary(first.value);
  criteria.push({ id: "summary-shape", satisfied: shape, detail: shape ? "summary shape valid" : `invalid summary: ${tail(first.error ?? first.stdout)}` });
  const values = shape && first.value.schemaVersion === 1 && first.value.scenario === "thesis-seed-2026" && first.value.totalUnits === 170 && first.value.occupiedBins === 8 && first.value.skuCount === 5 && first.value.topSku?.skuId === "SKU-1004" && first.value.topSku?.units === 43;
  criteria.push({ id: "summary-derived-values", satisfied: values, detail: values ? "summary matches the frozen scenario" : `unexpected values: ${JSON.stringify(first.value)}` });
  const deterministic = shape && second.ok && first.stdout === second.stdout;
  criteria.push({ id: "summary-deterministic", satisfied: deterministic, detail: deterministic ? "two invocations are byte-identical" : "summary invocations differ or failed" });
  return { total: criteria.length, satisfied: criteria.filter((entry) => entry.satisfied).length, criteria };
}

async function runSummary(target) {
  try { const result = await runPnpm(["--silent", "study:stock-summary"], target, 120_000); const stdout = result.stdout ?? ""; return { ok: true, stdout, value: JSON.parse(stdout.trim()) }; }
  catch (error) { return { ok: false, stdout: "", error: String(error.message ?? error) }; }
}

function isSummary(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && value.schemaVersion === 1 && value.scenario === "thesis-seed-2026"
    && Number.isInteger(value.totalUnits) && Number.isInteger(value.occupiedBins)
    && Number.isInteger(value.skuCount) && value.topSku !== null && typeof value.topSku === "object"
    && typeof value.topSku.skuId === "string" && Number.isInteger(value.topSku.units);
}

function git(args, cwd) { return exec("git", args, { cwd, timeout: 600_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }); }
function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function tail(value) { return String(value ?? "").replace(/\s+/gu, " ").trim().slice(-300); }
function fail(message) { process.stderr.write(`ERROR: ${message}\n`); process.exit(2); }
