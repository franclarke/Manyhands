import assert from "node:assert/strict";
import test from "node:test";

import { createActivity } from "../../itinerary/agenda/agenda.mjs";
import { createStop } from "../../itinerary/stops/stops.mjs";
import { listFavorites, toggleFavorite } from "./favorites.mjs";

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

test("toggles favorite stops and activities into a consolidated list", () => {
  globalThis.localStorage = createLocalStorage();

  const stop = createStop({
    name: "Buenos Aires",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    description: "Inicio del viaje",
  });
  const activity = createActivity({
    stopId: stop.id,
    day: "2026-09-02",
    time: "10:00",
  });

  const firstFavorite = toggleFavorite("stop", stop.id);
  const secondFavorite = toggleFavorite("activity", activity.id);

  assert.deepEqual(firstFavorite, {
    targetType: "stop",
    targetId: stop.id,
  });
  assert.deepEqual(secondFavorite, {
    targetType: "activity",
    targetId: activity.id,
  });
  assert.deepEqual(listFavorites(), [firstFavorite, secondFavorite]);
});

test("removes an existing favorite when toggled again", () => {
  globalThis.localStorage = createLocalStorage();

  const stop = createStop({
    name: "Mendoza",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    description: "Viñedos y centro",
  });
  const activity = createActivity({
    stopId: stop.id,
    day: "2026-10-02",
    time: "09:30",
  });

  const favorite = toggleFavorite("activity", activity.id);
  const removedFavorite = toggleFavorite("activity", activity.id);

  assert.deepEqual(favorite, {
    targetType: "activity",
    targetId: activity.id,
  });
  assert.deepEqual(removedFavorite, favorite);
  assert.deepEqual(listFavorites(), []);
});

test("rejects favorites that do not reference an existing stop or activity", () => {
  globalThis.localStorage = createLocalStorage();

  const stop = createStop({
    name: "Salta",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    description: "Ingreso al noroeste",
  });
  const activity = createActivity({
    stopId: stop.id,
    day: "2026-11-01",
    time: "07:00",
  });

  assert.throws(() => {
    toggleFavorite("stop", "missing-stop");
  }, /missing target/i);

  assert.throws(() => {
    toggleFavorite("activity", "missing-activity");
  }, /missing target/i);

  assert.throws(() => {
    toggleFavorite("unknown", activity.id);
  }, /must be "stop" or "activity"/i);
});
