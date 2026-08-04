import test from "node:test";
import assert from "node:assert/strict";
import { createWarehouse, placeOrder } from "../src/domain/orders.mjs";

test("reserves available inventory", () => {
  const next = placeOrder(createWarehouse({ sku: 3 }), { orderId: "o-1", skuId: "sku", quantity: 2 });
  assert.equal(next.stockBySku.sku, 1);
  assert.deepEqual(next.orders[0], { orderId: "o-1", skuId: "sku", quantity: 2, status: "reserved" });
});
