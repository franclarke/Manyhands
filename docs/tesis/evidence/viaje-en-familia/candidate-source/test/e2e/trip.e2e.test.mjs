import assert from "node:assert/strict";
import test from "node:test";

import { createActivity, toggleActivityStatus } from "../../src/itinerary/agenda/agenda.mjs";
import { searchItinerary } from "../../src/itinerary/search/search.mjs";
import { createStop, reorderStops } from "../../src/itinerary/stops/stops.mjs";
import { buildDashboardSummary } from "../../src/dashboard/summary.mjs";
import { addExpense, getBudgetSummary, setTotalBudget } from "../../src/organization/budget/budget.mjs";
import {
  addPackingItem,
  filterPackingItems,
  getPackingProgress,
  togglePackingItem,
} from "../../src/organization/packing/packing.mjs";
import { createNote, listNotes } from "../../src/memories/notes/notes.mjs";
import { listFavorites, toggleFavorite } from "../../src/memories/favorites/favorites.mjs";
import { getItem, setItem, subscribe } from "../../src/storage/store.mjs";

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

test("integrates itinerary, organization, and memories into a local dashboard state", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const observedValues = [];
  const unsubscribe = subscribe("trip:signal", (value) => {
    observedValues.push(value);
  });

  setItem("trip:signal", { stage: "ready" });
  setItem("trip:signal", { stage: "running" });
  assert.deepEqual(observedValues, [{ stage: "ready" }, { stage: "running" }]);
  assert.deepEqual(getItem("trip:signal"), { stage: "running" });
  unsubscribe();

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

  const firstActivity = createActivity({
    stopId: firstStop.id,
    day: "2026-09-02",
    time: "10:30",
  });
  const secondActivity = createActivity({
    stopId: secondStop.id,
    day: "2026-09-05",
    time: "15:15",
  });
  const thirdActivity = createActivity({
    stopId: thirdStop.id,
    day: "2026-09-06",
    time: "08:00",
  });

  assert.equal(toggleActivityStatus(firstActivity.id)?.status, "done");

  setTotalBudget(1500);
  addExpense("transporte", 200);
  addExpense("alojamiento", 500);

  const [passport] = addPackingItem("Passport");
  const [, sunscreen] = addPackingItem("Sunscreen");
  togglePackingItem(passport.id);

  const dayNote = createNote({
    text: "Reservar almuerzo temprano",
    day: 2,
  });
  const stopNote = createNote({
    text: "Confirmar degustación",
    stopId: thirdStop.id,
  });
  const stopFavorite = toggleFavorite("stop", thirdStop.id);
  const activityFavorite = toggleFavorite("activity", thirdActivity.id);

  assert.deepEqual(searchItinerary("", {}), [
    thirdStop,
    thirdActivity,
    firstStop,
    { ...firstActivity, status: "done" },
    secondStop,
    secondActivity,
  ]);
  assert.deepEqual(searchItinerary("córdoba", { status: "pending" }), [secondStop]);
  assert.deepEqual(searchItinerary("", { stopId: thirdStop.id, status: "pending" }), [thirdStop, thirdActivity]);

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
  assert.deepEqual(listNotes(), [dayNote, stopNote]);
  assert.deepEqual(listFavorites(), [stopFavorite, activityFavorite]);

  assert.equal(
    localStorage.data.get("itinerary:stops"),
    JSON.stringify([thirdStop, firstStop, secondStop]),
  );
  assert.equal(
    localStorage.data.get("itinerary:agenda"),
    JSON.stringify([
      {
        ...firstActivity,
        status: "done",
      },
      secondActivity,
      thirdActivity,
    ]),
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
  assert.equal(
    localStorage.data.get("memories:notes"),
    JSON.stringify([dayNote, stopNote]),
  );
  assert.equal(
    localStorage.data.get("itinerary:favorites"),
    JSON.stringify([stopFavorite, activityFavorite]),
  );

  assert.deepEqual(buildDashboardSummary(), {
    trip: {
      name: "Viaje en familia",
      startDate: "2026-09-06",
      endDate: "2026-09-05",
      dateLabel: "6 sept 2026 - 5 sept 2026",
    },
    upcomingEvents: [
      {
        id: thirdActivity.id,
        stopId: thirdStop.id,
        stopName: "Mendoza",
        day: "2026-09-06",
        time: "08:00",
        status: "pending",
        label: "08:00 · Mendoza",
      },
      {
        id: secondActivity.id,
        stopId: secondStop.id,
        stopName: "Córdoba",
        day: "2026-09-05",
        time: "15:15",
        status: "pending",
        label: "15:15 · Córdoba",
      },
    ],
    budget: {
      total: 1500,
      spent: 700,
      available: 800,
      ratio: 700 / 1500,
      spentLabel: "700",
      totalLabel: "1500",
      availableLabel: "800",
      categories: [
        {
          category: "alojamiento",
          amount: 500,
          share: 71,
          label: "alojamiento · 500",
        },
        {
          category: "transporte",
          amount: 200,
          share: 29,
          label: "transporte · 200",
        },
      ],
    },
    packing: {
      completed: 1,
      total: 2,
      ratio: 0.5,
      label: "1/2",
    },
    memories: {
      notes: [
        {
          id: dayNote.id,
          text: "Reservar almuerzo temprano",
          label: "Día 2",
        },
        {
          id: stopNote.id,
          text: "Confirmar degustación",
          label: "Mendoza",
        },
      ],
      favorites: [
        {
          targetType: "stop",
          targetId: stopFavorite.targetId,
          label: "Mendoza",
        },
        {
          targetType: "activity",
          targetId: activityFavorite.targetId,
          label: "08:00 · Mendoza",
        },
      ],
      highlights: [
        {
          kind: "note",
          id: dayNote.id,
          label: "Día 2",
          text: "Reservar almuerzo temprano",
        },
        {
          kind: "note",
          id: stopNote.id,
          label: "Mendoza",
          text: "Confirmar degustación",
        },
        {
          kind: "favorite",
          targetType: "stop",
          targetId: stopFavorite.targetId,
          label: "Mendoza",
        },
        {
          kind: "favorite",
          targetType: "activity",
          targetId: activityFavorite.targetId,
          label: "08:00 · Mendoza",
        },
      ],
    },
  });
});
