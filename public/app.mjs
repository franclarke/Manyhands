const TRIP_NAME = "Viaje en familia";
const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const MAX_UPCOMING_EVENTS = 3;
const MAX_HIGHLIGHTS = 4;

function readJson(key) {
  const raw = window.localStorage.getItem(key);

  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

function readStops() {
  const stops = readJson("itinerary:stops");

  return Array.isArray(stops) ? stops : [];
}

function readActivities() {
  const activities = readJson("itinerary:agenda");

  return Array.isArray(activities) ? activities : [];
}

function readBudget() {
  const summary = readJson("organization.budget");

  return summary && typeof summary === "object"
    ? summary
    : { total: 0, spent: 0, available: 0, byCategory: {} };
}

function readPackingItems() {
  const items = readJson("organization:packing");

  return Array.isArray(items) ? items : [];
}

function readNotes() {
  const notes = readJson("memories:notes");

  return Array.isArray(notes) ? notes : [];
}

function readFavorites() {
  const favorites = readJson("itinerary:favorites");

  return Array.isArray(favorites) ? favorites : [];
}

function buildStopIndex(stops) {
  return new Map(stops.map((stop, index) => [stop.id, { ...stop, index }]));
}

function buildActivityIndex(stops, activities) {
  const stopIndex = buildStopIndex(stops);

  return new Map(
    activities.map((activity, index) => [
      activity.id,
      {
        ...activity,
        stopName: stopIndex.get(activity.stopId)?.name ?? "Parada sin nombre",
        index,
      },
    ]),
  );
}

function buildTripSummary(stops) {
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  return {
    name: TRIP_NAME,
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

  return visibleActivities.slice(0, MAX_UPCOMING_EVENTS);
}

function buildHighlights(stops, activities) {
  const stopIndex = buildStopIndex(stops);
  const activityIndex = buildActivityIndex(stops, activities);
  const notes = readNotes().map((note) => ({
    ...note,
    label:
      note.day !== undefined
        ? `Día ${note.day}`
        : stopIndex.get(note.stopId)?.name ?? "Parada destacada",
  }));
  const favorites = readFavorites().map((favorite) => ({
    ...favorite,
    label:
      favorite.targetType === "stop"
        ? stopIndex.get(favorite.targetId)?.name ?? "Parada destacada"
        : `${activityIndex.get(favorite.targetId)?.time ?? "Sin hora"} · ${
            activityIndex.get(favorite.targetId)?.stopName ?? "Actividad destacada"
          }`,
  }));

  return [
    ...notes.slice(0, 2).map((note) => ({
      kind: "note",
      label: note.label,
      text: note.text,
    })),
    ...favorites.slice(0, 2).map((favorite) => ({
      kind: "favorite",
      label: favorite.label,
      targetType: favorite.targetType,
    })),
  ].slice(0, MAX_HIGHLIGHTS);
}

function buildBudgetSummary() {
  const summary = readBudget();
  const categories = Object.entries(summary.byCategory ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([category, amount]) => ({
      category,
      amount,
      share: summary.spent > 0 ? Math.round((amount / summary.spent) * 100) : 0,
    }));

  return {
    total: Number(summary.total) || 0,
    spent: Number(summary.spent) || 0,
    available: Number(summary.available) || 0,
    ratio: Number(summary.total) > 0 ? Number(summary.spent) / Number(summary.total) : 0,
    categories,
  };
}

function buildPackingSummary() {
  const items = readPackingItems();
  const completed = items.filter((item) => item.completed).length;

  return {
    completed,
    total: items.length,
    ratio: items.length > 0 ? completed / items.length : 0,
  };
}

function createStatCard(label, value, helper, accent) {
  const card = createElement("article", "stat-card");
  card.style.setProperty("--accent", accent);
  const labelNode = createElement("p", "stat-label", label);
  const valueNode = createElement("strong", "stat-value", value);
  const helperNode = createElement("p", "stat-helper", helper);

  card.append(labelNode, valueNode, helperNode);
  return card;
}

function renderList(items, emptyLabel, createItem) {
  const list = createElement("ul", "stack-list");

  if (items.length === 0) {
    const empty = createElement("li", "empty-state", emptyLabel);
    list.append(empty);
    return list;
  }

  for (const item of items) {
    list.append(createItem(item));
  }

  return list;
}

function renderDashboard() {
  const stops = readStops();
  const activities = readActivities();
  const trip = buildTripSummary(stops);
  const upcomingEvents = buildUpcomingEvents(stops, activities);
  const budget = buildBudgetSummary();
  const packing = buildPackingSummary();
  const highlights = buildHighlights(stops, activities);

  const app = document.getElementById("app");
  app.replaceChildren();

  const shell = createElement("div", "dashboard-shell");
  const skipLink = createElement("a", "skip-link", "Saltar al contenido");
  skipLink.href = "#dashboard-main";
  shell.append(skipLink);

  const canvas = createElement("div", "dashboard-canvas");
  const header = createElement("header", "hero-panel");
  const heroCopy = createElement("div", "hero-copy");
  heroCopy.append(
    createElement("p", "eyebrow", "Presentación del viaje"),
    Object.assign(createElement("h1", "hero-title"), { textContent: trip.name }),
    Object.assign(createElement("p", "hero-date"), { textContent: trip.dateLabel }),
  );

  const heroMeta = createElement("div", "hero-meta");
  heroMeta.append(
    createStatCard("Eventos", `${upcomingEvents.length}`, "Próximas actividades visibles", "#f4a261"),
    createStatCard(
      "Presupuesto",
      `${budget.spent}/${budget.total}`,
      `Disponible ${budget.available}`,
      "#8ecae6",
    ),
    createStatCard(
      "Equipaje",
      `${packing.completed}/${packing.total}`,
      "Progreso total de preparación",
      "#7bdcb5",
    ),
  );

  const quickActions = createElement("nav", "quick-actions");
  quickActions.setAttribute("aria-label", "Secciones del dashboard");
  const actionData = [
    ["Eventos", "#events"],
    ["Presupuesto", "#budget"],
    ["Equipaje", "#packing"],
    ["Recuerdos", "#memories"],
  ];
  for (const [label, href] of actionData) {
    const link = createElement("a", "chip-link", label);
    link.href = href;
    quickActions.append(link);
  }

  const refreshButton = createElement("button", "refresh-button", "Actualizar");
  refreshButton.type = "button";
  refreshButton.addEventListener("click", renderDashboard);

  header.append(heroCopy, heroMeta, quickActions, refreshButton);

  const main = createElement("main", "dashboard-grid");
  main.id = "dashboard-main";

  const eventsSection = createElement("section", "panel card");
  eventsSection.id = "events";
  eventsSection.append(
    createElement("p", "section-kicker", "Agenda"),
    createElement("h2", "section-title", "Próximos eventos"),
    renderList(upcomingEvents, "Todavía no hay eventos cargados.", (event) => {
      const item = createElement("li", "list-item");
      item.append(
        createElement("strong", "item-title", event.stopName),
        createElement("p", "item-meta", `${event.day} · ${event.time}`),
        createElement("p", "item-meta item-status", event.status === "done" ? "Completado" : "Pendiente"),
      );
      return item;
    }),
  );

  const budgetSection = createElement("section", "panel card");
  budgetSection.id = "budget";
  const budgetTrack = createElement("div", "progress-track");
  const budgetFill = createElement("div", "progress-fill");
  budgetFill.style.width = `${Math.max(0, Math.min(100, Math.round(budget.ratio * 100)))}%`;
  budgetTrack.append(budgetFill);
  budgetSection.append(
    createElement("p", "section-kicker", "Presupuesto"),
    createElement("h2", "section-title", "Resumen del presupuesto"),
    createElement("p", "panel-lead", `Gastado ${budget.spent} de ${budget.total}. Disponible ${budget.available}.`),
    budgetTrack,
    renderList(budget.categories, "Todavía no hay gastos registrados.", (category) => {
      const item = createElement("li", "list-item");
      const row = createElement("div", "item-row");
      row.append(
        createElement("strong", "item-title", category.category),
        createElement("span", "item-pill", `${category.share}%`),
      );
      item.append(row, createElement("p", "item-meta", `${category.amount} gastados`));
      return item;
    }),
  );

  const packingSection = createElement("section", "panel card");
  packingSection.id = "packing";
  const packingTrack = createElement("div", "progress-track");
  const packingFill = createElement("div", "progress-fill progress-fill-alt");
  packingFill.style.width = `${Math.max(0, Math.min(100, Math.round(packing.ratio * 100)))}%`;
  packingTrack.append(packingFill);
  packingSection.append(
    createElement("p", "section-kicker", "Equipaje"),
    createElement("h2", "section-title", "Progreso de equipaje"),
    createElement("p", "panel-lead", `Llevas ${packing.completed} de ${packing.total} elementos listos.`),
    packingTrack,
    createElement("p", "progress-caption", `${Math.round(packing.ratio * 100)}% completado`),
  );

  const memoriesSection = createElement("section", "panel card card-wide");
  memoriesSection.id = "memories";
  const highlightsList = renderList(highlights, "Aún no hay recuerdos destacados.", (highlight) => {
    const item = createElement("li", "memory-card");
    item.append(
      createElement("span", "memory-tag", highlight.kind === "note" ? "Nota" : "Favorito"),
      createElement("strong", "item-title", highlight.label),
    );

    if (highlight.text) {
      item.append(createElement("p", "item-meta", highlight.text));
    }

    return item;
  });
  memoriesSection.append(
    createElement("p", "section-kicker", "Recuerdos"),
    createElement("h2", "section-title", "Recuerdos destacados"),
    highlightsList,
  );

  const notesSection = createElement("section", "panel card");
  notesSection.append(
    createElement("p", "section-kicker", "Notas"),
    createElement("h2", "section-title", "Notas del viaje"),
    renderList(
      readNotes(),
      "No hay notas todavía.",
      (note) => {
        const item = createElement("li", "list-item");
        item.append(
          createElement("strong", "item-title", note.text),
          createElement("p", "item-meta", note.day !== undefined ? `Día ${note.day}` : "Parada"),
        );
        return item;
      },
    ),
  );

  const favoritesSection = createElement("section", "panel card");
  favoritesSection.append(
    createElement("p", "section-kicker", "Favoritos"),
    createElement("h2", "section-title", "Marcados como favoritos"),
    renderList(
      readFavorites(),
      "Todavía no hay favoritos.",
      (favorite) => {
        const item = createElement("li", "list-item");
        const label =
          favorite.targetType === "stop"
            ? `Parada`
            : `Actividad`;
        const stop = stops.find((stopItem) => stopItem.id === favorite.targetId);
        const activity = activities.find((activityItem) => activityItem.id === favorite.targetId);
        const detail =
          favorite.targetType === "stop"
            ? stop?.name ?? favorite.targetId
            : `${activity?.time ?? "Sin hora"} · ${stop?.name ?? "Actividad"}`;

        item.append(
          createElement("strong", "item-title", detail),
          createElement("p", "item-meta", label),
        );
        return item;
      },
    ),
  );

  main.append(eventsSection, budgetSection, packingSection, memoriesSection, notesSection, favoritesSection);
  canvas.append(header, main);
  shell.append(canvas);
  app.append(shell);
}

if (typeof window !== "undefined" && window.document) {
  renderDashboard();
  window.addEventListener("storage", renderDashboard);
}
