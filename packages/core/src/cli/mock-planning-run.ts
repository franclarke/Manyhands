import path from "node:path";
import { runMockPlanningFlow } from "../mock-planning-flow";

const fixturePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");

async function main(): Promise<void> {
  const result = await runMockPlanningFlow({
    fixturePath,
    mode: "balanced",
    maxParallel: 3
  });

  const { summary } = result;

  console.log("ManyHands deterministic mock planning run");
  console.log("------------------------------------------");
  console.log(`Run: ${summary.runId}`);
  console.log(`Feature: ${summary.featureId}`);
  console.log(`Mode: ${summary.mode}`);
  console.log(`Tasks: ${summary.taskCount} total, ${summary.leafCount} leaves`);
  console.log(`Contracts: ${summary.contractCount}`);
  console.log(`Dependencies: ${summary.dependencyCount}`);
  console.log(`Risk predictions: ${summary.riskPredictionCount}`);
  console.log(`Batches: ${summary.batchCount}`);

  for (const batch of summary.batches) {
    console.log(`- ${batch.id}: ${batch.taskIds.join(", ")}`);
  }

  console.log(`Trace events: ${summary.traceEventCount}`);

  if (summary.validationIssues.length > 0) {
    console.log("Validation issues:");

    for (const issue of summary.validationIssues) {
      console.log(`- ${issue}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
