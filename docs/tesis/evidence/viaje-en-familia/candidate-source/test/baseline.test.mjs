import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("the functional scaffold keeps the required native commands", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.scripts.test, "node --test");
  assert.equal(manifest.scripts.start, "node server.mjs");
});
