#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";

const exec = promisify(execFile);
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const increment = args.get("--increment");
const repository = args.get("--repository");
const deliveredSha = args.get("--delivered-sha");
const output = args.get("--out");
if (!increment || !repository || !deliveredSha || !output) throw new Error("usage: --increment WC1|WC2|WC3 --repository path --delivered-sha sha --out file");

const checks = [];
async function command(label, file, commandArgs) {
  try {
    const result = await exec(file, commandArgs, { cwd: repository, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    checks.push({ id: label, outcome: "pass", stdout: result.stdout.trim() });
    return result.stdout;
  } catch (error) {
    checks.push({ id: label, outcome: "fail", error: error instanceof Error ? error.message : String(error) });
    return "";
  }
}

const actualSha = (await command("exact-commit", "git", ["-c", "safe.directory=*", "rev-parse", "HEAD"])).trim();
if (actualSha !== deliveredSha) checks.push({ id: "candidate-attribution", outcome: "fail", error: `HEAD ${actualSha} differs from delivered ${deliveredSha}` });
else checks.push({ id: "candidate-attribution", outcome: "pass" });
await command("tests", "pnpm", ["test"]);
await command("typecheck", "pnpm", ["typecheck"]);
await command("build", "pnpm", ["build"]);
const probe = await command("deterministic-probe", "pnpm", [`study:${increment.toLowerCase()}-probe`]);
try {
  const parsed = JSON.parse(probe.trim().split(/\r?\n/).at(-1) ?? "");
  if (parsed.increment !== increment) throw new Error(`probe increment is ${parsed.increment}`);
  checks.push({ id: "probe-contract", outcome: "pass", value: parsed });
} catch (error) {
  checks.push({ id: "probe-contract", outcome: "fail", error: error instanceof Error ? error.message : String(error) });
}

const result = {
  schemaVersion: 1,
  oracleId: "warehouse-compact-v1",
  increment,
  deliveredSha,
  outcome: checks.every((check) => check.outcome === "pass") ? "pass" : "fail",
  checks,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (result.outcome !== "pass") process.exitCode = 1;
