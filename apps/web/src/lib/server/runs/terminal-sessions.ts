import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { globalSingleton } from "../global-singleton";
import type { RunRecord } from "./schema";
import {
  type WorkspaceContextKind,
  resolveRunWorkspaceContext
} from "./workspace-context";

export interface CreateTerminalSessionInput {
  run: RunRecord;
  context: WorkspaceContextKind;
  nodeId?: string | undefined;
  cols?: number | undefined;
  rows?: number | undefined;
}

export interface TerminalSessionInfo {
  id: string;
  runId: string;
  cwd: string;
  label: string;
  createdAt: string;
}

type OutputListener = (chunk: string) => void;

interface PtyProcess {
  write(data: string): void;
  resize?(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
}

// On globalThis: the POST /terminals route creates sessions in one Next route
// bundle and the stream/input/delete routes look them up from others (see
// global-singleton.ts) — a module-level Map makes the stream route 404 always.
const sessions = globalSingleton(
  "terminal-sessions:registry",
  () => new Map<string, TerminalSession>()
);
const SESSION_TTL_MS = 30 * 60 * 1000;

export async function createTerminalSession(input: CreateTerminalSessionInput): Promise<TerminalSessionInfo> {
  const workspace = await resolveRunWorkspaceContext(input.run, {
    context: input.context,
    nodeId: input.nodeId
  });
  if (!workspace.exists) {
    throw new Error(`Workspace context does not exist: ${workspace.label}`);
  }
  sweepExpiredSessions();
  const id = randomUUID();
  const session = new TerminalSession({
    id,
    runId: input.run.runId,
    cwd: workspace.rootPath,
    label: workspace.label,
    cols: input.cols ?? 100,
    rows: input.rows ?? 28
  });
  await session.start();
  sessions.set(id, session);
  return session.info();
}

export function getTerminalSession(id: string): TerminalSession | null {
  const session = sessions.get(id) ?? null;
  if (session === null) return null;
  if (session.expired()) {
    closeTerminalSession(id);
    return null;
  }
  return session;
}

export function closeTerminalSession(id: string): boolean {
  const session = sessions.get(id);
  if (session === undefined) return false;
  sessions.delete(id);
  session.close();
  return true;
}

function sweepExpiredSessions(): void {
  for (const [id, session] of sessions.entries()) {
    if (session.expired()) closeTerminalSession(id);
  }
}

export class TerminalSession {
  private readonly id: string;
  private readonly runId: string;
  private readonly cwd: string;
  private readonly label: string;
  private readonly createdAt = new Date().toISOString();
  private readonly listeners = new Set<OutputListener>();
  private readonly backlog: string[] = [];
  private lastTouched = Date.now();
  private pty: PtyProcess | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private closed = false;
  private readonly cols: number;
  private readonly rows: number;

  constructor(input: { id: string; runId: string; cwd: string; label: string; cols: number; rows: number }) {
    this.id = input.id;
    this.runId = input.runId;
    this.cwd = input.cwd;
    this.label = input.label;
    this.cols = input.cols;
    this.rows = input.rows;
  }

  async start(): Promise<void> {
    const shell = shellCommand();
    const ptyFactory = await importNodePty().catch(() => null);
    if (ptyFactory !== null) {
      try {
        const proc = ptyFactory.spawn(shell.command, shell.args, {
          cols: this.cols,
          rows: this.rows,
          cwd: this.cwd,
          env: process.env
        }) as PtyProcess;
        proc.onData((data) => this.emit(data));
        proc.onExit((event) => this.emit(`\r\n[process exited ${event.exitCode}]\r\n`));
        this.pty = proc;
        return;
      } catch {
        this.emit("[node-pty unavailable; falling back to a plain shell process]\r\n");
      }
    }

    const child = spawn(shell.command, shell.args, {
      cwd: this.cwd,
      env: process.env,
      shell: false
    });
    child.stdout.on("data", (chunk: Buffer) => this.emit(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => this.emit(chunk.toString("utf8")));
    child.on("exit", (code) => this.emit(`\r\n[process exited ${code ?? 0}]\r\n`));
    this.child = child;
  }

  info(): TerminalSessionInfo {
    return {
      id: this.id,
      runId: this.runId,
      cwd: this.cwd,
      label: this.label,
      createdAt: this.createdAt
    };
  }

  write(data: string): void {
    this.touch();
    if (this.pty !== null) this.pty.write(data);
    else this.child?.stdin.write(data);
  }

  resize(cols: number, rows: number): void {
    this.touch();
    this.pty?.resize?.(cols, rows);
  }

  subscribe(listener: OutputListener): () => void {
    this.touch();
    for (const item of this.backlog) listener(item);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  expired(): boolean {
    return Date.now() - this.lastTouched > SESSION_TTL_MS;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pty?.kill();
    this.child?.kill();
    this.listeners.clear();
  }

  private touch(): void {
    this.lastTouched = Date.now();
  }

  private emit(chunk: string): void {
    this.touch();
    this.backlog.push(chunk);
    if (this.backlog.length > 200) this.backlog.shift();
    for (const listener of this.listeners) listener(chunk);
  }
}

function shellCommand(): { command: string; args: string[] } {
  if (os.platform() === "win32") {
    return { command: process.env.ComSpec ?? "cmd.exe", args: [] };
  }
  return { command: process.env.SHELL ?? "bash", args: [] };
}

async function importNodePty(): Promise<{ spawn: (...args: unknown[]) => unknown }> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<{ spawn: (...args: unknown[]) => unknown }>;
  return dynamicImport("node-pty");
}
