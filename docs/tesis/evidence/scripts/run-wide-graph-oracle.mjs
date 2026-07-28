#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { evaluateWideGraphOutput } from "./lib/wide-graph-oracle.mjs";
import {
  wideGraphCloneArgs,
  wideGraphOracleCommands
} from "./lib/wide-graph-oracle-plan.mjs";
import { runPnpm } from "../warehouse/oracles/oracle-core.mjs";

const exec = promisify(execFile);
const ORACLE_ID = "warehouse-wide-graph-v2";
const ORACLE_CONTRACT_VERSION = 2;
const sourceRepository = resolve(argument("--repository") ?? fail("--repository is required"));
const deliveredSha = argument("--delivered-sha") ?? fail("--delivered-sha is required");
if (!/^[0-9a-f]{40}$/u.test(deliveredSha)) fail("--delivered-sha must be a full lowercase Git SHA");
const moduleCount = Number(argument("--module-count") ?? fail("--module-count is required"));
if (!Number.isInteger(moduleCount) || moduleCount < 1) fail("--module-count must be a positive integer");
const target = await mkdtemp(join(tmpdir(), "manyhands-wide-oracle-"));
let verifiedSha;
const checks = [];

try {
  await run("git", wideGraphCloneArgs(sourceRepository, target), process.cwd(), 300_000);
  await run("git", ["checkout", "--detach", deliveredSha], target, 300_000);
  verifiedSha = (await run("git", ["rev-parse", "HEAD"], target, 30_000)).stdout.trim();
  if (verifiedSha !== deliveredSha) {
    throw new Error(`verification checkout resolved ${verifiedSha}; expected ${deliveredSha}`);
  }
  checks.push("checkout-delivered-sha");
  for (const command of wideGraphOracleCommands) {
    await runPnpm(command, target, command[0] === "install" ? 300_000 : 180_000);
    checks.push(command[0] === "install" ? "install-frozen-lockfile" : command[0]);
  }
  await verifyModuleBoundary(target, moduleCount);
  checks.push("module-boundary");
  const first = await probe(target);
  const second = await probe(target);
  const evaluation = evaluateWideGraphOutput(first, moduleCount);
  const failures = evaluation.failures;
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    failures.push("study:wide-graph output is not deterministic");
  }
  checks.push("deterministic-probe");
  if (evaluation.valuesCompared) checks.push("specimen-values");
  if (failures.length > 0) throw new Error(failures.join("\n"));
  await report({
    oracleId: ORACLE_ID,
    oracleContractVersion: ORACLE_CONTRACT_VERSION,
    sourceRepository,
    verifiedSha,
    moduleCount,
    outcome: "pass",
    checks
  });
} catch (error) {
  await report({
    oracleId: ORACLE_ID,
    oracleContractVersion: ORACLE_CONTRACT_VERSION,
    sourceRepository,
    verifiedSha,
    deliveredSha,
    moduleCount,
    outcome: "fail",
    checks,
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
} finally {
  await rm(target, { recursive: true, force: true });
}

async function verifyModuleBoundary(root, count) {
  const names = Array.from({ length: count }, (_, index) => `projection-${String(index + 1).padStart(2, "0")}`);
  const registry = await readFile(join(root, "src", "analytics", "registry.ts"), "utf8");
  for (const name of names) {
    const source = await readFile(join(root, "src", "analytics", `${name}.ts`), "utf8");
    const forbidden = names.filter((other) => other !== name && source.includes(other));
    if (forbidden.length > 0) throw new Error(`${name} imports a peer: ${forbidden.join(", ")}`);
    if (!registry.includes(name)) throw new Error(`registry does not consume ${name}`);
  }
}

async function probe(root) {
  const { stdout } = await runPnpm(["--silent", "study:wide-graph"], root, 120_000);
  try { return JSON.parse(stdout.trim()); }
  catch { throw new Error(`study:wide-graph did not emit one JSON object: ${stdout.slice(0, 300)}`); }
}

function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function fail(message) { throw new Error(message); }
function run(file, args, cwd, timeout) {
  return exec(file, args, {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
}

async function report(result) {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const output = argument("--out");
  if (output !== undefined) {
    const path = resolve(output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialized, "utf8");
  }
  process.stdout.write(serialized);
}
