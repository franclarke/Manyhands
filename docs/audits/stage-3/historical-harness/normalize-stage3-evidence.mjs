import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = "C:/mh-stage3-gr-4e495abd";
const target = "docs/audits/stage-3/evidence";
const files = [
  "candidate-receipt.json",
  "browser-cancel.json",
  "browser-create.json",
  "builds.log",
  "daemon-after-restart.err",
  "daemon-after-restart.out",
  "daemon-restart.json",
  "daemon.err",
  "daemon.out",
  "full-suite.log",
  "gate-state.json",
  "gd0-gd1.log",
  "lint-pass.log",
  "lint.log",
  "next-restart.json",
  "query-purity.json",
  "recovery.json",
  "rust.log",
  "shutdown.json",
  "sse-after-9.txt",
  "sse-summary.json",
  "stage3-focused.log",
  "terminal.json",
  "typechecks.log"
];

for (const file of files) {
  await copyText(path.join(source, file), path.join(target, file));
}

const runs = await readdir(path.join(source, "daemon/runs"));
const journal = runs.find((file) => file.endsWith(".events.v2.jsonl"));
if (journal === undefined) throw new Error("Missing canonical journal.");
await copyText(
  path.join(source, "daemon/runs", journal),
  path.join(target, "canonical-run.events.v2.jsonl")
);

const receipts = await readdir(path.join(source, "daemon/effects/receipts"));
for (const receipt of receipts) {
  await copyText(
    path.join(source, "daemon/effects/receipts", receipt),
    path.join(target, "receipts", receipt)
  );
}

async function copyText(from, to) {
  const bytes = await readFile(from);
  const text = decode(bytes)
    .replaceAll("\r", "")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n+$/u, "\n");
  await writeFile(to, text, "utf8");
}

function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  return bytes.toString("utf8");
}
