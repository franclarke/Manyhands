import assert from "node:assert/strict";
import test from "node:test";

import { createActivity, toggleActivityStatus } from "../../src/itinerary/agenda/agenda.mjs";
import { searchItinerary } from "../../src/itinerary/search/search.mjs";
import { createStop, reorderStops } from "../../src/itinerary/stops/stops.mjs";

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

test("integrates stops, agenda, and search into one ordered itinerary", () => {
  globalThis.localStorage = createLocalStorage();

  const firstStop = createStop({
    name: "Buenos Aires",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    description: "Inicio del recorrido urbano",
  });
  const secondStop = createStop({
    name: "Córdoba",
    startDate: "2026-09-04",
    endDate: "2026-09-05",
    description: "Parada central",
  });
  const thirdStop = createStop({
    name: "Mendoza",
    startDate: "2026-09-06",
    endDate: "2026-09-07",
    description: "Cierre con viñedos",
  });

  reorderStops(thirdStop.id, 0);

  const thirdStopActivity = createActivity({
    stopId: thirdStop.id,
    day: "2026-09-06",
    time: "08:00",
  });
  const firstStopActivity = createActivity({
    stopId: firstStop.id,
    day: "2026-09-02",
    time: "10:30",
  });
  const secondStopActivity = createActivity({
    stopId: secondStop.id,
    day: "2026-09-05",
    time: "15:15",
  });

  assert.deepEqual(searchItinerary("", {}), [
    thirdStop,
    thirdStopActivity,
    firstStop,
    firstStopActivity,
    secondStop,
    secondStopActivity,
  ]);
});

test("search keeps itinerary order while filtering combined stop and activity data", () => {
  globalThis.localStorage = createLocalStorage();

  const firstStop = createStop({
    name: "Salta",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    description: "Noroeste y paseo",
  });
  const secondStop = createStop({
    name: "Jujuy",
    startDate: "2026-10-03",
    endDate: "2026-10-04",
    description: "Quebrada y descanso",
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
    searchItinerary("quebrada", {
      status: "pending",
    }),
    [secondStop],
  );

  assert.deepEqual(
    searchItinerary("", {
      stopId: secondStop.id,
      day: "2026-10-04",
      status: "done",
    }),
    [secondStop, secondStopMatchingActivity],
  );

  assert.equal(toggleActivityStatus(firstStopActivity.id).status, "pending");
  assert.deepEqual(searchItinerary("", { status: "done" }), [
    firstStop,
    secondStop,
    secondStopMatchingActivity,
  ]);

  assert.ok(firstStopActivity);
  assert.ok(secondStopActivity);
});
