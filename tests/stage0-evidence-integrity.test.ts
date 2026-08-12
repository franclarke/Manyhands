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
  qualificationPolicy: {
    requiredReceiptIds: string[];
    closureParentMustEqualCandidate: boolean;
    closureAllowedPaths: string[];
  };
  candidateDispositions: Array<{
    candidateCommit: string;
    status: string;
    qualificationLogFiles?: string[];
  }>;
  entries: Array<{
    logFile: string;
    candidateCommit: string | null;
    exactCommand: string | null;
    receiptId?: string | null;
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
    const requiredReceiptIds = [
      "setup",
      "codex-strict-preflight",
      "source-api-routes",
      "source-pipeline-hosts",
      "source-legacy-route",
      "source-integration-validation",
      "source-benchmark-markers",
      "source-legacy-imports",
      "clean-install",
      "stage0-contracts",
      "focused-route",
      "full-tests",
      "package-typechecks",
      "package-build",
      "web-typecheck",
      "web-build",
      "lint",
      "final-identity"
    ];
    expect(index.qualificationPolicy.requiredReceiptIds).toEqual(requiredReceiptIds);
    expect(index.qualificationPolicy.closureParentMustEqualCandidate).toBe(true);
    expect(index.qualificationPolicy.closureAllowedPaths.length).toBeGreaterThan(0);
    expect(manifest.size).toBe(manifestText.split(/\r?\n/u).filter(Boolean).length);
    expect(new Set(indexedLogs).size).toBe(indexedLogs.length);
    expect([...manifest.keys()].sort()).toEqual(retainedLogs);
    expect(indexedLogs).toEqual(retainedLogs);

    for (const file of retainedLogs) {
      const bytes = await readFile(path.join(LOG_ROOT, file));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(manifest.get(file));
    }

    const claimedEntries = index.entries.filter((entry) => entry.usedForGateClaim);
    for (const entry of index.entries) {
      expect(entry.classification.length, entry.logFile).toBeGreaterThan(0);
      expect(entry.disposition.length, entry.logFile).toBeGreaterThan(0);
      if (entry.usedForGateClaim) {
        expect(entry.candidateCommit, entry.logFile).toMatch(/^[0-9a-f]{40}$/u);
        expect(entry.exactCommand?.length, entry.logFile).toBeGreaterThan(0);
        expect(entry.workingDirectory?.length, entry.logFile).toBeGreaterThan(0);
        expect(entry.exitCode, entry.logFile).not.toBeNull();
        expect(entry.receiptId?.length, entry.logFile).toBeGreaterThan(0);
        const receipt = parseReceipt(await readFile(path.join(LOG_ROOT, entry.logFile), "utf8"));
        expect(singleReceiptValue(receipt, "RECEIPT_ID"), entry.logFile).toBe(entry.receiptId);
        expect(singleReceiptValue(receipt, "CANDIDATE"), entry.logFile).toBe(entry.candidateCommit);
        expect(singleReceiptValue(receipt, "WORKING_DIRECTORY"), entry.logFile).toBe(
          entry.workingDirectory
        );
        expect(singleReceiptValue(receipt, "COMMAND"), entry.logFile).toBe(entry.exactCommand);
        const exitCodes = receipt.get("EXIT_CODE") ?? [];
        expect(exitCodes.length, entry.logFile).toBeGreaterThan(0);
        expect(exitCodes.every((exitCode) => exitCode === String(entry.exitCode)), entry.logFile).toBe(
          true
        );
        if (entry.receiptId === "setup") {
          expect(singleReceiptValue(receipt, "RECEIPT_STATUS"), entry.logFile).toBe("pass");
          expect(singleReceiptValue(receipt, "INITIAL_STATUS_COUNT"), entry.logFile).toBe("0");
          expect(singleReceiptValue(receipt, "STORE_FILES_BEFORE_INSTALL"), entry.logFile).toBe("0");
          expect(singleReceiptValue(receipt, "NODE"), entry.logFile).toBe("v22.22.0");
          expect(singleReceiptValue(receipt, "PNPM"), entry.logFile).toBe("11.21.0");
          expect(singleReceiptValue(receipt, "PNPM_PATH"), entry.logFile).toMatch(/pnpm\.cmd$/iu);
          expect(singleReceiptValue(receipt, "PNPM_SHA256"), entry.logFile).toMatch(/^[0-9a-f]{64}$/u);
          expect(singleReceiptValue(receipt, "PNPM_NODE_PATH"), entry.logFile).toMatch(/node\.exe$/iu);
          expect(singleReceiptValue(receipt, "PNPM_NODE_SHA256"), entry.logFile).toMatch(
            /^[0-9a-f]{64}$/u
          );
          for (const key of ["CLONE", "STORE", "SHIM", "RUNTIME"]) {
            expect(singleReceiptValue(receipt, `${key}_EXISTS_BEFORE`), entry.logFile).toBe("False");
          }
        } else if (entry.receiptId === "final-identity") {
          expect(singleReceiptValue(receipt, "RECEIPT_STATUS"), entry.logFile).toBe("pass");
          expect(singleReceiptValue(receipt, "FINAL_CANDIDATE"), entry.logFile).toBe(
            entry.candidateCommit
          );
          expect(singleReceiptValue(receipt, "FINAL_STATUS_COUNT"), entry.logFile).toBe("0");
          expect(singleReceiptValue(receipt, "NODE"), entry.logFile).toBe("v22.22.0");
          expect(singleReceiptValue(receipt, "PNPM"), entry.logFile).toBe("11.21.0");
          expect(singleReceiptValue(receipt, "FINAL_PNPM_SHA256"), entry.logFile).toMatch(
            /^[0-9a-f]{64}$/u
          );
          expect(singleReceiptValue(receipt, "FINAL_PNPM_NODE_SHA256"), entry.logFile).toMatch(
            /^[0-9a-f]{64}$/u
          );
          for (const key of ["CLONE", "STORE", "SHIM", "RUNTIME"]) {
            expect(singleReceiptValue(receipt, `${key}_EXISTS_AFTER`), entry.logFile).toBe("True");
          }
        } else if (entry.receiptId === "lint") {
          expect(singleReceiptValue(receipt, "COMMAND_STATUS"), entry.logFile).toBe("accepted_exit");
          expect(singleReceiptValue(receipt, "LINT_FINGERPRINT_SCHEMA"), entry.logFile).toBe(
            "eslint-json-v1"
          );
          expect(singleReceiptValue(receipt, "LINT_DIAGNOSTICS"), entry.logFile).toBe("78");
          expect(singleReceiptValue(receipt, "LINT_FINGERPRINT"), entry.logFile).toBe(
            "74bd6c28c7f21924479e2ec82cfea8de75b8b4d36c0707c0892a64c3db822c70"
          );
          expect(singleReceiptValue(receipt, "LINT_BASELINE_STATUS"), entry.logFile).toBe("pass");
        } else {
          expect(singleReceiptValue(receipt, "COMMAND_STATUS"), entry.logFile).toBe("accepted_exit");
        }
      }
    }

    const pendingDispositions = index.candidateDispositions.filter(
      (candidate) => candidate.status === "qualified_pending_review"
    );
    const acceptedDispositions = index.candidateDispositions.filter(
      (candidate) => candidate.status === "accepted"
    );
    expect(pendingDispositions.length + acceptedDispositions.length).toBeLessThanOrEqual(1);
    const qualifyingDispositions = [...pendingDispositions, ...acceptedDispositions];
    expect(new Set(claimedEntries.map((entry) => entry.candidateCommit))).toEqual(
      new Set(qualifyingDispositions.map((candidate) => candidate.candidateCommit))
    );
    for (const disposition of qualifyingDispositions) {
      const qualificationEntries = index.entries.filter(
        (entry) => entry.usedForGateClaim && entry.candidateCommit === disposition.candidateCommit
      );
      expect(
        qualificationEntries.map((entry) => entry.receiptId).sort(),
        disposition.candidateCommit
      ).toEqual([...requiredReceiptIds].sort());
      expect(
        qualificationEntries.map((entry) => entry.logFile).sort(),
        disposition.candidateCommit
      ).toEqual([...(disposition.qualificationLogFiles ?? [])].sort());
      const setupEntry = qualificationEntries.find((entry) => entry.receiptId === "setup");
      const finalEntry = qualificationEntries.find((entry) => entry.receiptId === "final-identity");
      if (!setupEntry || !finalEntry) {
        throw new Error(`Missing setup/final identity pair for ${disposition.candidateCommit}.`);
      }
      const [setupReceipt, finalReceipt] = await Promise.all([
        readFile(path.join(LOG_ROOT, setupEntry.logFile), "utf8").then(parseReceipt),
        readFile(path.join(LOG_ROOT, finalEntry.logFile), "utf8").then(parseReceipt)
      ]);
      expect(singleReceiptValue(finalReceipt, "FINAL_PNPM_SHA256")).toBe(
        singleReceiptValue(setupReceipt, "PNPM_SHA256")
      );
      expect(singleReceiptValue(finalReceipt, "FINAL_PNPM_NODE_SHA256")).toBe(
        singleReceiptValue(setupReceipt, "PNPM_NODE_SHA256")
      );
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
      /(?<![A-Za-z0-9])authorization\s*:\s*bearer\s+[^\s"']{8,}/giu,
      /(?<![A-Za-z0-9])bearer\s+[^\s"']{8,}/giu,
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

function parseReceipt(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) {
      continue;
    }
    fields.set(match[1], [...(fields.get(match[1]) ?? []), match[2]]);
  }
  return fields;
}

function singleReceiptValue(receipt: Map<string, string[]>, key: string): string {
  const values = receipt.get(key) ?? [];
  if (values.length !== 1) {
    throw new Error(`Expected exactly one ${key} field; observed ${values.length}.`);
  }
  return values[0];
}
