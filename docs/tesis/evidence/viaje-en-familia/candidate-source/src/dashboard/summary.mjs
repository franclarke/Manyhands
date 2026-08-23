import { listActivities } from "../itinerary/agenda/agenda.mjs";
import { listFavorites } from "../memories/favorites/favorites.mjs";
import { listNotes } from "../memories/notes/notes.mjs";
import { getBudgetSummary } from "../organization/budget/budget.mjs";
import { getPackingProgress } from "../organization/packing/packing.mjs";
import { listStops } from "../itinerary/stops/stops.mjs";

const TRIP_NAME = "Viaje en familia";
const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const MAX_UPCOMING_EVENTS = 3;
const MAX_HIGHLIGHTS = 4;

function parseIsoDate(value) {
  if (typeof value !== "string") {
    return null;
  }

  const parts = value.split("-");

  if (parts.length !== 3) {
    return null;
  }

  const [yearText, monthText, dayText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

function formatIsoDate(value) {
  const date = parseIsoDate(value);

  if (!date) {
    return "";
  }

  return `${date.day} ${MONTH_LABELS[date.month - 1]} ${date.year}`;
}

function formatDateRange(startDate, endDate) {
  const start = formatIsoDate(startDate);
  const end = formatIsoDate(endDate);

  if (start && end) {
    return `${start} - ${end}`;
  }

  if (start) {
    return start;
  }

  if (end) {
    return end;
  }

  return "Fechas por definir";
}

function buildStopIndex(stops) {
  return new Map(stops.map((stop, index) => [stop.id, { ...stop, index }]));
}

function buildTripSummary(stops) {
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  return {
    name: TRIP_NAME,
    startDate: firstStop?.startDate ?? "",
    endDate: lastStop?.endDate ?? "",
    dateLabel: formatDateRange(firstStop?.startDate, lastStop?.endDate),
  };
}

function buildUpcomingEvents(stops, activities) {
  const stopIndex = buildStopIndex(stops);
  const rankedActivities = activities
    .map((activity, index) => {
      const stop = stopIndex.get(activity.stopId);

      return {
        ...activity,
        stopName: stop?.name ?? "Parada sin nombre",
        stopIndex: stop?.index ?? Number.POSITIVE_INFINITY,
        activityIndex: index,
      };
    })
    .sort((left, right) => {
      if (left.stopIndex !== right.stopIndex) {
        return left.stopIndex - right.stopIndex;
      }

      if (left.day !== right.day) {
        return String(left.day).localeCompare(String(right.day));
      }

      if (left.time !== right.time) {
        return String(left.time).localeCompare(String(right.time));
      }

      return left.activityIndex - right.activityIndex;
    });

  const pendingActivities = rankedActivities.filter((activity) => activity.status === "pending");
  const visibleActivities = pendingActivities.length > 0 ? pendingActivities : rankedActivities;

  return visibleActivities.slice(0, MAX_UPCOMING_EVENTS).map((activity) => ({
    id: activity.id,
    stopId: activity.stopId,
    stopName: activity.stopName,
    day: activity.day,
    time: activity.time,
    status: activity.status,
    label: `${activity.time} · ${activity.stopName}`,
  }));
}

function formatBudgetCategoryLabel(category, amount, total) {
  const share = total > 0 ? Math.round((amount / total) * 100) : 0;

  return {
    category,
    amount,
    share,
    label: `${category} · ${amount}`,
  };
}

function buildBudgetSummary() {
  const summary = getBudgetSummary();
  const categories = Object.entries(summary.byCategory)
    .sort((left, right) => {
      const amountDifference = right[1] - left[1];

      if (amountDifference !== 0) {
        return amountDifference;
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([category, amount]) => formatBudgetCategoryLabel(category, amount, summary.spent));

  return {
    total: summary.total,
    spent: summary.spent,
    available: summary.available,
    ratio: summary.total > 0 ? summary.spent / summary.total : 0,
    spentLabel: String(summary.spent),
    totalLabel: String(summary.total),
    availableLabel: String(summary.available),
    categories,
  };
}

function buildPackingSummary() {
  const progress = getPackingProgress();

  return {
    completed: progress.completed,
    total: progress.total,
    ratio: progress.total > 0 ? progress.completed / progress.total : 0,
    label: `${progress.completed}/${progress.total}`,
  };
}

function describeNote(note, stopIndex) {
  if (note.day !== undefined) {
    return `Día ${note.day}`;
  }

  const stop = stopIndex.get(note.stopId);

  return stop?.name ?? "Parada destacada";
}

function describeFavorite(favorite, stopIndex, activityIndex) {
  if (favorite.targetType === "stop") {
    const stop = stopIndex.get(favorite.targetId);

    return stop?.name ?? "Parada destacada";
  }

  const activity = activityIndex.get(favorite.targetId);

  if (!activity) {
    return "Actividad destacada";
  }

  return `${activity.time} · ${activity.stopName}`;
}

function buildMemoriesSummary(stops, activities) {
  const stopIndex = buildStopIndex(stops);
  const activityIndex = new Map(
    activities.map((activity, index) => [
      activity.id,
      {
        ...activity,
        stopName: stopIndex.get(activity.stopId)?.name ?? "Parada sin nombre",
        index,
      },
    ]),
  );

  const notes = listNotes().map((note) => ({
    id: note.id,
    text: note.text,
    label: describeNote(note, stopIndex),
  }));

  const favorites = listFavorites().map((favorite) => ({
    targetType: favorite.targetType,
    targetId: favorite.targetId,
    label: describeFavorite(favorite, stopIndex, activityIndex),
  }));

  const highlights = [
    ...notes.slice(0, 2).map((note) => ({
      kind: "note",
      id: note.id,
      label: note.label,
      text: note.text,
    })),
    ...favorites.slice(0, 2).map((favorite) => ({
      kind: "favorite",
      targetType: favorite.targetType,
      targetId: favorite.targetId,
      label: favorite.label,
    })),
  ].slice(0, MAX_HIGHLIGHTS);

  return {
    notes,
    favorites,
    highlights,
  };
}

export function buildDashboardSummary() {
  const stops = listStops();
  const activities = listActivities();

  return {
    trip: buildTripSummary(stops),
    upcomingEvents: buildUpcomingEvents(stops, activities),
    budget: buildBudgetSummary(),
    packing: buildPackingSummary(),
    memories: buildMemoriesSummary(stops, activities),
  };
}
