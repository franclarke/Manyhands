#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildMonitorModel,
  chooseRun,
  normalizeRunResponse,
  renderDashboard
} from "./manyhands-dev-renderer.mjs";
import { startSingleFlightPoller } from "./manyhands-dev-poller.mjs";
import { resolveDefaultDevSpawn } from "./manyhands-dev-command.mjs";

const DEFAULT_URL = "http://localhost:3000";
// `pnpm --filter @manyhands/web dev` runs Next from apps/web while the daemon
// runs from the repository root, and both resolve ".manyhands/daemon" against
// their own cwd. Without an explicit anchor they look for the same daemon in
// two different directories and the UI never finds it.
const DAEMON_STATE_ROOT = process.env.MANYHANDS_DAEMON_STATE_ROOT
  ?? path.resolve(process.cwd(), ".manyhands/daemon");
const RENDER_INTERVAL_MS = 350;
const RUN_POLL_INTERVAL_MS = 2_000;
const RUN_POLL_MAX_BACKOFF_MS = 30_000;
const STREAM_RETRY_MS = 1_500;
const FETCH_TIMEOUT_MS = 2_500;
const PROCESS_LINE_LIMIT = 200;
const EVENT_LIMIT = 1_500;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

// B-006: one session token for the whole dev session — the Next server (all
// runtimes) enforces it for mutations/SSE/terminal/files, this console sends
// it, and the operator can copy it for scripts.
if (process.env.MANYHANDS_SESSION_TOKEN === undefined || process.env.MANYHANDS_SESSION_TOKEN.length === 0) {
  process.env.MANYHANDS_SESSION_TOKEN = randomUUID();
}
const SESSION_HEADER = { "x-manyhands-session": process.env.MANYHANDS_SESSION_TOKEN };

const visual = process.stdout.isTTY === true && process.env.CI !== "true" && options.plain !== true;
const state = {
  baseUrl: options.url ?? process.env.MANYHANDS_DEV_URL ?? DEFAULT_URL,
  startedAt: Date.now(),
  selectedRun: null,
  events: [],
  explicitRunId: options.runId,
  lastSeq: 0,
  server: { status: options.attach ? "probing" : "starting" },
  sse: { status: "idle" },
  process: { status: options.attach ? "attached" : "starting", lines: [] }
};

let child = null;
let daemonChild = null;
let shuttingDown = false;
let renderTimer = null;
let pollController = null;
let streamAbort = null;
let streamRunId = null;

installShutdownHandlers();

if (visual) {
  process.stdout.write("\x1b[?25l");
  renderTimer = setInterval(render, RENDER_INTERVAL_MS);
  render();
} else {
  writePlainLine("[manyhands] dev console running in plain mode");
}

if (!options.attach) {
  try {
    const stack = await startProductiveDevStack(options);
    daemonChild = stack.daemon;
    child = stack.web;
  } catch (error) {
    state.process.status = "failed";
    const message = error instanceof Error ? error.message : String(error);
    addProcessLine(`[manyhands] failed to start productive dev stack: ${message}`);
    if (!visual) writePlainLine(`[manyhands] failed to start productive dev stack: ${message}`);
    await stopManagedChild(daemonChild, "SIGTERM");
    process.exitCode = 1;
    if (renderTimer !== null) clearInterval(renderTimer);
    process.exit(1);
  }
}

pollController = startSingleFlightPoller({
  poll: refreshRunSelection,
  intervalMs: RUN_POLL_INTERVAL_MS,
  maxIntervalMs: RUN_POLL_MAX_BACKOFF_MS
});

async function startProductiveDevStack(parsedOptions) {
  const usesDefaultCommand = parsedOptions.command === undefined;
  if (usesDefaultCommand) {
    await prepareDefaultProductiveStack();
  }

  const daemon = startDaemonProcess();
  daemonChild = daemon;
  await waitForDaemonReady(daemon);
  if (shuttingDown) throw new Error("Productive dev startup was interrupted.");
  const web = startDevServer(parsedOptions, usesDefaultCommand);
  return { daemon, web };
}

async function prepareDefaultProductiveStack() {
  await runSetupCommand(["build:packages"], "workspace packages");
  await runSetupCommand(["--filter", "@manyhands/daemon", "build"], "daemon");
  if (
    process.platform === "win32" &&
    (process.env.MANYHANDS_WINDOWS_JOB_RUNNER === undefined || process.env.MANYHANDS_WINDOWS_JOB_RUNNER.length === 0)
  ) {
    process.env.MANYHANDS_WINDOWS_JOB_RUNNER = await ensureWindowsJobRunner();
  }
}

