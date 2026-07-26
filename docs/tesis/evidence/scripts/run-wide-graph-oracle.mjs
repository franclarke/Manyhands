#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkWideGraphOutput } from "./lib/wide-graph-oracle.mjs";
import { runPnpm } from "../warehouse/oracles/oracle-core.mjs";

const target = resolve(argument("--target") ?? fail("--target is required"));
const moduleCount = Number(argument("--module-count") ?? fail("--module-count is required"));
if (!Number.isInteger(moduleCount) || moduleCount < 1) fail("--module-count must be a positive integer");

try {
  await runPnpm(["test"], target, 180_000);
  await runPnpm(["typecheck"], target, 180_000);
  await runPnpm(["build"], target, 180_000);
  await verifyModuleBoundary(target, moduleCount);
  const first = await probe(target);
  const second = await probe(target);
  const failures = checkWideGraphOutput(first, moduleCount);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    failures.push("study:wide-graph output is not deterministic");
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  process.stdout.write(`${JSON.stringify({
    oracleId: "warehouse-wide-graph-v1",
    target,
    moduleCount,
    outcome: "pass",
    checks: ["test", "typecheck", "build", "module-boundary", "deterministic-probe"]
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
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
