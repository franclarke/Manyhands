import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARCHIVE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(ARCHIVE_ROOT, "..", "..", "..", "..");
const MANIFEST_PATH = path.join(ARCHIVE_ROOT, "manifest.json");

const externalEntries = [
  {
    archivedPath: "docs/tesis/assets/viaje-en-familia/manyhands-execution-flow.png",
    originalSource: "C:/mh-exp/viaje-familia-evidence/attempt-004/screenshots/manyhands-ui/06-execution-flow.png",
    classification: "prior-attempt-ui",
  },
  {
    archivedPath: "docs/tesis/assets/viaje-en-familia/manyhands-recovery-retained-work.png",
    originalSource: "C:/mh-exp/viaje-familia-evidence/attempt-006/manyhands-ui-recovery-hidden.png",
    classification: "prior-attempt-ui",
  },
  {
    archivedPath: "docs/tesis/assets/viaje-en-familia/manyhands-config-before-start.png",
    originalSource: "C:/mh-exp/viaje-familia-evidence/attempt-009/manyhands-ui-a009-config-before-start.png",
    classification: "prior-attempt-ui",
  },
  {
    archivedPath: "docs/tesis/assets/viaje-en-familia/viaje-final-dashboard-full.png",
    originalSource: "workspace/output/playwright/viaje-final-dashboard-full.png",
    classification: "post-hoc-product-ui",
  },
  {
    archivedPath: "docs/tesis/assets/viaje-en-familia/viaje-final-dashboard-viewport.png",
    originalSource: "workspace/output/playwright/viaje-final-dashboard-viewport.png",
    classification: "post-hoc-product-ui",
  },
  {
    archivedPath: "docs/tesis/assets/viaje-en-familia/viaje-final-dashboard-mobile.png",
    originalSource: "workspace/output/playwright/viaje-final-dashboard-mobile.png",
    classification: "post-hoc-product-ui",
  },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolutePath));
    } else if (
      entry.isFile()
      && absolutePath !== MANIFEST_PATH
      && !absolutePath.endsWith(".tmp.tar")
    ) {
      files.push(absolutePath);
    }
  }
  return files;
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function metadataFor(relativePath) {
  if (relativePath.startsWith("prior-attempts/")) {
    return {
      classification: "prior-attempt-compact-evidence",
      originalSource: `C:/mh-exp/viaje-familia-evidence/${relativePath.slice("prior-attempts/".length)}`,
    };
  }
  const intermediate = relativePath.match(/^intermediate-runs\/(attempt-\d{3})\/(.*)$/);
  if (intermediate) {
    const [, attempt, remainder] = intermediate;
    if (remainder.startsWith("candidate-artifacts/")) {
      return {
        classification: "intermediate-candidate-artifact",
        originalSource: `C:/mh-exp/${remainder.slice("candidate-artifacts/".length)}`,
      };
    }
    if (remainder.startsWith("host-logs/")) {
      return {
        classification: "intermediate-host-log",
        originalSource: `C:/mh-exp/viaje-familia/${attempt}/${remainder.slice("host-logs/".length)}`,
      };
    }
    return {
      classification: "intermediate-run-curated-state",
      originalSource: `C:/mh-exp/viaje-familia/${attempt}/daemon-state/${remainder}`,
    };
  }
  if (relativePath.startsWith("final-run/state/")) {
    return {
      classification: "final-run-curated-state",
      originalSource: `C:/mh-exp/viaje-familia/attempt-012/daemon-state/${relativePath.slice("final-run/state/".length)}`,
    };
  }
  if (relativePath.startsWith("candidate-source/")) {
    return {
      classification: "exact-candidate-source-export",
      originalSource: "git archive 62a0d3571f9a03e670eaca7560f11915a6d4c9d7",
    };
  }
  if (relativePath === "git/viaje-en-familia-final.bundle") {
    return {
      classification: "exact-candidate-git-bundle",
      originalSource: "C:/mh-exp/viaje-familia/attempt-012/repo (git bundle --all)",
    };
  }
  if (relativePath.startsWith("browser-post-hoc/")) {
    return {
      classification: "post-hoc-browser-observation",
      originalSource: `workspace/.playwright-mcp/${relativePath.slice("browser-post-hoc/".length)}`,
    };
  }
  return {
    classification: "archive-documentation",
    originalSource: "archive-generated",
  };
}

async function describe(absolutePath, archivedPath, metadata) {
  const bytes = await readFile(absolutePath);
  const fileStat = await stat(absolutePath);
  return {
    archivedPath,
    originalSource: metadata.originalSource,
    bytes: fileStat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    classification: metadata.classification,
    redactions: [],
  };
}

const internalFiles = await walk(ARCHIVE_ROOT);
const internalEntries = await Promise.all(internalFiles.map(async (absolutePath) => {
  const relativePath = slash(path.relative(ARCHIVE_ROOT, absolutePath));
  return describe(
    absolutePath,
    `docs/tesis/evidence/viaje-en-familia/${relativePath}`,
    metadataFor(relativePath),
  );
}));

const describedExternalEntries = await Promise.all(externalEntries.map((entry) => describe(
  path.join(PROJECT_ROOT, ...entry.archivedPath.split("/")),
  entry.archivedPath,
  entry,
)));

const entries = [...internalEntries, ...describedExternalEntries]
  .sort((left, right) => left.archivedPath.localeCompare(right.archivedPath));

const manifest = {
  schemaVersion: 1,
  archiveDate: "2026-08-23",
  repository: "https://github.com/franclarke/Manyhands",
  candidate: {
    runId: "run:1572bf91950318003847e64a15e39bac091472e5c115c06fcb9f961487eb3ae0",
    commit: "62a0d3571f9a03e670eaca7560f11915a6d4c9d7",
    tree: "58dd2f7648eb2c0fef7d6950cb71dce741d49022",
    evidenceMatrix: "matrix-da779f2d70dfd21c",
  },
  exclusions: [
    "**/credential-broker/**",
    "**/installation/ipc-capability",
    "**/processes/**/request.bin",
    "**/auth.json",
    "Codex homes, sessions, caches, databases, leases, guards and sandboxes",
  ],
  entries,
};

await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${entries.length} entries to ${MANIFEST_PATH}`);
