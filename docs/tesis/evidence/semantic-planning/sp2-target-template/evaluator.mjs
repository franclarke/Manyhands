import assert from "node:assert/strict";
import { createWarehouse } from "./src/domain/orders.mjs";
import { createOrderService } from "./src/application/order-service.mjs";
import { createWarehouseApi } from "./src/api/warehouse-api.mjs";

// External oracle for the five criteria of `sp2-protocol.md`. It only uses the
// surfaces the goal itself names — domain, application and the public API — so
// passing it never requires anything the task did not ask for.

// Criterion 2: insufficient stock does not discard the order. It records a
// positive backorder and the order stays cancellable.
const api = createWarehouseApi(createOrderService(createWarehouse({ sku: 1 })));
api.placeOrder({ orderId: "express-backorder", skuId: "sku", quantity: 3, priority: "express" });

const backorders = api.currentBackorders();
assert.equal(backorders.length, 1, "API must expose one recorded backorder");
assert.deepEqual(backorders[0], { orderId: "express-backorder", skuId: "sku", missing: 2 });

// The other half of criterion 2, which recording a backorder does not imply: an
// implementation that files the backorder and drops the order satisfies every
// assertion above. Cancellability is asserted through the state the API already
// exposes, not through a new cancel endpoint the goal never requested.
const backordered = api.currentOrders().find((order) => order.orderId === "express-backorder");
assert.ok(backordered !== undefined, "a backordered order must survive as an order, not be discarded");
assert.notEqual(backordered.status, "cancelled", "a backordered order must remain cancellable");

// Criterion 3: exactly one application event per backorder.
assert.equal(api.events().filter((event) => event.type === "backorder-recorded").length, 1, "application must emit exactly one backorder event");

// Criterion 1, rejection half.
assert.throws(() => api.placeOrder({ orderId: "invalid", skuId: "sku", quantity: 1, priority: "urgent" }), /priority/u);

// Criterion 1, default half. Rejecting `urgent` says nothing about what an
// order without a priority becomes, and "standard by default" is a declared
// criterion: without this it is a requirement no evidence ever covers.
const defaults = createWarehouseApi(createOrderService(createWarehouse({ sku: 5 })));
defaults.placeOrder({ orderId: "default-priority", skuId: "sku", quantity: 1 });
const stored = defaults.currentOrders().find((order) => order.orderId === "default-priority");
assert.ok(stored !== undefined, "an order placed within stock must be observable through the API");
assert.equal(stored.priority, "standard", "an order placed without a priority must default to standard");

console.log("SP2 evaluator: PASS");
