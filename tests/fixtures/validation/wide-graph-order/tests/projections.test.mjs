import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

test("projection order matches the frozen expected sequence", async () => {
  const expected = await readJson("../expected.json");
  const candidate = await readJson("../retry-2-candidate.json");

  assert.deepEqual(candidate.projectionIds, expected.projectionIds);
});
