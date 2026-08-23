import assert from "node:assert/strict";
import test from "node:test";

import { addExpense, getBudgetSummary, setTotalBudget } from "./budget.mjs";

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

test("calculates total, spent, available, and spent by category", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  setTotalBudget(1000);
  addExpense("alimentacion", 250);
  addExpense("transporte", 100);
  addExpense("alimentacion", 50);

  assert.deepEqual(getBudgetSummary(), {
    total: 1000,
    spent: 400,
    available: 600,
    byCategory: {
      alimentacion: 300,
      transporte: 100,
    },
  });
});

test("keeps expenses when the total budget changes", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  setTotalBudget(500);
  addExpense("alojamiento", 120);
  setTotalBudget(700);

  assert.deepEqual(getBudgetSummary(), {
    total: 700,
    spent: 120,
    available: 580,
    byCategory: {
      alojamiento: 120,
    },
  });
});

test("returns a zeroed summary before any data is stored", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  assert.deepEqual(getBudgetSummary(), {
    total: 0,
    spent: 0,
    available: 0,
    byCategory: {},
  });
});
