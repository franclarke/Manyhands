import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const template = path.join(root, "target-template");
const oracle = path.join(root, "oracle", "evaluator.mjs");
const scratch = await mkdtemp(path.join(tmpdir(), "manyhands-final-preflight-"));

try {
  const untouched = await copyCase("untouched");
  const multi = await copyCase("multi");
  await writeMultiReference(multi);
  const cohesive = await copyCase("cohesive");
  await writeCohesiveReference(cohesive);
  const results = [
    ["template", await run(untouched, "M")],
    ["reference-M", await run(multi, "M")],
    ["reference-S", await run(cohesive, "S")]
  ];
  for (const [name, result] of results) console.log(`${name}: ${result ? "PASS" : "FAIL"}`);
  if (results[0][1] || !results[1][1] || !results[2][1]) process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}

async function copyCase(name) {
  const target = path.join(scratch, name);
  await cp(template, target, { recursive: true });
  return target;
}

async function writeMultiReference(target) {
  await writeFile(path.join(target, "src/domain/orders.mjs"), `export function createWarehouse(stockBySku = {}) {\n  return { stockBySku: { ...stockBySku }, orders: [], backorders: [] };\n}\nfunction priority(value) {\n  if (value === undefined) return "standard";\n  if (value === "standard" || value === "express") return value;\n  throw new Error("priority must be standard or express");\n}\nexport function placeOrder(state, request) {\n  if (!Number.isInteger(request.quantity) || request.quantity <= 0) throw new Error("quantity must be a positive integer");\n  const orders = state.orders ?? []; const backorders = state.backorders ?? [];\n  if (orders.some((order) => order.orderId === request.orderId)) throw new Error("duplicate order");\n  const resolved = priority(request.priority); const available = state.stockBySku[request.skuId] ?? 0;\n  if (available < request.quantity) return { ...state, orders: [...orders, { ...request, priority: resolved, status: "backordered" }], backorders: [...backorders, { orderId: request.orderId, skuId: request.skuId, missing: request.quantity - available }] };\n  return { ...state, stockBySku: { ...state.stockBySku, [request.skuId]: available - request.quantity }, orders: [...orders, { ...request, priority: resolved, status: "reserved" }], backorders };\n}\nexport function cancelOrder(state, orderId) {\n  const order = (state.orders ?? []).find((candidate) => candidate.orderId === orderId);\n  if (!order) throw new Error("unknown order"); if (order.status === "cancelled") return state;\n  const stockBySku = order.status === "reserved" ? { ...state.stockBySku, [order.skuId]: (state.stockBySku[order.skuId] ?? 0) + order.quantity } : state.stockBySku;\n  return { ...state, stockBySku, orders: state.orders.map((candidate) => candidate.orderId === orderId ? { ...candidate, status: "cancelled" } : candidate) };\n}\n`, "utf8");
  await writeFile(path.join(target, "src/application/order-service.mjs"), `import { placeOrder } from "../domain/orders.mjs";\nexport function createOrderService(initialState) { let state = initialState; const events = []; return { place(request) { state = placeOrder(state, request); const order = state.orders.at(-1); if (order.status === "backordered") events.push({ type: "backorder-recorded", ...state.backorders.at(-1) }); else events.push({ type: "order-reserved", orderId: request.orderId }); return state; }, current() { return state; }, currentBackorders() { return state.backorders ?? []; }, events() { return [...events]; } }; }\n`, "utf8");
  await writeFile(path.join(target, "src/api/warehouse-api.mjs"), `export function createWarehouseApi(service) { return { placeOrder(request) { return service.place(request); }, currentOrders() { return service.current().orders; }, currentBackorders() { return service.currentBackorders(); }, events() { return service.events(); } }; }\n`, "utf8");
}

async function writeCohesiveReference(target) {
  const file = path.join(target, "src/domain/orders.mjs");
  const current = await (await import("node:fs/promises")).readFile(file, "utf8");
  await writeFile(file, `${current}\nexport function summarizeInventory(state) {\n  const entries = Object.values(state.stockBySku);\n  return { totalUnits: entries.reduce((sum, units) => sum + units, 0), occupiedSkus: entries.filter((units) => units > 0).length };\n}\n`, "utf8");
}

function run(target, task) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [oracle, "--task", task], { cwd: target, stdio: ["ignore", "pipe", "pipe"] });
    child.on("close", (code) => resolve(code === 0));
  });
}
