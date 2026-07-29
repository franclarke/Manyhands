import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFrozenWideGraphOracleContract,
  assertWideGraphOracleAttribution,
  assertWideGraphOracleSeriesContract,
  loadWideGraphOracleContract
} from "../docs/tesis/evidence/scripts/lib/wide-graph-oracle-contract.mjs";
import { metricsFor } from "../docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("frozen wide graph oracle contract", () => {
  it("pins identity, evaluator bytes and criterion mappings", async () => {
    const contract = await loadWideGraphOracleContract(process.cwd());

    expect(contract).toMatchObject({
      schemaVersion: 1,
      oracleId: "warehouse-wide-graph-v2",
      oracleContractVersion: 2,
      evaluator: {
        path: "docs/tesis/evidence/scripts/lib/wide-graph-oracle.mjs",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
      },
      runner: {
        path: "docs/tesis/evidence/scripts/run-wide-graph-oracle.mjs",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
      },
      dependencies: expect.arrayContaining([
        expect.objectContaining({
          path: "docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
        }),
        expect.objectContaining({
          path: "docs/tesis/evidence/warehouse/oracles/oracle-core.mjs",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
        })
      ]),
      criterionMappings: expect.arrayContaining([
        expect.objectContaining({ criterionId: "projection-values", checks: ["specimen-values"] }),
        expect.objectContaining({ criterionId: "projection-order", checks: ["projection-order"] })
      ]),
      contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    await expect(assertFrozenWideGraphOracleContract(contract, process.cwd())).resolves.toEqual(contract);
  });

  it("rejects a missing criterion and evaluator drift", async () => {
    const contract = await loadWideGraphOracleContract(process.cwd());
    const withoutOrder = {
      ...contract,
      criterionMappings: contract.criterionMappings.filter(
        (mapping: { criterionId: string }) => mapping.criterionId !== "projection-order"
      )
    };
    const changedEvaluator = {
      ...contract,
      evaluator: { ...contract.evaluator, sha256: "0".repeat(64) }
    };
    const unversionedExtension = { ...contract, strongerCheck: true };
    const changedDependency = {
      ...contract,
      dependencies: contract.dependencies.map((dependency: { path: string; sha256: string }, index: number) =>
        index === 0 ? { ...dependency, sha256: "1".repeat(64) } : dependency
      )
    };

    await expect(assertFrozenWideGraphOracleContract(withoutOrder, process.cwd()))
      .rejects.toThrow(/projection-order/iu);
    await expect(assertFrozenWideGraphOracleContract(changedEvaluator, process.cwd()))
      .rejects.toThrow(/evaluator hash mismatch/iu);
    await expect(assertFrozenWideGraphOracleContract(unversionedExtension, process.cwd()))
      .rejects.toThrow(/unversioned fields/iu);
    await expect(assertFrozenWideGraphOracleContract(changedDependency, process.cwd()))
      .rejects.toThrow(/dependency hash mismatch/iu);
  });

  it("invalidates attribution when identity, contract hash or candidate SHA changes", async () => {
    const contract = await loadWideGraphOracleContract(process.cwd());
    const candidateSha = "a".repeat(40);
    const receipt = {
      oracleId: contract.oracleId,
      oracleContractVersion: contract.oracleContractVersion,
      oracleContractSha256: contract.contractSha256,
      oracleEvaluatorSha256: contract.evaluator.sha256,
      verifiedSha: candidateSha,
      outcome: "pass",
      checks: contract.criterionMappings.flatMap((mapping: { checks: string[] }) => mapping.checks)
    };

    expect(() => assertWideGraphOracleAttribution(contract, receipt, candidateSha)).not.toThrow();
    for (const drifted of [
      { ...receipt, oracleId: "warehouse-wide-graph-v3" },
      { ...receipt, oracleContractVersion: 3 },
      { ...receipt, oracleContractSha256: "b".repeat(64) },
      { ...receipt, oracleEvaluatorSha256: "c".repeat(64) },
      { ...receipt, verifiedSha: "d".repeat(40) },
      { ...receipt, checks: receipt.checks.filter((check: string) => check !== "specimen-values") }
    ]) {
      expect(() => assertWideGraphOracleAttribution(contract, drifted, candidateSha))
        .toThrow(/oracle attribution mismatch/iu);
    }
  });

  it("rejects a cell whose oracle contract differs from its series manifest", async () => {
    const contract = await loadWideGraphOracleContract(process.cwd());
    await expect(assertWideGraphOracleSeriesContract({
      schemaVersion: 2,
      protocol: { id: "warehouse-wide-graph", version: 2 },
      oracleContract: contract
    }, [{
      schemaVersion: 2,
      protocol: { id: "warehouse-wide-graph", version: 2 },
      cellId: "warehouse-wide-n04",
      oracleContract: { ...contract, oracleContractVersion: 3 }
    }], process.cwd())).rejects.toThrow(/warehouse-wide-n04.+differs/iu);
  });

  it("rejects a cell without the frozen contract before contacting the server", async () => {
    const root = await mkdtemp(join(tmpdir(), "mh-wide-oracle-preflight-"));
    temporaryRoots.push(root);
    const configPath = join(root, "cell.json");
    await writeFile(configPath, JSON.stringify({
      schemaVersion: 2,
      protocol: { id: "warehouse-wide-graph", version: 2 },
      cellId: "renamed-wide-cell",
      condition: "C",
      taskId: "wide-graph-n04",
      baseUrl: "http://127.0.0.1:1"
    }), "utf8");

    await expect(execFileAsync(process.execPath, [
      "docs/tesis/evidence/scripts/run-experiment.mjs",
      "--config",
      configPath,
      "--out",
      join(root, "out")
    ], {
      cwd: process.cwd(),
      env: { ...process.env, MANYHANDS_SESSION_TOKEN: "test-token" },
      windowsHide: true,
      timeout: 10_000
    })).rejects.toMatchObject({
      stderr: expect.stringMatching(/frozen external oracle contract is required/iu)
    });
  });

  it("runs one attributable oracle before delivery and reuses its receipt after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "mh-wide-oracle-delivery-"));
    temporaryRoots.push(root);
    const repository = join(root, "target");
    const output = join(root, "out");
    const configPath = join(root, "cell.json");
    await createPassingRepository(repository);
    const candidateSha = await git(repository, ["rev-parse", "HEAD"]);
    const oracleContract = await loadWideGraphOracleContract(process.cwd());
    let delivered = false;
    let completedSha = candidateSha;
    let oracleExistedAtDelivery = false;
    const server = createServer(async (request, response) => {
      const url = request.url ?? "";
      if (request.method === "GET" && url === "/api/workspaces") {
        return json(response, { workspaces: [{ id: "workspace-1", repoPath: repository }] });
      }
      if (request.method === "POST" && url === "/api/runs") {
        return json(response, { runId: "run-1" });
      }
      if (request.method === "GET" && url === "/api/runs/run-1/deliver") {
        return json(response, delivered ? {
          lifecycle: "completed",
          receipt: { finalSha: completedSha }
        } : {
          lifecycle: "result_ready",
          candidate: {
            commit: candidateSha,
            manifestId: "manifest-1",
            targetBranch: "main",
            targetHead: candidateSha,
            sourceTargetFingerprint: "target@candidate"
          }
        });
      }
      if (request.method === "POST" && url === "/api/runs/run-1/deliver") {
        oracleExistedAtDelivery = existsSync(join(output, "oracle-result.json"));
        delivered = true;
        return json(response, { ok: true });
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind a TCP port");
      await writeFile(configPath, JSON.stringify({
        schemaVersion: 2,
        protocol: { id: "warehouse-wide-graph", version: 2 },
        cellId: "renamed-wide-cell",
        condition: "C",
        moduleCount: 4,
        baseUrl: `http://127.0.0.1:${address.port}`,
        targetRepo: repository,
        baseSha: candidateSha,
        runsDir: join(root, "runs"),
        pollIntervalMs: 1,
        oracleContract
      }), "utf8");

      const runDriver = (extraArgs: string[] = []) => execFileAsync(process.execPath, [
        "docs/tesis/evidence/scripts/run-experiment.mjs",
        "--config",
        configPath,
        "--out",
        output,
        ...extraArgs
      ], {
        cwd: process.cwd(),
        env: { ...process.env, MANYHANDS_SESSION_TOKEN: "test-token" },
        windowsHide: true,
        timeout: 30_000
      });
      await runDriver();
      expect(oracleExistedAtDelivery).toBe(true);
      const firstModified = (await stat(join(output, "oracle-result.json"))).mtimeMs;
      const originalReceipt = await readFile(join(output, "oracle-result.json"), "utf8");

      delivered = false;
      oracleExistedAtDelivery = false;
      await runDriver(["--attach", "run-1"]);

      expect(oracleExistedAtDelivery).toBe(true);
      expect((await stat(join(output, "oracle-result.json"))).mtimeMs).toBe(firstModified);

      const driftedReceipt = JSON.parse(await readFile(join(output, "oracle-result.json"), "utf8"));
      driftedReceipt.oracleContractVersion += 1;
      await writeFile(join(output, "oracle-result.json"), `${JSON.stringify(driftedReceipt, null, 2)}\n`, "utf8");
      delivered = false;
      oracleExistedAtDelivery = false;

      await expect(runDriver(["--attach", "run-1"])).rejects.toMatchObject({ code: 1 });
      expect(oracleExistedAtDelivery).toBe(false);

      await writeFile(join(output, "oracle-result.json"), originalReceipt, "utf8");
      delivered = false;
      completedSha = "b".repeat(40);
      oracleExistedAtDelivery = false;

      await expect(runDriver(["--attach", "run-1"])).rejects.toMatchObject({ code: 1 });
      expect(oracleExistedAtDelivery).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 45_000);
});

async function createPassingRepository(repository: string) {
  await mkdir(join(repository, "src", "analytics"), { recursive: true });
  const report = {
    schemaVersion: 1,
    moduleCount: 4,
    scenario: "thesis-seed-2026",
    projections: metricsFor(4).map((metric) => ({ projectionId: metric.id, value: metric.expected }))
  };
  await writeFile(join(repository, "package.json"), `${JSON.stringify({
    name: "wide-oracle-driver-fixture",
    version: "1.0.0",
    scripts: {
      test: "node -e \"process.exit(0)\"",
      typecheck: "node -e \"process.exit(0)\"",
      build: "node -e \"process.exit(0)\"",
      "study:wide-graph": "node study.mjs"
    }
  }, null, 2)}\n`, "utf8");
  await writeFile(join(repository, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n\nspecifiers: {}\n\ndependencies: {}\n", "utf8");
  await writeFile(join(repository, "study.mjs"), `process.stdout.write(${JSON.stringify(`${JSON.stringify(report)}\n`)});\n`, "utf8");
  for (let index = 1; index <= 4; index += 1) {
    const name = `projection-${String(index).padStart(2, "0")}`;
    await writeFile(join(repository, "src", "analytics", `${name}.ts`), `export const id = ${JSON.stringify(name)};\n`, "utf8");
  }
  await writeFile(
    join(repository, "src", "analytics", "registry.ts"),
    `${Array.from({ length: 4 }, (_, index) => `import "./projection-${String(index + 1).padStart(2, "0")}";`).join("\n")}\n`,
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

function json(response: import("node:http").ServerResponse, body: unknown) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
