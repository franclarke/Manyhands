import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const archiveRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(archiveRoot, "..", "..", "..", "..");
const manifest = JSON.parse(await readFile(path.join(archiveRoot, "manifest.json"), "utf8"));

const failures = [];
for (const entry of manifest.entries) {
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
