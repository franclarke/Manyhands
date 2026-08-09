import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const domain = await import(pathToFileURL(`${process.cwd()}/src/domain/orders.mjs`).href);
const { createWarehouse, placeOrder, cancelOrder } = domain;

const task = process.argv[process.argv.indexOf("--task") + 1];
if (task === "M") await evaluateMultiLayer();
else if (task === "S") await evaluateCohesive();
else throw new Error("usage: node evaluator.mjs --task M|S");

async function evaluateMultiLayer() {
  const { createOrderService } = await import(pathToFileURL(`${process.cwd()}/src/application/order-service.mjs`).href);
  const { createWarehouseApi } = await import(pathToFileURL(`${process.cwd()}/src/api/warehouse-api.mjs`).href);
  const api = createWarehouseApi(createOrderService(createWarehouse({ sku: 1 })));
  api.placeOrder({ orderId: "express-backorder", skuId: "sku", quantity: 3, priority: "express" });
  assert.deepEqual(api.currentBackorders(), [{ orderId: "express-backorder", skuId: "sku", missing: 2 }]);
  const order = api.currentOrders().find((item) => item.orderId === "express-backorder");
  assert.ok(order !== undefined);
  assert.notEqual(order.status, "cancelled");
  assert.equal(api.events().filter((event) => event.type === "backorder-recorded").length, 1);
  assert.throws(() => api.placeOrder({ orderId: "invalid", skuId: "sku", quantity: 1, priority: "urgent" }), /priority/u);
  const defaults = createWarehouseApi(createOrderService(createWarehouse({ sku: 5 })));
  defaults.placeOrder({ orderId: "default-priority", skuId: "sku", quantity: 1 });
  assert.equal(defaults.currentOrders()[0].priority, "standard");
  defaults.cancelOrder?.("default-priority");
  console.log("final oracle M: PASS");
}

async function evaluateCohesive() {
  const { summarizeInventory } = domain;
  assert.equal(typeof summarizeInventory, "function", "domain must export summarizeInventory");
  const empty = summarizeInventory(createWarehouse({ skuA: 0, skuB: 2 }));
  assert.deepEqual(empty, { totalUnits: 2, occupiedSkus: 1 });
  const reserved = placeOrder(createWarehouse({ skuA: 5, skuB: 2 }), { orderId: "o-1", skuId: "skuA", quantity: 3 });
  assert.deepEqual(summarizeInventory(reserved), { totalUnits: 4, occupiedSkus: 2 });
  const cancelled = cancelOrder(reserved, "o-1");
  assert.deepEqual(summarizeInventory(cancelled), { totalUnits: 7, occupiedSkus: 2 });
  console.log("final oracle S: PASS");
}
