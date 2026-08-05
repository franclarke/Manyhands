/**
 * Planning fixtures: the smallest repository that still forces a real
 * domain -> application -> API decomposition. Dependency-free on purpose so the
 * harness never touches the network.
 *
 * Two variants exist because the productive fast indexer only recognizes
 * `.ts`, `.tsx` and `.js` (`fast-indexer.ts`, SOURCE_EXTENSIONS). The SP2 target
 * template was written entirely in `.mjs`, so its planner received zero path
 * evidence — see the `.mjs` characterization test in planning-harness.test.ts.
 */
function sources(extension: "js" | "mjs") {
  return {
    "package.json": JSON.stringify(
      {
        name: `warehouse-slice-${extension}`,
        private: true,
        type: "module",
        scripts: { test: `node --test test/*.test.${extension}` }
      },
      null,
      2
    ),
    [`src/domain/orders.${extension}`]: [
      "export function createWarehouse(stockBySku = {}) {",
      "  return { stockBySku: { ...stockBySku }, orders: [] };",
      "}",
      "",
      "export function placeOrder(state, { orderId, skuId, quantity }) {",
      "  const available = state.stockBySku[skuId] ?? 0;",
      '  if (available < quantity) throw new Error("insufficient stock");',
      '  const order = { orderId, skuId, quantity, status: "reserved" };',
      "  return {",
      "    ...state,",
      "    stockBySku: { ...state.stockBySku, [skuId]: available - quantity },",
      "    orders: [...state.orders, order]",
      "  };",
      "}",
      ""
    ].join("\n"),
    [`src/application/order-service.${extension}`]: [
      `import { placeOrder } from "../domain/orders.${extension}";`,
      "",
      "export function createOrderService(initialState) {",
      "  let state = initialState;",
      "  const events = [];",
      "  return {",
      "    place(request) {",
      "      state = placeOrder(state, request);",
      '      events.push({ type: "order-reserved", orderId: request.orderId });',
      "      return state;",
      "    },",
      "    current() { return state; },",
      "    events() { return [...events]; }",
      "  };",
      "}",
      ""
    ].join("\n"),
    [`src/api/warehouse-api.${extension}`]: [
      "export function createWarehouseApi(service) {",
      "  return {",
      "    placeOrder(request) { return service.place(request); },",
      "    currentOrders() { return service.current().orders; },",
      "    events() { return service.events(); }",
      "  };",
      "}",
      ""
    ].join("\n"),
    [`test/baseline.test.${extension}`]: [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      `import { createWarehouse, placeOrder } from "../src/domain/orders.${extension}";`,
      "",
      'test("reserves available inventory", () => {',
      '  const next = placeOrder(createWarehouse({ sku: 3 }), { orderId: "o-1", skuId: "sku", quantity: 2 });',
      "  assert.equal(next.stockBySku.sku, 1);",
      "});",
      ""
    ].join("\n")
  };
}

/** Indexable variant: the planner sees every source file as path evidence. */
export const warehouseSlice = { name: "warehouse-slice", files: sources("js") };

/** The SP2 target shape. The productive indexer sees none of these files. */
export const warehouseSliceMjs = { name: "warehouse-slice-mjs", files: sources("mjs") };

export const PLANNING_FIXTURES = { warehouseSlice, warehouseSliceMjs };
