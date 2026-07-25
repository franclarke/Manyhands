#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";

const exec = promisify(execFile);
const manifestPath = resolve(argument("--manifest") ?? "docs/tesis/evidence/warehouse/seed/seed-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const seed = resolve(argument("--seed") ?? manifest.repository);

await verifySeed(seed, manifest);
if (process.argv.includes("--verify-only")) {
  process.stdout.write(`seed verified: ${manifest.commit}\n`);
  process.exit(0);
}
if (!process.argv.includes("--prepare")) fail("use --verify-only or --prepare --out-root <directory>");

const outRoot = resolve(argument("--out-root") ?? fail("--out-root is required with --prepare"));
const names = (argument("--names") ?? "warehouse-control-tower-pilot,warehouse-control-tower-final").split(",");
await mkdir(outRoot, { recursive: true });
for (const name of names) {
  const destination = join(outRoot, name.trim());
  if (await exists(destination)) fail(`destination already exists: ${destination}`);
  await run("git", ["clone", "--no-hardlinks", seed, destination]);
  await git(destination, ["checkout", "--detach", manifest.commit]);
  process.stdout.write(`prepared ${destination} at ${manifest.commit}\n`);
}

async function verifySeed(repository, expected) {
  const head = (await git(repository, ["rev-parse", "HEAD"])).trim();
  const tree = (await git(repository, ["rev-parse", "HEAD^{tree}"])).trim();
  const dirty = (await git(repository, ["status", "--porcelain"])).trim();
  const files = (await git(repository, ["ls-tree", "-r", "--name-only", "HEAD"])).trim().split(/\r?\n/u).filter(Boolean).sort();
  const lockHash = createHash("sha256").update(await readFile(join(repository, "pnpm-lock.yaml"))).digest("hex");
  if (head !== expected.commit) fail(`seed commit ${head} != ${expected.commit}`);
  if (tree !== expected.tree) fail(`seed tree ${tree} != ${expected.tree}`);
  if (dirty !== "") fail(`seed is dirty: ${dirty.replaceAll("\n", " | ")}`);
  if (lockHash !== expected.lockfileSha256) fail(`seed lockfile hash ${lockHash} != ${expected.lockfileSha256}`);
  if (JSON.stringify(files) !== JSON.stringify([...expected.allowedSeedFiles].sort())) fail(`seed file list differs: ${files.join(", ")}`);
  if (files.some((file) => /(^|\/)(src|domain)(\/|$)|inventory|routing|orders?/iu.test(file))) fail("seed contains domain source paths");
}
function git(cwd, args) { return run("git", ["-C", cwd, ...args]).then((result) => result.stdout); }
function run(file, args) { return exec(file, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }); }
async function exists(path) { try { await access(path); return true; } catch { return false; } }
function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function fail(message) { throw new Error(message); }
