import { getItem, setItem } from "../../storage/store.mjs";
import { listStops } from "../stops/stops.mjs";

const STORAGE_KEY = "itinerary:agenda";
const STATUS_PENDING = "pending";
const STATUS_DONE = "done";

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `activity_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cloneActivity(activity) {
  return {
    id: activity.id,
    stopId: activity.stopId,
    day: activity.day,
    time: activity.time,
    status: activity.status,
  };
}

function normalizeStatus(status) {
  if (status === STATUS_PENDING || status === STATUS_DONE) {
    return status;
  }

  throw new TypeError('Activity status must be "pending" or "done"');
}

function normalizeActivity(activity) {
  return {
    id: String(activity.id),
    stopId: String(activity.stopId),
    day: activity.day,
    time: activity.time,
    status: normalizeStatus(activity.status),
  };
}

function readActivities() {
  const activities = getItem(STORAGE_KEY);

  if (!Array.isArray(activities)) {
    return [];
  }

  return activities.map(normalizeActivity);
}

function writeActivities(activities) {
  setItem(STORAGE_KEY, activities.map(normalizeActivity));
}

function stopExists(stopId) {
  return listStops().some((stop) => stop.id === String(stopId));
}

function assertExistingStop(stopId) {
  if (!stopExists(stopId)) {
    throw new Error("Cannot associate activity to a missing stop");
  }
}

function assertValidStatus(status) {
  normalizeStatus(status);
}

export function listActivities() {
  return readActivities().map(cloneActivity);
}

export function createActivity(activity) {
  assertExistingStop(activity.stopId);

  const nextActivity = normalizeActivity({
    id: createId(),
    stopId: activity.stopId,
    day: activity.day,
    time: activity.time,
    status: hasOwn(activity, "status") ? activity.status : STATUS_PENDING,
  });

  const nextActivities = readActivities();
  nextActivities.push(nextActivity);
  writeActivities(nextActivities);

  return cloneActivity(nextActivity);
}

export function updateActivity(id, updates) {
  const nextActivities = readActivities();
  const index = nextActivities.findIndex((activity) => activity.id === id);

  if (index === -1) {
    return null;
  }

  const currentActivity = nextActivities[index];
  const nextStopId = hasOwn(updates, "stopId") ? updates.stopId : currentActivity.stopId;

  assertExistingStop(nextStopId);

  const nextStatus = hasOwn(updates, "status") ? updates.status : currentActivity.status;
  assertValidStatus(nextStatus);

  const nextActivity = normalizeActivity({
    id: currentActivity.id,
    stopId: nextStopId,
    day: hasOwn(updates, "day") ? updates.day : currentActivity.day,
    time: hasOwn(updates, "time") ? updates.time : currentActivity.time,
    status: nextStatus,
  });

  nextActivities[index] = nextActivity;
  writeActivities(nextActivities);

  return cloneActivity(nextActivity);
}

export function removeActivity(id) {
  const nextActivities = readActivities();
  const index = nextActivities.findIndex((activity) => activity.id === id);

  if (index === -1) {
    return null;
  }

  const [removedActivity] = nextActivities.splice(index, 1);
  writeActivities(nextActivities);

  return cloneActivity(removedActivity);
}

export function toggleActivityStatus(id) {
  const nextActivities = readActivities();
  const index = nextActivities.findIndex((activity) => activity.id === id);

  if (index === -1) {
    return null;
  }

  const currentActivity = nextActivities[index];
  const nextActivity = normalizeActivity({
    id: currentActivity.id,
    stopId: currentActivity.stopId,
    day: currentActivity.day,
    time: currentActivity.time,
    status: currentActivity.status === STATUS_DONE ? STATUS_PENDING : STATUS_DONE,
  });

  nextActivities[index] = nextActivity;
  writeActivities(nextActivities);

  return cloneActivity(nextActivity);
}