async function runSetupCommand(args, label) {
  const spec = resolveDefaultDevSpawn(args);
  addProcessLine(`[manyhands] building ${label}: ${spec.command} ${spec.args.join(" ")}`);
  if (!visual) writePlainLine(`[manyhands] building ${label}`);
  await new Promise((resolve, reject) => {
    const setup = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
      stdio: ["inherit", "pipe", "pipe"]
    });
    pipeProcessOutput(setup.stdout, "stdout");
    pipeProcessOutput(setup.stderr, "stderr");
    setup.once("error", reject);
    setup.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} build exited code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

async function ensureWindowsJobRunner() {
  const source = path.resolve("native/windows-job-runner/src/main.rs");
  const directory = path.resolve(".manyhands/bin");
  const executable = path.join(directory, "manyhands-windows-job-runner.exe");
  await mkdir(directory, { recursive: true });
  const [sourceStat, executableStat] = await Promise.all([
    stat(source),
    stat(executable).catch(() => undefined)
  ]);
  if (executableStat !== undefined && executableStat.mtimeMs >= sourceStat.mtimeMs) return executable;
  addProcessLine(`[manyhands] building Windows process custodian: ${executable}`);
  if (!visual) writePlainLine("[manyhands] building Windows process custodian");
  await new Promise((resolve, reject) => {
    const compiler = spawn("rustc.exe", ["--edition=2021", source, "-O", "-o", executable], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    pipeProcessOutput(compiler.stdout, "stdout");
    pipeProcessOutput(compiler.stderr, "stderr");
    compiler.once("error", reject);
    compiler.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Windows process custodian build exited code=${code ?? "null"}.`));
    });
  });
  return executable;
}

function startDaemonProcess() {
  const entrypoint = path.resolve(
    process.env.MANYHANDS_DEV_DAEMON_ENTRYPOINT ?? "apps/daemon/dist/cli.cjs"
  );
  const spawned = spawn(process.execPath, [entrypoint], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MANYHANDS_DAEMON_PROFILE: process.env.MANYHANDS_DAEMON_PROFILE ?? "deterministic_fake",
      MANYHANDS_DAEMON_STATE_ROOT: DAEMON_STATE_ROOT,
      FORCE_COLOR: process.env.FORCE_COLOR ?? (visual ? "1" : "0")
    },
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  state.process.status = "starting";
  addProcessLine(`[manyhands] spawned daemon: ${process.execPath} ${entrypoint}`);
  pipeProcessOutput(spawned.stdout, "daemon", observeDaemonLine);
  pipeProcessOutput(spawned.stderr, "daemon:stderr");
  spawned.on("error", (error) => {
    addProcessLine(`[manyhands] failed to start daemon: ${error.message}`);
  });
  spawned.on("exit", (code, signal) => {
    addProcessLine(`[manyhands] daemon exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!visual) writePlainLine(`[manyhands] daemon exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!shuttingDown) void exitFromStackChild("daemon", code ?? 1, signal);
  });
  return spawned;
}

function observeDaemonLine(line) {
  try {
    const value = JSON.parse(stripAnsi(line));
    if (value?.event === "manyhands.daemon.ready") {
      state.process.status = "running";
      state.daemonReady = true;
    }
  } catch {
    // Non-JSON diagnostics remain visible in the process pane.
  }
}

function waitForDaemonReady(spawned) {
  const configured = Number(process.env.MANYHANDS_DEV_DAEMON_READY_TIMEOUT_MS ?? 30_000);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 30_000;
  if (state.daemonReady === true) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Daemon did not become ready within ${timeoutMs}ms.`)), timeoutMs);
    const poll = setInterval(() => {
      if (state.daemonReady !== true) return;
      clearInterval(poll);
      clearTimeout(deadline);
      resolve();
    }, 10);
    spawned.once("exit", (code) => {
      clearInterval(poll);
      clearTimeout(deadline);
      reject(new Error(`Daemon exited before readiness with code ${code ?? "null"}.`));
    });
  });
}

function startDevServer(parsedOptions, usesDefaultCommand = parsedOptions.command === undefined) {
  const requestedArgs = parsedOptions.commandArgs.length > 0
    ? parsedOptions.commandArgs
    : ["--filter", "@manyhands/web", "dev"];
  const spawnSpec = usesDefaultCommand
    ? resolveDefaultDevSpawn(requestedArgs)
    : { command: parsedOptions.command, args: requestedArgs, windowsVerbatimArguments: false };
  const command = spawnSpec.command;
  const args = spawnSpec.args;
  const spawned = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MANYHANDS_DAEMON_STATE_ROOT: DAEMON_STATE_ROOT,
      FORCE_COLOR: process.env.FORCE_COLOR ?? (visual ? "1" : "0")
    },
    shell: false,
    detached: process.platform !== "win32",
    windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
    stdio: ["inherit", "pipe", "pipe"]
  });

  state.process.status = "starting";
  addProcessLine(`[manyhands] spawned: ${command} ${args.join(" ")}`);

  pipeProcessOutput(spawned.stdout, "stdout");
  pipeProcessOutput(spawned.stderr, "stderr");

  spawned.on("error", (error) => {
    state.process.status = "failed";
    addProcessLine(`[manyhands] failed to start dev process: ${error.message}`);
    if (!visual) writePlainLine(`[manyhands] failed to start dev process: ${error.message}`);
  });

  spawned.on("exit", (code, signal) => {
    state.process.status = code === 0 ? "exited" : "failed";
    addProcessLine(`[manyhands] dev process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!visual) writePlainLine(`[manyhands] dev process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!shuttingDown) {
      state.server.status = "offline";
      const exitCode = code ?? (signal === null ? 1 : 0);
      void exitFromStackChild("web", exitCode, signal);
    }
  });

  return spawned;
}

