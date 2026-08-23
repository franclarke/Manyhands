import { listStops } from "../../itinerary/stops/stops.mjs";
import { getItem, setItem } from "../../storage/store.mjs";

const STORAGE_KEY = "memories:notes";

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `note_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cloneNote(note) {
  return {
    id: note.id,
    text: note.text,
    day: note.day,
    stopId: note.stopId,
  };
}

function normalizeNote(note) {
  return {
    id: String(note.id),
    text: note.text,
    day: hasOwn(note, "day") ? note.day : undefined,
    stopId: hasOwn(note, "stopId") ? note.stopId : undefined,
  };
}

function readNotes() {
  const notes = getItem(STORAGE_KEY);

  if (!Array.isArray(notes)) {
    return [];
  }

  return notes.map(normalizeNote);
}

function writeNotes(notes) {
  setItem(STORAGE_KEY, notes.map(normalizeNote));
}

function hasAssociation(note) {
  const hasDay = hasOwn(note, "day") && note.day !== undefined && note.day !== null;
  const hasStopId = hasOwn(note, "stopId") && note.stopId !== undefined && note.stopId !== null;

  return { hasDay, hasStopId };
}

function isValidDay(day) {
  return Number.isInteger(day) && day > 0;
}

function stopExists(stopId) {
  return listStops().some((stop) => stop.id === stopId);
}

function matchesFilter(note, filter) {
  if (hasOwn(filter, "day") && filter.day !== undefined && note.day !== filter.day) {
    return false;
  }

  if (hasOwn(filter, "stopId") && filter.stopId !== undefined && note.stopId !== filter.stopId) {
    return false;
  }

  return true;
}

export function listNotes(filter = {}) {
  return readNotes().filter((note) => matchesFilter(note, filter)).map(cloneNote);
}

export function createNote(note) {
  if (typeof note.text !== "string") {
    throw new TypeError("Note text must be a string");
  }

  const { hasDay, hasStopId } = hasAssociation(note);

  if (hasDay === hasStopId) {
    throw new RangeError("Note must be associated to exactly one day or stopId");
  }

  const nextNote = {
    id: createId(),
    text: note.text,
    day: undefined,
    stopId: undefined,
  };

  if (hasDay) {
    if (!isValidDay(note.day)) {
      throw new RangeError("Note day must be a positive integer");
    }

    nextNote.day = note.day;
  } else {
    const stopId = String(note.stopId);

    if (!stopExists(stopId)) {
      throw new RangeError("Note stopId must reference an existing stop");
    }

    nextNote.stopId = stopId;
  }

  const nextNotes = readNotes();
  nextNotes.push(nextNote);
  writeNotes(nextNotes);

  return cloneNote(nextNote);
}

export function removeNote(id) {
  const nextNotes = readNotes();
  const index = nextNotes.findIndex((note) => note.id === id);

  if (index === -1) {
    return null;
  }

  const [removedNote] = nextNotes.splice(index, 1);
  writeNotes(nextNotes);

  return cloneNote(removedNote);
}
