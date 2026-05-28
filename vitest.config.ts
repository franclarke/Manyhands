import path from "node:path";
import { defineConfig } from "vitest/config";

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@manyhands/shared": path.resolve(root, "packages/shared/src/index.ts"),
      "@manyhands/scope-validation": path.resolve(root, "packages/scope-validation/src/index.ts"),
      "@manyhands/decomposer": path.resolve(root, "packages/decomposer/src/index.ts"),
      "@manyhands/contracts": path.resolve(root, "packages/contracts/src/index.ts"),
      "@manyhands/task-graph": path.resolve(root, "packages/task-graph/src/index.ts"),
      "@manyhands/conflict-risk": path.resolve(root, "packages/conflict-risk/src/index.ts"),
      "@manyhands/scheduler": path.resolve(root, "packages/scheduler/src/index.ts"),
      "@manyhands/repository-index": path.resolve(root, "packages/repository-index/src/index.ts"),
      "@manyhands/run-store": path.resolve(root, "packages/run-store/src/index.ts"),
      "@manyhands/trace-store": path.resolve(root, "packages/trace-store/src/index.ts"),
      "@manyhands/worktree-runner": path.resolve(root, "packages/worktree-runner/src/index.ts"),
      "@manyhands/core": path.resolve(root, "packages/core/src/index.ts"),
      "@manyhands/evaluator": path.resolve(root, "packages/evaluator/src/index.ts"),
      "@manyhands/execution-core": path.resolve(root, "packages/execution-core/src/index.ts"),
      "@/": `${path.resolve(root, "apps/web/src")}/`
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