function pipeProcessOutput(stream, streamName, observeLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      observeLine?.(part);
      handleProcessLine(part, streamName);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      observeLine?.(buffer);
      handleProcessLine(buffer, streamName);
    }
  });
}

function handleProcessLine(line, streamName) {
  const trimmed = stripAnsi(line).trimEnd();
  if (trimmed.length === 0) return;
  const detectedUrl = detectLocalUrl(trimmed);
  if (detectedUrl !== null) {
    state.baseUrl = detectedUrl;
    state.server.status = "ready";
  }
  if (state.process.status === "starting" && /ready|started|local:/i.test(trimmed)) {
    state.process.status = "running";
  }
  addProcessLine(`[${streamName}] ${trimmed}`);
  if (!visual || options.logs) {
    const output = streamName === "stderr" ? process.stderr : process.stdout;
    output.write(`${line}\n`);
  }
}

async function refreshRunSelection() {
  if (shuttingDown) return true;
  try {
    const runs = await fetchRuns();
    state.server.status = "ready";
    const selected = chooseRun(runs, state.explicitRunId);
    if (selected === null) {
      state.selectedRun = null;
      state.events = [];
      state.lastSeq = 0;
      reconnectStream(null);
      return true;
    }
    if (state.selectedRun?.id !== selected.id) {
      state.selectedRun = selected;
      state.events = [];
      state.lastSeq = 0;
      reconnectStream(selected.id);
    } else {
      state.selectedRun = { ...state.selectedRun, ...selected };
    }
    return true;
  } catch (error) {
    state.server.status = "probing";
    addProcessLine(`[manyhands] waiting for web server: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function fetchRuns() {
  if (state.explicitRunId !== undefined) {
    const payload = await fetchJson(`${state.baseUrl}/api/runs/${encodeURIComponent(state.explicitRunId)}`);
    const run = normalizeRunResponse(payload);
    return run === null ? [] : [run];
  }

  const payload = await fetchJson(`${state.baseUrl}/api/runs?limit=5`);
  return Array.isArray(payload?.runs) ? payload.runs : [];
}

function reconnectStream(runId) {
  if (streamAbort !== null) {
    streamAbort.abort();
    streamAbort = null;
  }
  streamRunId = runId;
  state.sse.status = runId === null ? "idle" : "connecting";
  if (runId !== null) {
    void connectStream(runId);
  }
}

async function connectStream(runId) {
  if (shuttingDown || runId !== streamRunId) return;
  const controller = new AbortController();
  streamAbort = controller;

  try {
    const url = `${state.baseUrl}/api/runs/${encodeURIComponent(runId)}/run-events?after=${state.lastSeq}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/event-stream", ...SESSION_HEADER }
    });
    if (!response.ok || response.body === null) {
      throw new Error(`SSE ${response.status}`);
    }

    state.sse.status = "connected";
    state.sse.error = undefined;
    await readSseStream(response.body, (event) => {
      if (event.runId !== runId) return;
      if (Number(event.seq) <= state.lastSeq) return;
      state.events.push(event);
      if (state.events.length > EVENT_LIMIT) {
        state.events.splice(0, state.events.length - EVENT_LIMIT);
      }
      state.lastSeq = Number(event.seq);
    });
  } catch (error) {
    if (controller.signal.aborted || shuttingDown || runId !== streamRunId) return;
    state.sse.status = "retrying";
    state.sse.error = error instanceof Error ? error.message : String(error);
    setTimeout(() => {
      if (!shuttingDown && runId === streamRunId) void connectStream(runId);
    }, STREAM_RETRY_MS);
  }
}

async function readSseStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!shuttingDown) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const parsed = parseSseFrame(part);
      if (parsed !== null) onEvent(parsed);
    }
  }
}

