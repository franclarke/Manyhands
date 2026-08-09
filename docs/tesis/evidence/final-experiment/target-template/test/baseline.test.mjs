import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWarehouse, placeOrder } from "../src/domain/orders.mjs";

// The baseline behaviour this test defends is that available inventory is
// reserved and the order is recorded as such. It asserts those facts by name
// rather than by deep-equality on the whole order: an exhaustive shape check
// would fail for any added field, which would make "preserve existing
// behavior" and "add order priority" contradictory instructions and decide the
// run before the plan was ever written.
test("reserves available inventory", () => {
  const next = placeOrder(createWarehouse({ sku: 3 }), { orderId: "o-1", skuId: "sku", quantity: 2 });
  assert.equal(next.stockBySku.sku, 1);
  assert.equal(next.orders.length, 1);
  assert.equal(next.orders[0].orderId, "o-1");
  assert.equal(next.orders[0].skuId, "sku");
  assert.equal(next.orders[0].quantity, 2);
  assert.equal(next.orders[0].status, "reserved");
});

// The root integration obligation executes this baseline entry point. Keep it
// sensitive to tests authored in nested directories: the negative control
// materializes those tests on the baseline commit, so importing them here must
// fail when they exercise behavior absent from the baseline.
async function testFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await testFiles(fullPath));
    else if (/\.test\.mjs$/u.test(entry.name) && entry.name !== "baseline.test.mjs") files.push(fullPath);
  }
  return files;
}

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
for (const file of await testFiles(testDirectory)) await import(pathToFileURL(file).href);
