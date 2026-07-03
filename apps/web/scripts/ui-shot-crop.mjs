/**
 * Detail crops of a single route for visual review (left/right halves or a
 * custom clip). Companion to ui-shots.mjs.
 *
 * Usage:
 *   node scripts/ui-shot-crop.mjs --base <url> --route /runs/<id> --theme dark --out <dir> --name run-left --clip 0,0,720,900
 */
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index === args.length - 1) return fallback;
  return args[index + 1];
}

const BASE = arg("base", "http://localhost:3000");
const ROUTE = arg("route", "/");
const THEME = arg("theme", "dark");
const OUT = path.resolve(arg("out", "shots"));
const NAME = arg("name", "crop");
const CLIP = arg("clip", "0,0,720,900").split(",").map(Number);
const SETTLE = Number(arg("settle", "2500"));
const CLICK = arg("click"); // optional CSS selector to click before shooting

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: "new", args: ["--hide-scrollbars"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((mode) => window.localStorage.setItem("mh-theme", mode), THEME);
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle2", timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, SETTLE));
  if (CLICK !== null) {
    await page.click(CLICK);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  const [x, y, width, height] = CLIP;
  const file = path.join(OUT, `${NAME}-${THEME}.png`);
  await page.screenshot({ path: file, clip: { x, y, width, height } });
  console.log(`captured ${file}`);
} finally {
  await browser.close();
}
