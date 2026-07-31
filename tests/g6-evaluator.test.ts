import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  evaluateG6Criteria,
  G6_CRITERION_IDS
} from "../docs/tesis/evidence/scripts/lib/g6-criteria.mjs";

/**
 * El evaluador externo de G6 existe para arreglar el defecto que invalidó la
 * métrica primaria de G5: los criterios se compilaban por unidad de trabajo, de
 * modo que descomponer multiplicaba las obligaciones y cada condición se medía
 * contra su propia vara.
 *
 * Éste se evalúa **sobre el árbol entregado**, es idéntico para A, B y C, y
 * ejercita el código importándolo. Que importe en vez de leer lo que el probe
 * dice de sí mismo es deliberado: un probe puede escribir `true`, una función
 * importada tiene que hacer el trabajo.
 */
const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("G6 external criteria", () => {
  it("declares the ten frozen criteria", () => {
    expect(G6_CRITERION_IDS).toEqual([
      "gate-install",
      "gate-test",
      "gate-typecheck",
      "gate-build",
      "integrity-baseline-tests",
      "behaviour-express-first",
      "behaviour-backorder-recorded",
      "behaviour-invalid-priority-rejected",
      "probe-single-json",
      "probe-deterministic"
    ]);
  });

  it("satisfies every criterion on a conforming tree", async () => {
    const tree = await conformingTree();

    const verdict = await evaluateG6Criteria({
      treePath: tree,
      baselineTestFiles: ["src/domain/orders.test.ts"],
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      runProbe: async () => ({ exitCode: 0, stdout: '{"schemaVersion":1}\n', stderr: "" })
    });

    expect(verdict.satisfied).toBe(10);
    expect(verdict.total).toBe(10);
    expect(verdict.criteria.every((entry) => entry.satisfied)).toBe(true);
  });

  it("fails the express criterion when the planner ignores priority", async () => {
    const tree = await conformingTree({ expressFirst: false });

    const verdict = await evaluateG6Criteria({
      treePath: tree,
      baselineTestFiles: ["src/domain/orders.test.ts"],
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      runProbe: async () => ({ exitCode: 0, stdout: '{"schemaVersion":1}\n', stderr: "" })
    });

    expect(verdict.satisfied).toBe(9);
    expect(verdict.criteria.find((entry) => entry.id === "behaviour-express-first")?.satisfied).toBe(false);
  });

  /**
   * El caso que justifica importar en vez de leer el probe: el árbol declara
   * éxito por escrito y no implementa nada.
   */
  it("is not fooled by a probe that reports success without implementing it", async () => {
    const tree = await conformingTree({ expressFirst: false, backorders: false, rejectsPriority: false });

    const verdict = await evaluateG6Criteria({
      treePath: tree,
      baselineTestFiles: ["src/domain/orders.test.ts"],
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      runProbe: async () => ({
        exitCode: 0,
        stdout: '{"expressFirst":true,"backordersRecorded":true,"invalidPriorityRejected":true}\n',
        stderr: ""
      })
    });

    expect(verdict.satisfied).toBe(7);
    for (const id of ["behaviour-express-first", "behaviour-backorder-recorded", "behaviour-invalid-priority-rejected"]) {
      expect(verdict.criteria.find((entry) => entry.id === id)?.satisfied, id).toBe(false);
    }
  });

  it("fails a repository gate and the baseline-test integrity check", async () => {
    const tree = await conformingTree();

    const verdict = await evaluateG6Criteria({
      treePath: tree,
      baselineTestFiles: ["src/domain/orders.test.ts", "src/domain/deleted.test.ts"],
      runCommand: async (command) => ({ exitCode: command[0] === "test" ? 1 : 0, stdout: "", stderr: "boom" }),
      runProbe: async () => ({ exitCode: 0, stdout: '{"schemaVersion":1}\n', stderr: "" })
    });

    expect(verdict.criteria.find((entry) => entry.id === "gate-test")?.satisfied).toBe(false);
    expect(verdict.criteria.find((entry) => entry.id === "integrity-baseline-tests")?.satisfied).toBe(false);
    expect(verdict.satisfied).toBe(8);
  });

  it("fails determinism when two probe invocations differ", async () => {
    const tree = await conformingTree();
    let call = 0;

    const verdict = await evaluateG6Criteria({
      treePath: tree,
      baselineTestFiles: ["src/domain/orders.test.ts"],
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      runProbe: async () => {
        call += 1;
        return { exitCode: 0, stdout: `{"n":${call}}\n`, stderr: "" };
      }
    });

    expect(verdict.criteria.find((entry) => entry.id === "probe-deterministic")?.satisfied).toBe(false);
    expect(verdict.criteria.find((entry) => entry.id === "probe-single-json")?.satisfied).toBe(true);
  });
});

