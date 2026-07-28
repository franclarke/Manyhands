import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { metricsFor } from "../docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("wide graph oracle checkout", () => {
  it("verifies an external clone at the delivered SHA and records that SHA", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mh-wide-oracle-checkout-"));
    temporaryRoots.push(root);
    const repository = path.join(root, "source");
    const receipt = path.join(root, "oracle-result.json");
    await createPassingRepository(repository);
    const deliveredSha = await git(repository, ["rev-parse", "HEAD"]);

    await writeFile(
      path.join(repository, "study.mjs"),
      "throw new Error('the source repository HEAD must not be verified');\n",
      "utf8"
    );
    await git(repository, ["add", "study.mjs"]);
    await git(repository, ["commit", "-m", "make source head fail"]);

    await execFileAsync(
      process.execPath,
      [
        "docs/tesis/evidence/scripts/run-wide-graph-oracle.mjs",
        "--repository",
        repository,
        "--delivered-sha",
        deliveredSha,
        "--module-count",
        "4",
        "--out",
        receipt
      ],
      { cwd: process.cwd(), windowsHide: true, timeout: 30_000 }
    );

    const result = JSON.parse(await readFile(receipt, "utf8"));
    expect(result).toMatchObject({
      oracleId: "warehouse-wide-graph-v2",
      oracleContractVersion: 2,
      sourceRepository: path.resolve(repository),
      verifiedSha: deliveredSha,
      outcome: "pass",
      checks: [
        "checkout-delivered-sha",
        "install-frozen-lockfile",
        "test",
        "typecheck",
        "build",
        "module-boundary",
        "deterministic-probe",
        "specimen-values"
      ]
    });
  });
});

async function createPassingRepository(repository: string) {
  await mkdir(path.join(repository, "src", "analytics"), { recursive: true });
  const report = {
    schemaVersion: 1,
    moduleCount: 4,
    scenario: "thesis-seed-2026",
    projections: metricsFor(4).map((metric) => ({
      projectionId: metric.id,
      value: metric.expected
    }))
  };
  await writeFile(
    path.join(repository, "package.json"),
    `${JSON.stringify({
      name: "wide-oracle-fixture",
      version: "1.0.0",
      scripts: {
        test: "node -e \"process.exit(0)\"",
        typecheck: "node -e \"process.exit(0)\"",
        build: "node -e \"process.exit(0)\"",
        "study:wide-graph": "node study.mjs"
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(repository, "pnpm-lock.yaml"),
    "lockfileVersion: 5.4\n\nspecifiers: {}\n\ndependencies: {}\n",
    "utf8"
  );
  await writeFile(
    path.join(repository, "study.mjs"),
    `process.stdout.write(${JSON.stringify(`${JSON.stringify(report)}\n`)});\n`,
    "utf8"
  );
  for (let index = 1; index <= 4; index += 1) {
    const name = `projection-${String(index).padStart(2, "0")}`;
    await writeFile(
      path.join(repository, "src", "analytics", `${name}.ts`),
      `export const id = ${JSON.stringify(name)};\n`,
      "utf8"
    );
  }
  await writeFile(
    path.join(repository, "src", "analytics", "registry.ts"),
    `${Array.from({ length: 4 }, (_, index) =>
      `import "./projection-${String(index + 1).padStart(2, "0")}";`
    ).join("\n")}\n`,
    "utf8"
  );
  await git(repository, ["init"]);
  await git(repository, ["config", "user.email", "oracle@example.test"]);
  await git(repository, ["config", "user.name", "Oracle Test"]);
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "passing delivery"]);
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
