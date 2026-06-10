import { Project } from "ts-morph";

const project = new Project({
  tsConfigFilePath: "apps/web/tsconfig.json",
});

const files = [
  "apps/web/src/lib/server/runs/runner.ts",
  "apps/web/src/lib/server/runs/planning-pipeline.ts",
  "apps/web/src/lib/server/runs/execution-pipeline.ts"
];

for (const path of files) {
  const sourceFile = project.getSourceFileOrThrow(path);
  sourceFile.fixUnusedIdentifiers();
  sourceFile.organizeImports();
  sourceFile.saveSync();
  console.log("Fixed", path);
}
