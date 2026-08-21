import assert from "node:assert/strict";
import test from "node:test";

import { createActivity } from "../itinerary/agenda/agenda.mjs";
import { createStop } from "../itinerary/stops/stops.mjs";
import { addExpense, setTotalBudget } from "../organization/budget/budget.mjs";
import { addPackingItem, togglePackingItem } from "../organization/packing/packing.mjs";
import { createNote } from "../memories/notes/notes.mjs";
import { toggleFavorite } from "../memories/favorites/favorites.mjs";
import { buildDashboardSummary } from "./summary.mjs";

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

test("builds a dashboard summary with the trip, events, budget, packing, and memories", () => {
  globalThis.localStorage = createLocalStorage();

  const firstStop = createStop({
    name: "Mendoza",
    startDate: "2026-09-02",
    endDate: "2026-09-05",
    description: "Viñedos y centro",
  });
  const secondStop = createStop({
    name: "Bariloche",
    startDate: "2026-09-06",
    endDate: "2026-09-10",
    description: "Lagos y miradores",
  });

  const firstActivity = createActivity({
    stopId: firstStop.id,
    day: "2026-09-03",
    time: "09:30",
  });
  const secondActivity = createActivity({
    stopId: secondStop.id,
    day: "2026-09-07",
    time: "18:00",
  });

  setTotalBudget(1000);
  addExpense("alojamiento", 350);
  addExpense("comidas", 200);

  const [suitcaseItem] = addPackingItem("Campera");
  addPackingItem("Pasaportes");
  togglePackingItem(suitcaseItem.id);

  const dayNote = createNote({
    text: "Reservar cena familiar",
    day: 2,
  });
  const stopNote = createNote({
    text: "Llevar cámara",
    stopId: firstStop.id,
  });

  const stopFavorite = toggleFavorite("stop", secondStop.id);
  const activityFavorite = toggleFavorite("activity", secondActivity.id);

  assert.deepEqual(buildDashboardSummary(), {
    trip: {
      name: "Viaje en familia",
      startDate: "2026-09-02",
      endDate: "2026-09-10",
      dateLabel: "2 sept 2026 - 10 sept 2026",
    },
    upcomingEvents: [
      {
        id: firstActivity.id,
        stopId: firstStop.id,
        stopName: "Mendoza",
        day: "2026-09-03",
        time: "09:30",
        status: "pending",
        label: "09:30 · Mendoza",
      },
      {
        id: secondActivity.id,
        stopId: secondStop.id,
        stopName: "Bariloche",
        day: "2026-09-07",
        time: "18:00",
        status: "pending",
        label: "18:00 · Bariloche",
      },
    ],
    budget: {
      total: 1000,
      spent: 550,
      available: 450,
      ratio: 0.55,
      spentLabel: "550",
      totalLabel: "1000",
      availableLabel: "450",
      categories: [
        {
          category: "alojamiento",
          amount: 350,
          share: 64,
          label: "alojamiento · 350",
        },
        {
          category: "comidas",
          amount: 200,
          share: 36,
          label: "comidas · 200",
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
          text: "Reservar cena familiar",
          label: "Día 2",
        },
        {
          id: stopNote.id,
          text: "Llevar cámara",
          label: "Mendoza",
        },
      ],
      favorites: [
        {
          targetType: "stop",
          targetId: stopFavorite.targetId,
          label: "Bariloche",
        },
        {
          targetType: "activity",
          targetId: activityFavorite.targetId,
          label: "18:00 · Bariloche",
        },
      ],
      highlights: [
        {
          kind: "note",
          id: dayNote.id,
          label: "Día 2",
          text: "Reservar cena familiar",
        },
        {
          kind: "note",
          id: stopNote.id,
          label: "Mendoza",
          text: "Llevar cámara",
        },
        {
          kind: "favorite",
          targetType: "stop",
          targetId: stopFavorite.targetId,
          label: "Bariloche",
        },
        {
          kind: "favorite",
          targetType: "activity",
          targetId: activityFavorite.targetId,
          label: "18:00 · Bariloche",
        },
      ],
    },
  });
});
