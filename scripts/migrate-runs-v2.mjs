#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write([
    "Usage: node scripts/migrate-runs-v2.mjs [--runs-dir PATH] [--apply --backup-dir PATH --approved-by ACTOR]",
    "",
    "The command is dry-run by default. Apply is fail-closed and never promotes V1 validation or delivery flags to V2 evidence.",
    ""
  ].join("\n"));
  process.exit(0);
}

const apply = args.includes("--apply");
const runsDirectory = path.resolve(valueOf("--runs-dir") ?? path.join(process.cwd(), ".manyhands", "runs"));
const backupDirectory = valueOf("--backup-dir");
const approvedBy = valueOf("--approved-by");
if (apply && (backupDirectory === undefined || approvedBy === undefined)) {
  throw new Error("--apply requires both --backup-dir and --approved-by.");
}

const modulePath = path.resolve(process.cwd(), "apps", "web", "src", "lib", "server", "runs", "v2", "migrate-run.ts");
const { migrateLegacyRunFile } = await import(pathToFileURL(modulePath).href);
const entries = (await readdir(runsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".snapshot.v2.json") && !entry.name.endsWith(".fence.v2.json"))
  .map((entry) => path.join(runsDirectory, entry.name))
  .sort();
const reports = [];
for (const filePath of entries) {
  reports.push(await migrateLegacyRunFile({
    filePath,
    apply,
    ...(backupDirectory !== undefined ? { backupDirectory } : {}),
    ...(approvedBy !== undefined ? { approvedBy } : {})
  }));
}
process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", runsDirectory, reports }, null, 2)}\n`);

function valueOf(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}
