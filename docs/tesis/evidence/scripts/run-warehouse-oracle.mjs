#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";

const exec = promisify(execFile);
const increment = argument("--increment") ?? fail("--increment is required");
const target = resolve(argument("--target") ?? fail("--target is required"));
const oracleDir = resolve(`docs/tesis/evidence/warehouse/oracles/${increment}`);
const manifest = JSON.parse(await readFile(join(oracleDir, "oracle.json"), "utf8"));
const script = join(oracleDir, "oracle.mjs");
const core = resolve("docs/tesis/evidence/warehouse/oracles/oracle-core.mjs");
const specimen = resolve("docs/tesis/evidence/warehouse/oracles/probe-specimen.mjs");
await verifyHash(script, manifest.scriptSha256);
await verifyHash(core, manifest.coreSha256);
// The specimen defines the contract the core enforces; leaving it unpinned would
// let the acceptance rules change without any hash moving.
await verifyHash(specimen, manifest.specimenSha256);

const pnpm = "pnpm";
const startedAt = new Date().toISOString();
let result;
try {
  await exec(pnpm, ["install", "--frozen-lockfile"], { cwd: target, timeout: 300_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const { stdout } = await exec(process.execPath, [script, "--target", target], {
    cwd: process.cwd(), timeout: manifest.timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024
  });
  result = { ...JSON.parse(stdout), startedAt, finishedAt: new Date().toISOString() };
} catch (error) {
  result = { oracleId: manifest.id, increment, target, outcome: "fail", startedAt, finishedAt: new Date().toISOString(), error: String(error.stderr ?? error.message) };
}
if (argument("--out") !== undefined) {
  const output = resolve(argument("--out"));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.outcome === "pass" ? 0 : 1);

async function verifyHash(path, expected) {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== expected) fail(`oracle asset hash mismatch for ${path}: ${actual} != ${expected}`);
}
function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function fail(message) { throw new Error(message); }
