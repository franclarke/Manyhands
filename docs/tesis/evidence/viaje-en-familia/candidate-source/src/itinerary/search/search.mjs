import { listActivities } from "../agenda/agenda.mjs";
import { listStops } from "../stops/stops.mjs";

function normalizeQuery(query) {
  return String(query ?? "").trim().toLowerCase();
}

function hasFilterValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function matchesQuery(value, query) {
  if (!query) {
    return true;
  }

  return String(value ?? "").toLowerCase().includes(query);
}

function matchesStop(stop, query, filters) {
  if (hasFilterValue(filters.stopId) && stop.id !== String(filters.stopId)) {
    return false;
  }

  return (
    matchesQuery(stop.id, query) ||
    matchesQuery(stop.name, query) ||
    matchesQuery(stop.startDate, query) ||
    matchesQuery(stop.endDate, query) ||
    matchesQuery(stop.description, query)
  );
}

function matchesActivity(activity, query, filters) {
  if (hasFilterValue(filters.stopId) && activity.stopId !== String(filters.stopId)) {
    return false;
  }

  if (hasFilterValue(filters.day) && activity.day !== filters.day) {
    return false;
  }

  if (hasFilterValue(filters.status) && activity.status !== filters.status) {
    return false;
  }

  return (
    matchesQuery(activity.id, query) ||
    matchesQuery(activity.stopId, query) ||
    matchesQuery(activity.day, query) ||
    matchesQuery(activity.time, query) ||
    matchesQuery(activity.status, query)
  );
}

export function searchItinerary(query, filters = {}) {
  const normalizedQuery = normalizeQuery(query);
  const stops = listStops();
  const activities = listActivities();
  const activitiesByStopId = new Map();

  for (const activity of activities) {
    const nextActivities = activitiesByStopId.get(activity.stopId) ?? [];
    nextActivities.push(activity);
    activitiesByStopId.set(activity.stopId, nextActivities);
  }

  const results = [];

  for (const stop of stops) {
    const matchingActivities = activitiesByStopId.get(stop.id) ?? [];
    const matchedActivities = matchingActivities.filter((activity) =>
      matchesActivity(activity, normalizedQuery, filters),
    );

    if (matchesStop(stop, normalizedQuery, filters)) {
      results.push({ ...stop });
    }

    for (const activity of matchedActivities) {
      results.push({ ...activity });
    }
  }

  return results;
}
