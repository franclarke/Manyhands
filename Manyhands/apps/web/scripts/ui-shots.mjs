/**
 * UI screenshot harness — captures the core product screens in both themes
 * against a running dev server, using the system Chrome via puppeteer-core.
 *
 * Usage:
 *   node scripts/ui-shots.mjs --base http://localhost:3000 --out ../../docs/ui-audit/screenshots/before [--run <runId>]
 *
 * Captures (dark + light): new-run screen, run-detail screen (when --run is
 * given). Viewport 1440x900. Theme is forced via localStorage before load.
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
const OUT = path.resolve(arg("out", "shots"));
const RUN_ID = arg("run");
const EXTRA = arg("extra"); // optional comma-separated name=path pairs

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (executablePath === undefined) {
  console.error("No Chrome/Edge executable found.");
  process.exit(1);
}

const targets = [{ name: "new-run", route: "/" }];
if (RUN_ID !== null) targets.push({ name: "run-detail", route: `/runs/${RUN_ID}` });
if (EXTRA !== null) {
  for (const pair of EXTRA.split(",")) {
    const [name, route] = pair.split("=");
    if (name && route) targets.push({ name, route });
  }
}

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"]
});

try {
  for (const theme of ["dark", "light"]) {
    for (const target of targets) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument((mode) => {
        window.localStorage.setItem("mh-theme", mode);
      }, theme);
      const url = `${BASE}${target.route}`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
      // Let fonts, React Flow fitView and entrance animations settle.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      const file = path.join(OUT, `${target.name}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(`captured ${file}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
