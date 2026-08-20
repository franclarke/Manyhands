#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_ATTEMPT_ROOT = "C:\\mh-exp\\viaje-familia";

export async function createViajeEnFamiliaAttempt({
  attempt,
  baseDirectory = DEFAULT_ATTEMPT_ROOT
}) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 999) {
    throw new TypeError("attempt must be an integer between 1 and 999");
  }

  const base = path.resolve(baseDirectory);
  if (path.parse(base).root === base) {
    throw new Error("attempt base must not be a filesystem root");
  }

  const label = String(attempt).padStart(3, "0");
  const attemptDirectory = path.resolve(base, `attempt-${label}`);
  const expectedPrefix = `${base}${path.sep}`;
  if (!attemptDirectory.startsWith(expectedPrefix)) {
    throw new Error("resolved attempt directory escaped the configured base");
  }

  await assertMissing(attemptDirectory);

  const repoDirectory = path.join(attemptDirectory, "repo");
  const daemonStateDirectory = path.join(attemptDirectory, "daemon-state");
  await Promise.all([
    mkdir(path.join(repoDirectory, "test"), { recursive: true }),
    mkdir(daemonStateDirectory, { recursive: true })
  ]);

  const files = scaffoldFiles();
  await Promise.all(
    Object.entries(files).map(([relativePath, contents]) =>
      writeFile(path.join(repoDirectory, relativePath), contents, { encoding: "utf8", flag: "wx" })
    )
  );

  return Object.freeze({
    attempt,
    label,
    attemptDirectory,
    repoDirectory,
    daemonStateDirectory,
    workspaceName: `Viaje Familia A${label}`,
    files: Object.keys(files).sort()
  });
}

function scaffoldFiles() {
  return {
    ".gitignore": "node_modules/\ncoverage/\n*.log\n.DS_Store\n",
    "README.md": [
      "# Viaje en Familia",
      "",
      "Scaffold técnico funcionalmente vacío para el experimento final de ManyHands.",
      "La funcionalidad de producto debe ser creada por el run.",
      ""
    ].join("\n"),
    "package.json": `${JSON.stringify({
      name: "viaje-en-familia",
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        start: "node server.mjs",
        test: "node --test"
      },
      engines: { node: ">=22.13" }
    }, null, 2)}\n`,
    "server.mjs": STATIC_SERVER,
    "test/baseline.test.mjs": BASELINE_TEST
  };
}

async function assertMissing(target) {
  try {
    await access(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`attempt directory already exists: ${target}`);
}

function parseAttempt(argv) {
  if (argv.length !== 1 || !/^\d{1,3}$/u.test(argv[0])) {
    throw new Error("Usage: node scripts/experiments/create-viaje-en-familia-attempt.mjs <1-999>");
  }
  return Number(argv[0]);
}

const STATIC_SERVER = `import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const publicRoot = path.resolve("public");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\\/+/, "");
    const candidate = path.resolve(publicRoot, relative);
    if (candidate !== publicRoot && !candidate.startsWith(publicRoot + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(candidate);
    if (!info.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(candidate)] ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    createReadStream(candidate).pipe(response);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error?.code === "ENOENT" ? "Not found" : "Internal server error");
  }
}).listen(port, host, () => {
  console.log(\`Viaje en Familia available at http://\${host}:\${port}\`);
});
`;

const BASELINE_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("the functional scaffold keeps the required native commands", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.scripts.test, "node --test");
  assert.equal(manifest.scripts.start, "node server.mjs");
});
`;

const isMain = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = await createViajeEnFamiliaAttempt({ attempt: parseAttempt(process.argv.slice(2)) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
