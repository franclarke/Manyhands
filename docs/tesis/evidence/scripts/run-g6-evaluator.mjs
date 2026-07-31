#!/usr/bin/env node
/**
 * Evaluador externo de G6.
 *
 * Clona el SHA entregado en un directorio limpio, corre los gates del
 * repositorio, importa la superficie declarada por la tarea y ejercita sus
 * capacidades, y escribe un veredicto por criterio.
 *
 * Es **externo e idéntico para las tres condiciones**: los criterios están
 * congelados en `criteria-t1.json` y no se compilan por unidad de trabajo, que
 * es el defecto que invalidó la métrica primaria de G5.
 *
 *   node docs/tesis/evidence/scripts/run-g6-evaluator.mjs \
 *     --repository <targetRepo> --delivered-sha <sha> --base-sha <sha> \
 *     --criteria docs/tesis/evidence/g6/criteria-t1.json \
 *     --out <verdict.json>
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { evaluateG6Criteria, G6_CRITERION_IDS } from "./lib/g6-criteria.mjs";
import { wideGraphCloneArgs } from "./lib/wide-graph-oracle-plan.mjs";
import { runPnpm } from "../warehouse/oracles/oracle-core.mjs";

const exec = promisify(execFile);
const sourceRepository = resolve(argument("--repository") ?? fail("--repository is required"));
const deliveredSha = argument("--delivered-sha") ?? fail("--delivered-sha is required");
const baseSha = argument("--base-sha") ?? fail("--base-sha is required");
const criteriaPath = resolve(argument("--criteria") ?? fail("--criteria is required"));
const outPath = resolve(argument("--out") ?? fail("--out is required"));
if (!/^[0-9a-f]{40}$/u.test(deliveredSha)) fail("--delivered-sha must be a full lowercase Git SHA");
if (!/^[0-9a-f]{40}$/u.test(baseSha)) fail("--base-sha must be a full lowercase Git SHA");

const criteria = JSON.parse(await readFile(criteriaPath, "utf8"));
assertFrozenCriteria(criteria);

const target = await mkdtemp(join(tmpdir(), "manyhands-g6-evaluator-"));
let verdict;
try {
  await git(wideGraphCloneArgs(sourceRepository, target), process.cwd());
  await git(["checkout", "--detach", deliveredSha], target);
  const verifiedSha = (await git(["rev-parse", "HEAD"], target)).stdout.trim();
  if (verifiedSha !== deliveredSha) {
    throw new Error(`verification checkout resolved ${verifiedSha}; expected ${deliveredSha}`);
  }

  // La lista de tests del baseline sale del commit base del propio clon, no de
  // una lista escrita a mano que podría quedar desactualizada.
  const baselineTestFiles = (await git(["ls-tree", "-r", "--name-only", baseSha], target)).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".test.ts"));

  verdict = await evaluateG6Criteria({
    treePath: target,
    baselineTestFiles,
    runCommand: async (command) => {
      try {
        await runPnpm(command, target, command[0] === "install" ? 600_000 : 300_000);
        return { exitCode: 0, stdout: "", stderr: "" };
      } catch (error) {
        return { exitCode: 1, stdout: "", stderr: String(error.message ?? error) };
      }
    },
    runProbe: async () => {
      try {
        const result = await runPnpm(["study:g6-probe"], target, 120_000);
        return { exitCode: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      } catch (error) {
        return { exitCode: 1, stdout: "", stderr: String(error.message ?? error) };
      }
    }
  });

  verdict = {
    schemaVersion: 1,
    taskId: criteria.taskId,
    repository: sourceRepository,
    baseSha,
    deliveredSha,
    verifiedSha,
    baselineTestFileCount: baselineTestFiles.length,
    ...verdict
  };
} finally {
  await rm(target, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
}

await writeFile(outPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
process.stdout.write(`${verdict.satisfied}/${verdict.total} criterios externos satisfechos -> ${outPath}\n`);

/** El evaluador se niega a correr contra una lista de criterios que no es la congelada. */
function assertFrozenCriteria(loaded) {
  const ids = (loaded.criteria ?? []).map((entry) => entry.id);
  if (JSON.stringify(ids) !== JSON.stringify(G6_CRITERION_IDS)) {
    fail(`criteria file declares ${JSON.stringify(ids)}; the frozen set is ${JSON.stringify(G6_CRITERION_IDS)}`);
  }
}

function git(args, cwd) {
  return exec("git", args, { cwd, timeout: 300_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(2);
}
