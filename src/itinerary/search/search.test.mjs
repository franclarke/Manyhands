import assert from "node:assert/strict";
import test from "node:test";

import { createActivity } from "../agenda/agenda.mjs";
import { createStop } from "../stops/stops.mjs";
import { searchItinerary } from "./search.mjs";

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

test("searchItinerary keeps the itinerary order across stops and activities", () => {
  globalThis.localStorage = createLocalStorage();

  const firstStop = createStop({
    name: "Buenos Aires",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    description: "Inicio del viaje",
  });
  const secondStop = createStop({
    name: "Córdoba",
    startDate: "2026-09-04",
    endDate: "2026-09-05",
    description: "Ruta central",
  });
  const thirdStop = createStop({
    name: "Mendoza",
    startDate: "2026-09-06",
    endDate: "2026-09-07",
    description: "Cierre del tramo",
  });

  const secondStopFirstActivity = createActivity({
    stopId: secondStop.id,
    day: "2026-09-04",
    time: "10:00",
    status: "pending",
  });
  const firstStopActivity = createActivity({
    stopId: firstStop.id,
    day: "2026-09-02",
    time: "08:30",
    status: "done",
  });
  const secondStopSecondActivity = createActivity({
    stopId: secondStop.id,
    day: "2026-09-05",
    time: "14:15",
    status: "done",
  });

  assert.deepEqual(searchItinerary("", {}), [
    firstStop,
    firstStopActivity,
    secondStop,
    secondStopFirstActivity,
    secondStopSecondActivity,
    thirdStop,
  ]);
});

test("searchItinerary filters by stopId, day, and status while preserving order", () => {
  globalThis.localStorage = createLocalStorage();

  const firstStop = createStop({
    name: "Salta",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    description: "Noroeste",
  });
  const secondStop = createStop({
    name: "Jujuy",
    startDate: "2026-10-03",
    endDate: "2026-10-04",
    description: "Quebrada",
  });

  const firstStopActivity = createActivity({
    stopId: firstStop.id,
    day: "2026-10-01",
    time: "09:00",
    status: "done",
  });
  const secondStopActivity = createActivity({
    stopId: secondStop.id,
    day: "2026-10-03",
    time: "11:30",
    status: "pending",
  });
  const secondStopMatchingActivity = createActivity({
    stopId: secondStop.id,
    day: "2026-10-04",
    time: "16:45",
    status: "done",
  });

  assert.deepEqual(
    searchItinerary("", {
      stopId: secondStop.id,
      day: "2026-10-04",
      status: "done",
    }),
    [secondStop, secondStopMatchingActivity],
  );

  assert.deepEqual(
    searchItinerary("quebrada", {
      status: "pending",
    }),
    [secondStop],
  );

  assert.deepEqual(
    searchItinerary("", {
      status: "done",
    }),
    [firstStop, firstStopActivity, secondStop, secondStopMatchingActivity],
  );
});
