import assert from "node:assert/strict";
import test from "node:test";

import { createActivity } from "../../src/itinerary/agenda/agenda.mjs";
import { createStop } from "../../src/itinerary/stops/stops.mjs";
import { listFavorites, toggleFavorite } from "../../src/memories/favorites/favorites.mjs";
import { createNote, listNotes, removeNote } from "../../src/memories/notes/notes.mjs";

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

test("notes and favorites share storage without overwriting each other", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const stop = createStop({
    name: "Mendoza",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    description: "Bodegas y centro",
  });
  const activity = createActivity({
    stopId: stop.id,
    day: "2026-09-02",
    time: "09:30",
  });

  const dayNote = createNote({
    text: "Reservar almuerzo temprano",
    day: 2,
  });
  const stopNote = createNote({
    text: "Confirmar degustación",
    stopId: stop.id,
  });
  const stopFavorite = toggleFavorite("stop", stop.id);
  const activityFavorite = toggleFavorite("activity", activity.id);

  assert.deepEqual(listNotes(), [dayNote, stopNote]);
  assert.deepEqual(listFavorites(), [stopFavorite, activityFavorite]);
  assert.equal(localStorage.data.get("memories:notes"), JSON.stringify([dayNote, stopNote]));
  assert.equal(
    localStorage.data.get("itinerary:favorites"),
    JSON.stringify([stopFavorite, activityFavorite]),
  );
});

test("removing a note does not affect favorites and toggling favorites does not affect notes", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const stop = createStop({
    name: "Bariloche",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    description: "Lago y caminata",
  });
  const activity = createActivity({
    stopId: stop.id,
    day: "2026-10-02",
    time: "10:00",
  });

  const note = createNote({
    text: "Traer protector solar",
    day: 1,
  });
  const favorite = toggleFavorite("activity", activity.id);

  assert.equal(removeNote(note.id)?.id, note.id);
  assert.deepEqual(listNotes(), []);
  assert.deepEqual(listFavorites(), [favorite]);

  assert.equal(toggleFavorite("activity", activity.id)?.targetId, activity.id);
  assert.deepEqual(listNotes(), []);
  assert.deepEqual(listFavorites(), []);
});