function parseSseFrame(frame) {
  const data = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (rawLine.startsWith(":")) continue;
    if (rawLine.startsWith("data:")) data.push(rawLine.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  try {
    return JSON.parse(data.join("\n"));
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", ...SESSION_HEADER }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function render() {
  if (!visual) return;
  const model = buildMonitorModel({
    run: state.selectedRun,
    events: state.events,
    baseUrl: state.baseUrl,
    server: state.server,
    sse: state.sse,
    process: state.process,
    startedAt: state.startedAt,
    now: new Date().toISOString()
  });
  const dashboard = renderDashboard(model, {
    width: process.stdout.columns ?? 100,
    height: process.stdout.rows ?? 34,
    color: true
  });
  process.stdout.write(`\x1b[H\x1b[2J${dashboard}\n`);
}

function addProcessLine(line) {
  state.process.lines.push(line);
  if (state.process.lines.length > PROCESS_LINE_LIMIT) {
    state.process.lines.splice(0, state.process.lines.length - PROCESS_LINE_LIMIT);
  }
}

function detectLocalUrl(line) {
  const match = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)/i.exec(line);
  return match?.[1] ?? null;
}

function installShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
  process.once("exit", () => {
    if (visual) process.stdout.write("\x1b[?25h");
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (renderTimer !== null) clearInterval(renderTimer);
  pollController?.stop();
  if (streamAbort !== null) streamAbort.abort();
  if (visual) {
    render();
    process.stdout.write("\x1b[?25h\n");
  }
  await Promise.all([
    stopManagedChild(child, signal === "SIGTERM" ? "SIGTERM" : "SIGINT"),
    stopManagedChild(daemonChild, signal === "SIGTERM" ? "SIGTERM" : "SIGINT")
  ]);
  process.exit(0);
}

async function exitFromStackChild(role, exitCode, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  pollController?.stop();
  if (streamAbort !== null) streamAbort.abort();
  if (visual) {
    if (renderTimer !== null) clearInterval(renderTimer);
    render();
    process.stdout.write("\x1b[?25h\n");
  }
  const sibling = role === "daemon" ? child : daemonChild;
  await stopManagedChild(sibling, signal === "SIGINT" ? "SIGINT" : "SIGTERM");
  if (visual) await new Promise((resolve) => setTimeout(resolve, 750));
  process.exit(exitCode);
}

async function stopManagedChild(spawned, signal) {
  if (spawned === null || spawned.exitCode !== null || spawned.signalCode !== null) return;
  const exited = new Promise((resolve) => spawned.once("exit", resolve));
  terminateManagedTree(spawned, signal, false);
  if (await settlesWithin(exited, 1_500)) return;
  terminateManagedTree(spawned, "SIGKILL", true);
  await settlesWithin(exited, 1_500);
}

function terminateManagedTree(spawned, signal, force) {
  if (spawned.pid === undefined) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(spawned.pid), "/t", ...(force ? ["/f"] : [])];
    const killer = spawn("taskkill.exe", args, {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.on("error", () => {
      if (spawned.exitCode === null) spawned.kill(signal);
    });
    return;
  }
  try {
    process.kill(-spawned.pid, signal);
  } catch {
    if (spawned.exitCode === null) spawned.kill(signal);
  }
}

async function settlesWithin(promise, timeoutMs) {
  let timeout;
  return Promise.race([
    promise.then(() => true),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}

function parseArgs(args) {
  const parsed = {
    attach: false,
    command: undefined,
    commandArgs: [],
    help: false,
    logs: false,
    plain: false,
    runId: undefined,
    url: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--attach":
        parsed.attach = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--logs":
        parsed.logs = true;
        break;
      case "--plain":
        parsed.plain = true;
        break;
      case "--run":
        parsed.runId = args[++index];
        break;
      case "--url":
        parsed.url = args[++index];
        break;
      case "--":
        parsed.command = args[++index];
        parsed.commandArgs = args.slice(index + 1);
        index = args.length;
        break;
      default:
        if (arg.startsWith("--run=")) parsed.runId = arg.slice("--run=".length);
        else if (arg.startsWith("--url=")) parsed.url = arg.slice("--url=".length);
        else if (parsed.command === undefined) parsed.command = arg;
        else parsed.commandArgs.push(arg);
        break;
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(`ManyHands dev console

Usage:
  pnpm dev
  pnpm web:dev
  node scripts/manyhands-dev.mjs [options]

Options:
  --attach             Do not start Next; monitor an existing server.
  --url <url>          Server URL to monitor. Default: ${DEFAULT_URL}
  --run <runId>        Pin the console to one run instead of the latest active run.
  --logs              Mirror child stdout/stderr below the visual monitor.
  --plain             Disable the visual dashboard and stream plain logs.
  -- <cmd> [args...]   Override the child command. Default: pnpm web:dev:raw
`);
}

function writePlainLine(line) {
  process.stdout.write(`${line}\n`);
}

function stripAnsi(value) {
  return String(value ?? "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}
