import test from "node:test";
import assert from "node:assert/strict";
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
