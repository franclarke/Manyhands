import { getItem, setItem } from "../../storage/store.mjs";

const STORAGE_KEY = "organization:packing";

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `packing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toStringValue(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

function normalizeItem(input) {
  if (typeof input === "string") {
    const name = input.trim();

    if (name === "") {
      throw new TypeError("Packing item name cannot be empty");
    }

    return {
      id: createId(),
      name,
      completed: false,
    };
  }

  if (input && typeof input === "object") {
    const name = toStringValue(input.name) || toStringValue(input.label) || toStringValue(input.title);

    if (name === "") {
      throw new TypeError("Packing item name cannot be empty");
    }

    return {
      ...input,
      id: typeof input.id === "string" && input.id.trim() !== "" ? input.id : createId(),
      name,
      completed: Boolean(input.completed),
    };
  }

  throw new TypeError("Packing item must be a string or object");
}

function readPackingItems() {
  const stored = getItem(STORAGE_KEY);

  if (!Array.isArray(stored)) {
    return [];
  }

  return stored
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ...item,
      id: typeof item.id === "string" ? item.id : createId(),
      name: toStringValue(item.name) || toStringValue(item.label) || toStringValue(item.title),
      completed: Boolean(item.completed),
    }))
    .filter((item) => item.name !== "");
}

function writePackingItems(items) {
  setItem(STORAGE_KEY, items);
  return items;
}

function matchesFilter(item, filter) {
  if (filter == null || filter === "all") {
    return true;
  }

  if (typeof filter === "string") {
    if (filter === "completed" || filter === "done") {
      return item.completed;
    }

    if (filter === "pending" || filter === "open" || filter === "incomplete") {
      return !item.completed;
    }
  }

  if (typeof filter === "object") {
    if ("completed" in filter) {
      return Boolean(filter.completed) === item.completed;
    }

    if ("status" in filter && typeof filter.status === "string") {
      return matchesFilter(item, filter.status);
    }
  }

  return true;
}

export function addPackingItem(item) {
  const nextItem = normalizeItem(item);
  const items = readPackingItems();

  return writePackingItems([...items, nextItem]);
}

export function togglePackingItem(id) {
  const items = readPackingItems();
  const nextItems = items.map((item) =>
    item.id === id ? { ...item, completed: !item.completed } : item,
  );

  return writePackingItems(nextItems);
}

export function filterPackingItems(filter = "all") {
  return readPackingItems().filter((item) => matchesFilter(item, filter));
}

export function getPackingProgress() {
  const items = readPackingItems();
  const completed = items.filter((item) => item.completed).length;

  return {
    completed,
    total: items.length,
  };
}
