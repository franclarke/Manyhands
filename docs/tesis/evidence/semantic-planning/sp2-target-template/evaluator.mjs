import assert from "node:assert/strict";
import { createWarehouse } from "./src/domain/orders.mjs";
import { createOrderService } from "./src/application/order-service.mjs";
import { createWarehouseApi } from "./src/api/warehouse-api.mjs";

const api = createWarehouseApi(createOrderService(createWarehouse({ sku: 1 })));
api.placeOrder({ orderId: "express-backorder", skuId: "sku", quantity: 3, priority: "express" });

const backorders = api.currentBackorders();
assert.equal(backorders.length, 1, "API must expose one recorded backorder");
assert.deepEqual(backorders[0], { orderId: "express-backorder", skuId: "sku", missing: 2 });
assert.equal(api.events().filter((event) => event.type === "backorder-recorded").length, 1, "application must emit exactly one backorder event");
assert.throws(() => api.placeOrder({ orderId: "invalid", skuId: "sku", quantity: 1, priority: "urgent" }), /priority/u);
console.log("SP2 evaluator: PASS");
