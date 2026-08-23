import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const archiveRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(archiveRoot, "..", "..", "..", "..");
const manifest = JSON.parse(await readFile(path.join(archiveRoot, "manifest.json"), "utf8"));
const trackedFiles = new Set(
  execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "-z",
      "--",
      "docs/tesis/assets/viaje-en-familia",
      "docs/tesis/evidence/viaje-en-familia"
    ],
    { cwd: projectRoot, encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean)
);

const failures = [];
for (const entry of manifest.entries) {
  if (!trackedFiles.has(entry.archivedPath)) {
    failures.push(`${entry.archivedPath} (not tracked by Git)`);
    continue;
  }

  const absolutePath = path.join(projectRoot, ...entry.archivedPath.split("/"));
  try {
    const fileStat = await stat(absolutePath);
    const bytes = await readFile(absolutePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (fileStat.size !== entry.bytes || sha256 !== entry.sha256) {
      failures.push(entry.archivedPath);
    }
  } catch {
    failures.push(entry.archivedPath);
  }
}

if (failures.length > 0) {
  console.error(`Manifest verification failed for ${failures.length} files:`);
  failures.forEach((file) => console.error(`- ${file}`));
  process.exitCode = 1;
} else {
  console.log(`Verified ${manifest.entries.length} archived files.`);
}
