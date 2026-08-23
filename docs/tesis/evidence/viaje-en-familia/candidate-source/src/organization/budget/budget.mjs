import { getItem, setItem } from "../../storage/store.mjs";

const STORAGE_KEY = "organization.budget";

function createEmptySummary() {
  return {
    total: 0,
    spent: 0,
    available: 0,
    byCategory: {},
  };
}

function cloneSummary(summary) {
  return {
    total: summary.total,
    spent: summary.spent,
    available: summary.available,
    byCategory: { ...summary.byCategory },
  };
}

function normalizeSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return createEmptySummary();
  }

  const total = Number.isFinite(summary.total) ? summary.total : 0;
  const spent = Number.isFinite(summary.spent) ? summary.spent : 0;
  const rawByCategory =
    summary.byCategory && typeof summary.byCategory === "object"
      ? summary.byCategory
      : {};

  return {
    total,
    spent,
    available: total - spent,
    byCategory: Object.fromEntries(
      Object.entries(rawByCategory).map(([category, value]) => [
        category,
        Number.isFinite(value) ? value : 0,
      ]),
    ),
  };
}

function loadSummary() {
  return normalizeSummary(getItem(STORAGE_KEY));
}

function saveSummary(summary) {
  setItem(STORAGE_KEY, summary);
}

function updateAvailable(summary) {
  return {
    ...summary,
    available: summary.total - summary.spent,
  };
}

function assertFiniteAmount(amount, name) {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

export function setTotalBudget(total) {
  assertFiniteAmount(total, "total");

  const summary = updateAvailable({
    ...loadSummary(),
    total,
  });

  saveSummary(summary);
}

export function addExpense(category, amount) {
  assertFiniteAmount(amount, "amount");

  const key = String(category);
  const summary = loadSummary();
  const nextCategoryTotal = (summary.byCategory[key] ?? 0) + amount;

  const nextSummary = updateAvailable({
    ...summary,
    spent: summary.spent + amount,
    byCategory: {
      ...summary.byCategory,
      [key]: nextCategoryTotal,
    },
  });

  saveSummary(nextSummary);
}

export function getBudgetSummary() {
  return cloneSummary(loadSummary());
}
