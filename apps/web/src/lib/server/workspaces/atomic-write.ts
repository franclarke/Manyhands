import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tempPath, payload, { encoding: "utf8" });
  await rename(tempPath, filePath);
}
