import assert from "node:assert/strict";
import test from "node:test";

import {
  addPackingItem,
  filterPackingItems,
  getPackingProgress,
  togglePackingItem,
} from "./packing.mjs";

function createLocalStorage() {
  const data = new Map();

  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    key(index) {
      return Array.from(data.keys())[index] ?? null;
    },
    get length() {
      return data.size;
    },
    data,
  };
}

test("addPackingItem stores luggage items and defaults them to incomplete", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const items = addPackingItem("Passport");

  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Passport");
  assert.equal(items[0].completed, false);
  assert.equal(getPackingProgress().completed, 0);
  assert.equal(getPackingProgress().total, 1);
});

test("togglePackingItem flips completion state and updates progress totals", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const [firstItem] = addPackingItem({ name: "Socks" });
  const [, secondItem] = addPackingItem({ name: "Jacket" });

  togglePackingItem(firstItem.id);

  const items = filterPackingItems("all");

  assert.deepEqual(
    items.map(({ name, completed }) => ({ name, completed })),
    [
      { name: "Socks", completed: true },
      { name: "Jacket", completed: false },
    ],
  );
  assert.deepEqual(getPackingProgress(), { completed: 1, total: 2 });

  togglePackingItem(secondItem.id);
  assert.deepEqual(getPackingProgress(), { completed: 2, total: 2 });
});

test("filterPackingItems supports completed and pending views", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const [backpack] = addPackingItem("Backpack");
  const [, charger] = addPackingItem("Charger");

  togglePackingItem(charger.id);

  assert.deepEqual(
    filterPackingItems("completed").map((item) => item.name),
    ["Charger"],
  );
  assert.deepEqual(filterPackingItems("pending").map((item) => item.name), ["Backpack"]);
  assert.deepEqual(filterPackingItems("all").map((item) => item.name), ["Backpack", "Charger"]);
  assert.equal(backpack.completed, false);
});
