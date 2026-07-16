import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const options = parseOptions(process.argv.slice(2));
const cssPath = resolve(options.css ?? join(ROOT, "apps", "web", "src", "app", "globals.css"));
const sourcePath = resolve(options.source ?? join(ROOT, "apps", "web", "src"));

const declarations = new Set(
  [...readFileSync(cssPath, "utf8").matchAll(/--([A-Za-z0-9_-]+)\s*:/g)].map((match) => `--${match[1]}`)
);
const references = new Map();

for (const file of sourceFiles(sourcePath)) {
  const content = withoutComments(readFileSync(file, "utf8"));
  for (const match of content.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,|\))/g)) {
    const token = match[1];
    if (declarations.has(token)) continue;
    const line = content.slice(0, match.index).split("\n").length;
    const locations = references.get(token) ?? [];
    locations.push(`${file}:${line}`);
    references.set(token, locations);
  }
}

function withoutComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

if (references.size > 0) {
  const details = [...references]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([token, locations]) => `- ${token}: ${locations.join(", ")}`)
    .join("\n");
  console.error(`Undefined custom properties:\n${details}`);
  process.exit(1);
}

console.log(`Token check passed (${declarations.size} declarations; ${sourceFiles(sourcePath).length} source files).`);

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--css" && flag !== "--source") || value === undefined) {
      throw new Error("Usage: node scripts/token-check.mjs [--css <file>] [--source <file-or-directory>]");
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

function sourceFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(entryPath));
    else if ([".css", ".ts", ".tsx"].includes(extname(entry.name))) files.push(entryPath);
  }
  return files;
}
