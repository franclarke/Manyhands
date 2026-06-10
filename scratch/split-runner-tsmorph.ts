import { Project, SyntaxKind } from "ts-morph";

const project = new Project({
  tsConfigFilePath: "apps/web/tsconfig.json",
});

const runnerPath = "apps/web/src/lib/server/runs/runner.ts";
const runner = project.getSourceFileOrThrow(runnerPath);

// Ensure shared functions are exported so they can be imported
const sharedFunctions = ["transitionTo", "waitWhilePaused", "requireExecutableWorkspace", "publishEvent", "sleep"];
for (const fnName of sharedFunctions) {
  const fn = runner.getFunction(fnName);
  if (fn && !fn.isExported()) {
    fn.setIsExported(true);
  }
}

// Ensure ExecutionEngine and its input types are exported from runner.ts
const sharedTypes = ["ExecutionEngineInput", "ExecutionEngine", "ExecutionRunnerOptions", "PlanningRunnerOptions", "NodeReviewAction"];
for (const typeName of sharedTypes) {
  const typeAlias = runner.getTypeAlias(typeName);
  if (typeAlias && !typeAlias.isExported()) {
    typeAlias.setIsExported(true);
  }
  const iface = runner.getInterface(typeName);
  if (iface && !iface.isExported()) {
    iface.setIsExported(true);
  }
}

const planningPipeline = project.createSourceFile("apps/web/src/lib/server/runs/planning-pipeline.ts", "", { overwrite: true });
const executionPipeline = project.createSourceFile("apps/web/src/lib/server/runs/execution-pipeline.ts", "", { overwrite: true });

const planningFunctions = [
  "buildFeatureRequestFromPrompt",
  "resolveDecompositionMode",
  "runPlanningPipeline",
  "runPromptOnlyPlanning",
  "buildGroundingDigest",
  "describePlanningFailure"
];

for (const name of planningFunctions) {
  const fn = runner.getFunction(name);
  if (fn) {
    planningPipeline.addFunction(fn.getStructure());
    fn.remove();
  }
}

const executionFunctions = [
  "runExecutionPipeline",
  "resumeExecutionPipeline",
  "runNodeExecutionPipeline",
  "assertManualNodeExecutionReady",
  "settleExecutionOutcome",
  "derivePredictedConflicts",
  "hasProjectableConflictSnapshotInput",
  "hasProjectablePlanningShape",
  "asPlainRecord",
  "isPlainRecord",
  "publishFoundationEvents",
  "publishRunModelEventsFromExecutionResult",
  "consumedRevisionRefs",
  "producedRevisionRef",
  "leafFailureCause",
  "testsFor",
  "metricsFromVector",
  "reviewNode",
  "describeExecutionFailure"
];

for (const name of executionFunctions) {
  const fn = runner.getFunction(name);
  if (fn) {
    executionPipeline.addFunction(fn.getStructure());
    fn.remove();
  }
}

// Add imports
planningPipeline.fixMissingImports();
executionPipeline.fixMissingImports();
runner.fixMissingImports();

project.saveSync();
console.log("Successfully split runner.ts");
