import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "app", "globals.css"), "utf8");

// First definition wins: the dark block declares the canonical values these
// dark `--cu-*` surfaces are checked against; the light theme block that
// follows must not overwrite them.
const vars = new Map();
for (const match of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
  if (!vars.has(match[1])) {
    vars.set(match[1], match[2].trim());
  }
}

const surfaces = ["cu-bg", "cu-surface", "cu-surface-2", "cu-surface-3"];
const checks = [
  { token: "color-text", min: 7, label: "primary text" },
  { token: "color-text-muted", min: 4.5, label: "muted functional text" },
  { token: "color-text-subtle", min: 4.5, label: "subtle functional text" },
  { token: "color-accent", min: 4.5, label: "accent text" },
  { token: "color-accent-hover", min: 4.5, label: "accent hover text" },
  { token: "status-idle-fg", min: 4.5, label: "idle status" },
  { token: "status-planning-fg", min: 4.5, label: "planning status" },
  { token: "status-pending-fg", min: 4.5, label: "pending status" },
  { token: "status-ready-fg", min: 4.5, label: "ready status" },
  { token: "status-running-fg", min: 4.5, label: "running status" },
  { token: "status-completed-fg", min: 4.5, label: "completed status" },
  { token: "status-failed-fg", min: 4.5, label: "failed status" },
  { token: "status-blocked-fg", min: 4.5, label: "blocked status" },
  { token: "status-review-fg", min: 4.5, label: "review status" },
  { token: "status-integrating-fg", min: 4.5, label: "integrating status" },
  { token: "status-integrated-fg", min: 4.5, label: "integrated status" },
  { token: "status-conflict-fg", min: 4.5, label: "conflict status" },
  { token: "status-skipped-fg", min: 4.5, label: "skipped status" }
];

const failures = [];

for (const check of checks) {
  const fg = parseColor(resolve(check.token));
  for (const surfaceToken of surfaces) {
    const bg = parseColor(resolve(surfaceToken));
    const actual = contrast(fg, bg);
    if (actual < check.min) {
      failures.push(
        `${check.label} --${check.token} on --${surfaceToken}: ${actual.toFixed(2)} < ${check.min}`
      );
    }
  }
}

const controlBorder = parseColor(resolve("color-border-control"));
for (const surfaceToken of surfaces) {
  const bg = parseColor(resolve(surfaceToken));
  const blended = blend(controlBorder, bg);
  const actual = contrast(blended, bg);
  if (actual < 3) {
    failures.push(`control border on --${surfaceToken}: ${actual.toFixed(2)} < 3`);
  }
}

if (failures.length > 0) {
  console.error("AA+ contrast check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("AA+ contrast check passed.");

function resolve(token, seen = new Set()) {
  if (seen.has(token)) {
    throw new Error(`Circular CSS variable reference: ${[...seen, token].join(" -> ")}`);
  }
  const value = vars.get(token);
  if (value === undefined) {
    throw new Error(`Missing CSS variable --${token}`);
  }
  const varMatch = value.match(/^var\(--([\w-]+)\)$/);
  if (varMatch !== null) {
    return resolve(varMatch[1], new Set([...seen, token]));
  }
  return value;
}

function parseColor(value) {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1
    };
  }

  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba === null) {
    throw new Error(`Unsupported color value: ${value}`);
  }
  const parts = rgba[1].split(",").map((part) => part.trim());
  return {
    r: Number(parts[0]),
    g: Number(parts[1]),
    b: Number(parts[2]),
    a: parts[3] === undefined ? 1 : Number(parts[3])
  };
}

function blend(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  };
}

function contrast(a, b) {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

function luminance(color) {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
