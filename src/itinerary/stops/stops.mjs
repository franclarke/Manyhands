import { getItem, setItem } from "../../storage/store.mjs";

const STORAGE_KEY = "itinerary:stops";

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `stop_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function cloneStop(stop) {
  return {
    id: stop.id,
    name: stop.name,
    startDate: stop.startDate,
    endDate: stop.endDate,
    description: stop.description,
  };
}

function normalizeStop(stop) {
  return {
    id: String(stop.id),
    name: stop.name,
    startDate: stop.startDate,
    endDate: stop.endDate,
    description: stop.description,
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function readStops() {
  const stops = getItem(STORAGE_KEY);

  if (!Array.isArray(stops)) {
    return [];
  }

  return stops.map(normalizeStop);
}

function writeStops(stops) {
  setItem(STORAGE_KEY, stops.map(normalizeStop));
}

function clampIndex(index, length) {
  if (length === 0) {
    return 0;
  }

  const numericIndex = Number.isFinite(index) ? Math.trunc(index) : length - 1;

  return Math.min(Math.max(numericIndex, 0), length - 1);
}

export function listStops() {
  return readStops().map(cloneStop);
}

export function createStop(stop) {
  const nextStops = readStops();
  const nextStop = normalizeStop({
    id: createId(),
    name: stop.name,
    startDate: stop.startDate,
    endDate: stop.endDate,
    description: stop.description,
  });

  nextStops.push(nextStop);
  writeStops(nextStops);

  return cloneStop(nextStop);
}

export function updateStop(id, updates) {
  const nextStops = readStops();
  const index = nextStops.findIndex((stop) => stop.id === id);

  if (index === -1) {
    return null;
  }

  const currentStop = nextStops[index];
  const nextStop = normalizeStop({
    id: currentStop.id,
    name: hasOwn(updates, "name") ? updates.name : currentStop.name,
    startDate: hasOwn(updates, "startDate") ? updates.startDate : currentStop.startDate,
    endDate: hasOwn(updates, "endDate") ? updates.endDate : currentStop.endDate,
    description: hasOwn(updates, "description") ? updates.description : currentStop.description,
  });

  nextStops[index] = nextStop;
  writeStops(nextStops);

  return cloneStop(nextStop);
}

export function removeStop(id) {
  const nextStops = readStops();
  const index = nextStops.findIndex((stop) => stop.id === id);

  if (index === -1) {
    return null;
  }

  const [removedStop] = nextStops.splice(index, 1);
  writeStops(nextStops);

  return cloneStop(removedStop);
}

export function reorderStops(id, index) {
  const nextStops = readStops();
  const currentIndex = nextStops.findIndex((stop) => stop.id === id);

  if (currentIndex === -1) {
    return listStops();
  }

  const [stop] = nextStops.splice(currentIndex, 1);
  const nextIndex = clampIndex(index, nextStops.length + 1);
  nextStops.splice(nextIndex, 0, stop);
  writeStops(nextStops);

  return listStops();
}
