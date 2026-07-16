import { access, writeFile } from "node:fs/promises";
import { JsonWorkspaceRepository } from "@/lib/server/workspaces/repository";

async function main(): Promise<void> {
  const [filePath, id, name, gatePath] = process.argv.slice(2);
  if (filePath === undefined || id === undefined || name === undefined || gatePath === undefined) {
    throw new Error("workspace-store-child requires filePath, id, name and gatePath");
  }
  await writeFile(`${gatePath}.${id}.ready`, String(process.pid), "utf8");
  while (!await exists(gatePath)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const repository = new JsonWorkspaceRepository({
    filePath,
    seeds: [],
    idFactory: () => id
  });
  await repository.create({ name });
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