/**
 * Árbol mínimo que expone la superficie que el enunciado declara. Los
 * interruptores apagan una capacidad por vez para que cada criterio se pruebe
 * contra un árbol que falla sólo en eso.
 */
async function conformingTree(options: {
  expressFirst?: boolean;
  backorders?: boolean;
  rejectsPriority?: boolean;
} = {}): Promise<string> {
  const { expressFirst = true, backorders = true, rejectsPriority = true } = options;
  const root = await mkdtemp(join(tmpdir(), "manyhands-g6-tree-"));
  roots.push(root);
  await mkdir(join(root, "src", "domain"), { recursive: true });
  await mkdir(join(root, "src", "fulfillment"), { recursive: true });
  await mkdir(join(root, "src", "scenarios"), { recursive: true });

  await writeFile(join(root, "src", "scenarios", "thesis-seed-2026.ts"), `
export function buildThesisSeed2026() {
  return {
    name: "thesis-seed-2026",
    layout: { zones: [{ id: "zone-1", name: "Z" }], bins: [{ id: "bin-1-1", zoneId: "zone-1", code: "Z-01" }] },
    inventory: { placements: [{ binId: "bin-1-1", skuId: "SKU-1001", quantity: 5 }] },
    skus: ["SKU-1001"]
  };
}
`, "utf8");

  await writeFile(join(root, "src", "domain", "orders.test.ts"), "export const baseline = true;\n", "utf8");

  await writeFile(join(root, "src", "domain", "orders.ts"), `
export class OrderError extends Error {}
const PRIORITIES = ["standard", "express"];
export function createWarehouseState(inventory) {
  return { inventory, orders: new Map(), reservations: new Map(), backorders: new Map() };
}
export function placeOrder(state, order) {
  ${rejectsPriority ? 'if (!PRIORITIES.includes(order.priority)) throw new OrderError("invalid priority");' : ""}
  const orders = new Map(state.orders);
  orders.set(order.id, order);
  return { ...state, orders };
}
export function reserveOrder(state, orderId) {
  const order = state.orders.get(orderId);
  if (order === undefined) throw new OrderError("unknown order");
  const backorders = new Map(state.backorders);
  ${backorders ? `
  const recorded = [];
  for (const line of order.lines) {
    const available = state.inventory.placements
      .filter((placement) => placement.skuId === line.skuId)
      .reduce((total, placement) => total + placement.quantity, 0);
    if (line.quantity > available) recorded.push({ orderId, skuId: line.skuId, missing: line.quantity - available });
  }
  if (recorded.length > 0) backorders.set(orderId, recorded);
  ` : ""}
  return { ...state, backorders };
}
export function listBackorders(state) {
  return [...state.backorders.values()].flat();
}
`, "utf8");

  await writeFile(join(root, "src", "fulfillment", "planner.ts"), `
export function planFulfillment(layout, inventory, orders, pickerCapacity) {
  const ordered = ${expressFirst
    ? '[...orders].sort((left, right) => (left.priority === "express" ? 0 : 1) - (right.priority === "express" ? 0 : 1))'
    : "[...orders]"};
  return {
    pickerCapacity,
    waves: [{ waveId: "wave-1", orderIds: ordered.map((order) => order.id), pickerCapacity, routes: [] }],
    tasks: [],
    unassigned: [],
    cost: 0,
    costInputs: { routeDistance: 0, congestionLoad: 0, pickerCapacity, unassignedOrders: 0 }
  };
}
`, "utf8");

  return root;
}
