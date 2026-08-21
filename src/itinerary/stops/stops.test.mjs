import assert from "node:assert/strict";
import test from "node:test";

import {
  createStop,
  listStops,
  removeStop,
  reorderStops,
  updateStop,
} from "./stops.mjs";

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

test("creates stops with name, dates, and description in order", () => {
  globalThis.localStorage = createLocalStorage();

  const first = createStop({
    name: "Madrid",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    description: "Llegada y visita breve",
  });
  const second = createStop({
    name: "Sevilla",
    startDate: "2026-09-04",
    endDate: "2026-09-06",
    description: "Centro histórico y paseo nocturno",
  });

  assert.equal(first.name, "Madrid");
  assert.equal(first.startDate, "2026-09-01");
  assert.equal(first.endDate, "2026-09-03");
  assert.equal(first.description, "Llegada y visita breve");

  assert.deepEqual(listStops(), [first, second]);
});

test("updates a stop without losing the other fields", () => {
  globalThis.localStorage = createLocalStorage();

  const first = createStop({
    name: "Rosario",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    description: "Parada inicial",
  });
  const second = createStop({
    name: "Córdoba",
    startDate: "2026-10-03",
    endDate: "2026-10-05",
    description: "Noche y descanso",
  });

  const updated = updateStop(first.id, {
    name: "Rosario centro",
    startDate: "2026-10-02",
    endDate: "2026-10-04",
    description: "Paseo y almuerzo",
  });

  assert.equal(updated.id, first.id);
  assert.deepEqual(listStops(), [
    {
      id: first.id,
      name: "Rosario centro",
      startDate: "2026-10-02",
      endDate: "2026-10-04",
      description: "Paseo y almuerzo",
    },
    second,
  ]);
});

test("removes a stop and keeps the remaining order intact", () => {
  globalThis.localStorage = createLocalStorage();

  const first = createStop({
    name: "Salta",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    description: "Entrada al noroeste",
  });
  const second = createStop({
    name: "Jujuy",
    startDate: "2026-11-03",
    endDate: "2026-11-04",
    description: "Quebrada y pueblos",
  });
  const third = createStop({
    name: "Tucumán",
    startDate: "2026-11-05",
    endDate: "2026-11-06",
    description: "Cierre del tramo",
  });

  const removed = removeStop(second.id);

  assert.equal(removed.id, second.id);
  assert.deepEqual(listStops(), [first, third]);
});

test("reorders a stop by id while preserving its fields", () => {
  globalThis.localStorage = createLocalStorage();

  const first = createStop({
    name: "Bariloche",
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    description: "Primer tramo",
  });
  const second = createStop({
    name: "El Calafate",
    startDate: "2026-12-03",
    endDate: "2026-12-04",
    description: "Glaciares",
  });
  const third = createStop({
    name: "Ushuaia",
    startDate: "2026-12-05",
    endDate: "2026-12-06",
    description: "Extremo sur",
  });

  reorderStops(third.id, 0);

  assert.deepEqual(listStops(), [third, first, second]);
  assert.deepEqual(listStops()[0], third);
});
