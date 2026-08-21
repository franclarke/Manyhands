const listenersByKey = new Map();
let storageEventBound = false;

function getStorage() {
  const storage = globalThis.localStorage;

  if (!storage) {
    throw new Error("localStorage is not available");
  }

  return storage;
}

function serialize(value) {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError("Value must be JSON serializable");
  }

  return serialized;
}

function emit(key, serializedValue) {
  const listeners = listenersByKey.get(key);

  if (!listeners || listeners.size === 0) {
    return;
  }

  const value = serializedValue === null ? null : JSON.parse(serializedValue);

  for (const listener of listeners) {
    listener(value);
  }
}

function bindStorageEvents() {
  if (storageEventBound) {
    return;
  }

  const target = globalThis.window;

  if (!target || typeof target.addEventListener !== "function") {
    return;
  }

  target.addEventListener("storage", (event) => {
    if (event.storageArea !== globalThis.localStorage) {
      return;
    }

    if (event.key == null) {
      return;
    }

    emit(event.key, event.newValue);
  });

  storageEventBound = true;
}

export function getItem(key) {
  const serialized = getStorage().getItem(key);

  if (serialized === null) {
    return null;
  }

  return JSON.parse(serialized);
}

export function setItem(key, value) {
  const serialized = serialize(value);
  getStorage().setItem(key, serialized);
  emit(key, serialized);
}

export function subscribe(key, listener) {
  bindStorageEvents();

  let listeners = listenersByKey.get(key);

  if (!listeners) {
    listeners = new Set();
    listenersByKey.set(key, listeners);
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      listenersByKey.delete(key);
    }
  };
}
