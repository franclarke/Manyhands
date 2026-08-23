import { getItem, setItem } from "../../storage/store.mjs";
import { listActivities } from "../../itinerary/agenda/agenda.mjs";
import { listStops } from "../../itinerary/stops/stops.mjs";

const STORAGE_KEY = "itinerary:favorites";
const TARGET_STOP = "stop";
const TARGET_ACTIVITY = "activity";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cloneFavorite(favorite) {
  return {
    targetType: favorite.targetType,
    targetId: favorite.targetId,
  };
}

function normalizeTargetType(targetType) {
  if (targetType === TARGET_STOP || targetType === TARGET_ACTIVITY) {
    return targetType;
  }

  throw new TypeError('Favorite targetType must be "stop" or "activity"');
}

function normalizeFavorite(favorite) {
  return {
    targetType: normalizeTargetType(favorite.targetType),
    targetId: String(favorite.targetId),
  };
}

function readFavorites() {
  const favorites = getItem(STORAGE_KEY);

  if (!Array.isArray(favorites)) {
    return [];
  }

  return favorites.map(normalizeFavorite);
}

function writeFavorites(favorites) {
  setItem(STORAGE_KEY, favorites.map(normalizeFavorite));
}

function listTargets(targetType) {
  if (targetType === TARGET_STOP) {
    return listStops();
  }

  if (targetType === TARGET_ACTIVITY) {
    return listActivities();
  }

  throw new TypeError('Favorite targetType must be "stop" or "activity"');
}

function targetExists(targetType, targetId) {
  return listTargets(targetType).some((target) => target.id === String(targetId));
}

function assertTargetExists(targetType, targetId) {
  if (!targetExists(targetType, targetId)) {
    throw new Error("Cannot favorite a missing target");
  }
}

export function listFavorites() {
  return readFavorites().map(cloneFavorite);
}

export function toggleFavorite(targetType, targetId) {
  const normalizedTargetType = normalizeTargetType(targetType);
  const normalizedTargetId = String(targetId);

  assertTargetExists(normalizedTargetType, normalizedTargetId);

  const nextFavorites = readFavorites();
  const index = nextFavorites.findIndex(
    (favorite) =>
      favorite.targetType === normalizedTargetType &&
      favorite.targetId === normalizedTargetId,
  );

  if (index === -1) {
    const nextFavorite = normalizeFavorite({
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
    });

    nextFavorites.push(nextFavorite);
    writeFavorites(nextFavorites);

    return cloneFavorite(nextFavorite);
  }

  const [removedFavorite] = nextFavorites.splice(index, 1);
  writeFavorites(nextFavorites);

  return cloneFavorite(removedFavorite);
}
