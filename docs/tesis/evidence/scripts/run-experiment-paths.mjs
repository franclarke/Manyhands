import { join } from "node:path";

export function resolveRunsDir(config, environmentRunsDir) {
  if (typeof environmentRunsDir === "string" && environmentRunsDir.length > 0) {
    return environmentRunsDir;
  }
  if (typeof config.runsDir === "string" && config.runsDir.length > 0) {
    return config.runsDir;
  }
  return join(process.cwd(), ".manyhands", "runs");
}
