import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * AA+ contrast gate for BOTH themes. Parses the dark block (`:root,
 * [data-theme="dark"]`) and the light block (`[data-theme="light"]`) out of
 * globals.css and checks every functional foreground against every surface of
 * its own theme. Supports #hex, rgb()/rgba() and oklch() color values.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "app", "globals.css"), "utf8");

// Anchor on the SELECTOR (start of line), not on mentions inside comments.
const lightSelector = css.match(/^\[data-theme="light"\]\s*\{/m);
if (lightSelector === null) {
  throw new Error('Missing [data-theme="light"] block in globals.css');
}
const darkCss = css.slice(0, lightSelector.index);
const lightCss = css.slice(lightSelector.index);

function collectVars(source) {
  const map = new Map();
  for (const match of source.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (!map.has(match[1])) {
      map.set(match[1], match[2].trim());
    }
  }
  return map;
}

const darkVars = collectVars(darkCss);
const lightVars = collectVars(lightCss);

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

for (const [themeName, themeVars] of [
  ["dark", darkVars],
  ["light", lightVars]
]) {
  // Theme-agnostic primitives (fonts, radii) only exist in the dark/:root scan.
  const lookup = (token) => themeVars.get(token) ?? darkVars.get(token);

  for (const check of checks) {
    const fg = parseColor(resolve(check.token, lookup));
    for (const surfaceToken of surfaces) {
      const bg = parseColor(resolve(surfaceToken, lookup));
      const actual = contrast(fg, bg);
      if (actual < check.min) {
        failures.push(
          `[${themeName}] ${check.label} --${check.token} on --${surfaceToken}: ${actual.toFixed(2)} < ${check.min}`
        );
      }
    }
  }

  // Filled primary actions: label on the accent surface itself.
  const accent = parseColor(resolve("color-accent", lookup));
  const accentContrast = parseColor(resolve("color-accent-contrast", lookup));
  const onAccent = contrast(accentContrast, accent);
  if (onAccent < 4.5) {
    failures.push(`[${themeName}] accent-contrast on --color-accent: ${onAccent.toFixed(2)} < 4.5`);
  }

  const controlBorder = parseColor(resolve("color-border-control", lookup));
  for (const surfaceToken of surfaces) {
    const bg = parseColor(resolve(surfaceToken, lookup));
    const blended = blend(controlBorder, bg);
    const actual = contrast(blended, bg);
    if (actual < 3) {
      failures.push(`[${themeName}] control border on --${surfaceToken}: ${actual.toFixed(2)} < 3`);
    }
  }
}

if (failures.length > 0) {
  console.error("AA+ contrast check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("AA+ contrast check passed (dark + light).");

function resolve(token, lookup, seen = new Set()) {
  if (seen.has(token)) {
    throw new Error(`Circular CSS variable reference: ${[...seen, token].join(" -> ")}`);
  }
  const value = lookup(token);
  if (value === undefined) {
    throw new Error(`Missing CSS variable --${token}`);
  }
  const varMatch = value.match(/^var\(--([\w-]+)\)$/);
  if (varMatch !== null) {
    return resolve(varMatch[1], lookup, new Set([...seen, token]));
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

  const oklch = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (oklch !== null) {
    const alpha = oklch[4] === undefined ? 1 : oklch[4].endsWith("%") ? Number(oklch[4].slice(0, -1)) / 100 : Number(oklch[4]);
    return { ...oklchToSrgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3])), a: alpha };
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

function oklchToSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const linR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linB = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const encode = (channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  };

  return { r: encode(linR), g: encode(linG), b: encode(linB) };
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
