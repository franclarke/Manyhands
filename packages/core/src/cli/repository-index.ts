import path from "node:path";
import {
  buildRepositoryIndex,
  summarizeRepositoryIndex
} from "@manyhands/repository-index";

const defaultRepositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repositoryPath = path.resolve(readOption(args, "--repository") ?? defaultRepositoryPath);
  const index = await buildRepositoryIndex({
    rootPath: repositoryPath,
    repositoryId: "aprobado-lite"
  });
  const summary = summarizeRepositoryIndex(index);

  console.log("ManyHands repository index");
  console.log("--------------------------");
  console.log(`Repository: ${summary.repositoryId}`);
  console.log(`Root: ${repositoryPath}`);
  console.log(`Files indexed: ${summary.fileCount}`);
  console.log(`Source files: ${summary.sourceFileCount}`);
  console.log(`Test files: ${summary.testFileCount}`);
  console.log(`Config files: ${summary.configFileCount}`);
  console.log(`Schema files: ${summary.schemaFileCount}`);
  console.log(`Symbols indexed: ${summary.symbolCount}`);
  console.log(`Imports indexed: ${summary.importCount}`);
  console.log(`Exports indexed: ${summary.exportCount}`);
  console.log(`Index hash: ${summary.indexHash}`);
}

function readOption(args: readonly string[], name: string): string | undefined {
  const optionIndex = args.indexOf(name);

  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
