import { readFile } from "node:fs/promises";
import { FeatureRequestSchema, type FeatureRequest } from "@manyhands/decomposer";

export async function loadFeatureFixture(path: string): Promise<FeatureRequest> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return FeatureRequestSchema.parse(parsed);
}
