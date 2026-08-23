import assert from "node:assert/strict";
import test from "node:test";

import { createStop } from "../../itinerary/stops/stops.mjs";
import { createNote, listNotes, removeNote } from "./notes.mjs";

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

test("creates a note associated to a day and persists it in localStorage", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const note = createNote({
    text: "Reservar almuerzo temprano",
    day: 2,
  });

  assert.equal(note.text, "Reservar almuerzo temprano");
  assert.equal(note.day, 2);
  assert.equal(note.stopId, undefined);
  assert.equal(localStorage.data.get("memories:notes"), JSON.stringify([note]));
  assert.deepEqual(listNotes({ day: 2 }), [note]);
});

test("creates a note associated to a valid stop and filters by stopId", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const stop = createStop({
    name: "Mendoza",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    description: "Bodegas y centro",
  });

  const note = createNote({
    text: "Confirmar degustación",
    stopId: stop.id,
  });

  assert.equal(note.stopId, stop.id);
  assert.equal(note.day, undefined);
  assert.deepEqual(listNotes({ stopId: stop.id }), [note]);
  assert.deepEqual(listNotes({ day: 1 }), []);
});

test("removes a note and keeps the remaining notes intact", () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;

  const first = createNote({
    text: "Traer protector solar",
    day: 1,
  });
  const stop = createStop({
    name: "Bariloche",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    description: "Lago y caminata",
  });
  const second = createNote({
    text: "Llevar cámara",
    stopId: stop.id,
  });

  const removed = removeNote(first.id);

  assert.equal(removed.id, first.id);
  assert.deepEqual(listNotes(), [second]);
});
