import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  truncateSync,
  writeSync
} from "node:fs";
import path from "node:path";
import { NonEmptyStringSchema, nowIso } from "@manyhands/shared";
import {
  TraceEventSchema,
  type TraceEvent,
  type TraceEventInput,
  type TraceEventType,
  type TraceStore
} from "./trace-types.js";

interface DurableTraceEnvelope {
  schemaVersion: 1;
  event: TraceEvent;
  checksum: string;
}

export interface JsonlTraceStoreOptions {
  runId: string;
  directory?: string;
}

export class JsonlTraceStore implements TraceStore {
  readonly runId: string;
  readonly directory: string;

  constructor(options: JsonlTraceStoreOptions);
  constructor(runId: string, options?: { directory?: string });
  constructor(
    runIdOrOptions: string | JsonlTraceStoreOptions,
    options: { directory?: string } = {}
  ) {
    this.runId = NonEmptyStringSchema.parse(
      typeof runIdOrOptions === "string" ? runIdOrOptions : runIdOrOptions.runId
    );
    const baseDirectory = typeof runIdOrOptions === "string"
      ? options.directory
      : runIdOrOptions.directory;
    this.directory = path.resolve(baseDirectory ?? ".manyhands/runs");
  }

  tracePath(): string {
    return path.join(this.directory, safeName(this.runId), "traces.jsonl");
  }

  append(event: TraceEventInput): TraceEvent {
    const currentCount = this.list().length;
    const nextEvent: TraceEvent = TraceEventSchema.parse({
      id: event.id ?? `trace-${currentCount + 1}`,
      timestamp: event.timestamp ?? nowIso(),
      type: event.type,
      actor: event.actor,
      payload: redactSecrets(event.payload),
      ...(event.planId === undefined ? {} : { planId: event.planId }),
      ...(event.taskId === undefined ? {} : { taskId: event.taskId })
    });
    const envelope: DurableTraceEnvelope = {
      schemaVersion: 1,
      event: nextEvent,
      checksum: checksum(nextEvent)
    };
    appendDurably(this.tracePath(), `${JSON.stringify(envelope)}\n`);
    return nextEvent;
  }

  list(): TraceEvent[] {
    if (!existsSync(this.tracePath())) return [];
    let contents = readFileSync(this.tracePath(), "utf8");
    if (contents.length === 0) return [];
    if (!contents.endsWith("\n")) {
      const lastNewline = contents.lastIndexOf("\n");
      const validLength = lastNewline < 0 ? 0 : lastNewline + 1;
      truncateSync(this.tracePath(), validLength);
      contents = contents.slice(0, validLength);
      if (contents.length === 0) return [];
    }
    return contents
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => {
        const raw = JSON.parse(line) as Partial<DurableTraceEnvelope>;
        if (raw.schemaVersion !== 1 || raw.event === undefined || typeof raw.checksum !== "string") {
          throw new Error(`Invalid trace envelope at line ${index + 1}.`);
        }
        const parsed = TraceEventSchema.parse(raw.event);
        if (checksum(parsed) !== raw.checksum) {
          throw new Error(`Trace checksum mismatch at line ${index + 1}.`);
        }
        return parsed;
      });
  }

  findByType(type: TraceEventType): TraceEvent[] {
    return this.list().filter((event) => event.type === type);
  }

  findByTask(taskId: string): TraceEvent[] {
    NonEmptyStringSchema.parse(taskId);
    return this.list().filter((event) => event.taskId === taskId);
  }

  clear(): void {
    mkdirSync(path.dirname(this.tracePath()), { recursive: true });
    const descriptor = openSync(this.tracePath(), "w", 0o600);
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}

export function redactSecrets<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>, key?: string): unknown {
  if (key !== undefined && isSensitiveKey(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED:CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, seen, entryKey)
    ])
  );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
  return [
    "accesstoken",
    "apikey",
    "authtoken",
    "authorization",
    "awssecretaccesskey",
    "bearertoken",
    "clientsecret",
    "cookie",
    "credentials",
    "password",
    "privatekey",
    "refreshtoken",
    "secret",
    "secretkey",
    "secrettoken",
    "sessionid",
    "token"
  ].includes(normalized);
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{8,}\b/gu, "[REDACTED]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/gu, "[REDACTED]")
    .replace(/(https?:\/\/[^:/@\s]+:)[^@\s/]+@/giu, "$1[REDACTED]@")
    .replace(/\b(API[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|PRIVATE[_-]?KEY|TOKEN|SECRET|AUTHORIZATION)\s*[:=]\s*([^\s,;]+)/giu, "$1=[REDACTED]");
}

function appendDurably(filePath: string, line: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = openSync(filePath, "a", 0o600);
  try {
    writeSync(descriptor, line, undefined, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(filePath, 0o600);
}

function checksum(event: TraceEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function safeName(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/gu, "_");
}
