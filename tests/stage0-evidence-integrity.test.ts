import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const AUDIT_ROOT = path.join(REPO_ROOT, "docs", "audits", "stage-0");
const LOG_ROOT = path.join(AUDIT_ROOT, "logs");

type EvidenceIndex = {
  schemaVersion: number;
  entries: Array<{
    logFile: string;
    candidateCommit: string | null;
    exactCommand: string | null;
    workingDirectory: string | null;
    exitCode: number | null;
    classification: string;
    usedForGateClaim: boolean;
    disposition: string;
  }>;
};

describe("Stage 0 evidence integrity", () => {
  it("covers every retained log with a matching digest and attribution record", async () => {
    const [logEntries, manifestText, indexText] = await Promise.all([
      readdir(LOG_ROOT, { withFileTypes: true }),
      readFile(path.join(AUDIT_ROOT, "logs.sha256"), "utf8"),
      readFile(path.join(AUDIT_ROOT, "evidence-index.json"), "utf8")
    ]);
    const unexpectedEntries = logEntries
      .filter((entry) => !entry.isFile() || !entry.name.endsWith(".log"))
      .map((entry) => entry.name)
      .sort();
    expect(unexpectedEntries).toEqual([]);
    const retainedLogs = logEntries.map((entry) => entry.name).sort();
    const manifest = parseManifest(manifestText);
    const index = JSON.parse(indexText) as EvidenceIndex;
    const indexedLogs = index.entries.map((entry) => entry.logFile).sort();

    expect(index.schemaVersion).toBe(1);
    expect(manifest.size).toBe(manifestText.split(/\r?\n/u).filter(Boolean).length);
    expect(new Set(indexedLogs).size).toBe(indexedLogs.length);
    expect([...manifest.keys()].sort()).toEqual(retainedLogs);
    expect(indexedLogs).toEqual(retainedLogs);

    for (const file of retainedLogs) {
      const bytes = await readFile(path.join(LOG_ROOT, file));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(manifest.get(file));
    }

    for (const entry of index.entries) {
      expect(entry.classification.length, entry.logFile).toBeGreaterThan(0);
      expect(entry.disposition.length, entry.logFile).toBeGreaterThan(0);
      if (entry.usedForGateClaim) {
        expect(entry.candidateCommit, entry.logFile).toMatch(/^[0-9a-f]{40}$/u);
        expect(entry.exactCommand?.length, entry.logFile).toBeGreaterThan(0);
        expect(entry.workingDirectory?.length, entry.logFile).toBeGreaterThan(0);
        expect(entry.exitCode, entry.logFile).not.toBeNull();
      }
    }
  });

  it("does not retain common credential forms in raw logs", async () => {
    const logEntries = await readdir(LOG_ROOT, { withFileTypes: true });
    const unexpectedEntries = logEntries
      .filter((entry) => !entry.isFile() || !entry.name.endsWith(".log"))
      .map((entry) => entry.name)
      .sort();
    expect(unexpectedEntries).toEqual([]);
    const logFiles = logEntries.map((entry) => entry.name);
    const credentialPatterns = [
      /(?<![A-Za-z0-9])(?:api[_-]?key|access[_-]?token|authorization|bearer|password|secret)\s*[:=]\s*[^\s"']{8,}/giu,
      /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/gu,
      /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/giu,
      /-----BEGIN [A-Z ]+ PRIVATE KEY-----/gu
    ];
    const findings: string[] = [];

    for (const file of logFiles) {
      const bytes = await readFile(path.join(LOG_ROOT, file));
      const views = [
        bytes.toString("utf8"),
        bytes.toString("utf8").replaceAll("\0", ""),
        bytes.toString("utf16le").replaceAll("\0", ""),
        bytes.toString("latin1").replaceAll("\0", "")
      ];
      for (const [viewIndex, text] of views.entries()) {
        for (const pattern of credentialPatterns) {
          if (pattern.test(text)) {
            findings.push(`${file}[view=${viewIndex}]: ${pattern.source}`);
          }
          pattern.lastIndex = 0;
        }
      }
    }

    expect(findings).toEqual([]);
  });
});

function parseManifest(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/u).filter(Boolean)) {
    const match = /^([0-9a-f]{64}) {2}([^/\\]+\.log)$/u.exec(line);
    if (!match) {
      throw new Error(`Invalid logs.sha256 entry: ${line}`);
    }
    if (entries.has(match[2])) {
      throw new Error(`Duplicate logs.sha256 entry: ${match[2]}`);
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}
