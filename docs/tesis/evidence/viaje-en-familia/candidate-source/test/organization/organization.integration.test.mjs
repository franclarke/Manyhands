import assert from "node:assert/strict";
import test from "node:test";

import { addExpense, getBudgetSummary, setTotalBudget } from "../../src/organization/budget/budget.mjs";
import {
  addPackingItem,
  filterPackingItems,
  getPackingProgress,
  togglePackingItem,
} from "../../src/organization/packing/packing.mjs";

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

test("budget and packing state stay visible together for trip logistics", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  setTotalBudget(1500);
  addExpense("transporte", 200);
  addExpense("alojamiento", 500);

  const [passport] = addPackingItem("Passport");
  const [, sunscreen] = addPackingItem("Sunscreen");

  togglePackingItem(passport.id);

  assert.deepEqual(getBudgetSummary(), {
    total: 1500,
    spent: 700,
    available: 800,
    byCategory: {
      transporte: 200,
      alojamiento: 500,
    },
  });

  assert.deepEqual(getPackingProgress(), {
    completed: 1,
    total: 2,
  });

  assert.deepEqual(
    filterPackingItems("completed").map((item) => item.name),
    ["Passport"],
  );

  assert.deepEqual(
    filterPackingItems("pending").map((item) => item.name),
    ["Sunscreen"],
  );

  assert.equal(
    localStorage.data.get("organization.budget"),
    JSON.stringify({
      total: 1500,
      spent: 700,
      available: 800,
      byCategory: {
        transporte: 200,
        alojamiento: 500,
      },
    }),
  );

  assert.equal(
    localStorage.data.get("organization:packing"),
    JSON.stringify([
      {
        ...passport,
        completed: true,
      },
      sunscreen,
    ]),
  );
});
