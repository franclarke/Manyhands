/**
 * Executable benchmark fixtures a run can target for real execution (repoSpec).
 * These are runnable repos under `benchmarks/`, distinct from decomposition
 * scenario manifests (mock-v0 / conflict-v0), which are NOT executable repos.
 * Kept as a typed constant (no runtime fs scan); extend as fixtures are added.
 */
export interface ExecutableFixture {
  id: string;
  label: string;
  description: string;
}

export const EXECUTABLE_FIXTURES: ReadonlyArray<ExecutableFixture> = [
  {
    id: "task-manager-api",
    label: "Task Manager API",
    description: "Express REST API with PUT/DELETE stubs to complete."
  }
];
