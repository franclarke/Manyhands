import assert from "node:assert/strict";
import test from "node:test";

import { createStop } from "../stops/stops.mjs";
import {
  createActivity,
  listActivities,
  removeActivity,
  toggleActivityStatus,
  updateActivity,
} from "./agenda.mjs";

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

test("creates activities for an existing stop with day, time, and pending status", () => {
  globalThis.localStorage = createLocalStorage();

  const stop = createStop({
    name: "Mendoza",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    description: "Viñedos y centro",
  });

  const activity = createActivity({
    stopId: stop.id,
    day: "2026-09-02",
    time: "09:30",
  });

  assert.equal(activity.stopId, stop.id);
  assert.equal(activity.day, "2026-09-02");
  assert.equal(activity.time, "09:30");
  assert.equal(activity.status, "pending");
  assert.deepEqual(listActivities(), [activity]);
});

test("updates, toggles, and removes activities while keeping their association", () => {
  globalThis.localStorage = createLocalStorage();

  const firstStop = createStop({
    name: "Rosario",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    description: "Parada inicial",
  });
  const secondStop = createStop({
    name: "Córdoba",
    startDate: "2026-10-04",
    endDate: "2026-10-06",
    description: "Centro y descanso",
  });

  const activity = createActivity({
    stopId: firstStop.id,
    day: "2026-10-02",
    time: "08:15",
  });

  const updated = updateActivity(activity.id, {
    stopId: secondStop.id,
    day: "2026-10-05",
    time: "11:45",
    status: "done",
  });
  const toggled = toggleActivityStatus(activity.id);
  const removed = removeActivity(activity.id);

  assert.equal(updated.id, activity.id);
  assert.equal(updated.stopId, secondStop.id);
  assert.equal(updated.day, "2026-10-05");
  assert.equal(updated.time, "11:45");
  assert.equal(updated.status, "done");

  assert.equal(toggled.status, "pending");
  assert.equal(removed.id, activity.id);
  assert.deepEqual(listActivities(), []);
});

test("rejects activities that do not reference an existing stop", () => {
  globalThis.localStorage = createLocalStorage();

  createStop({
    name: "Salta",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    description: "Ingreso al noroeste",
  });

  assert.throws(() => {
    createActivity({
      stopId: "missing-stop",
      day: "2026-11-01",
      time: "07:00",
    });
  }, /missing stop/i);
});
