import assert from "node:assert/strict";
import test from "node:test";

import { getItem, setItem, subscribe } from "./store.mjs";

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

test("persists and recovers data by key through JSON serialization", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const value = {
    name: "viaje",
    days: 5,
    places: ["mendoza", "bariloche"],
    active: true,
    details: {
      budget: null,
    },
  };

  setItem("trip", value);

  assert.equal(localStorage.data.get("trip"), JSON.stringify(value));
  assert.deepEqual(getItem("trip"), value);
});

test("subscribe notifies listeners when a key changes", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const updates = [];
  const unsubscribe = subscribe("trip", (value) => {
    updates.push(value);
  });

  setItem("trip", { day: 1 });
  setItem("trip", { day: 2 });
  unsubscribe();
  setItem("trip", { day: 3 });

  assert.deepEqual(updates, [{ day: 1 }, { day: 2 }]);
});

test("getItem returns null when a key is missing", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  assert.equal(getItem("missing"), null);
});
