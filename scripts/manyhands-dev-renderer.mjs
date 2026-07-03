const PHASES = ["framing", "proposal", "foundation", "supervision", "reconciliation", "disposition"];

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightCyan: "\x1b[96m",
};
const ACTIVE_RUN_STATUSES = new Set(["created", "generating", "paused", "needs_review", "approved", "running"]);

export function chooseRun(runs, explicitRunId) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  if (explicitRunId !== undefined && explicitRunId.length > 0) {
    return runs.find((run) => run.id === explicitRunId || run.runId === explicitRunId) ?? null;
  }
  return runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? runs[0] ?? null;
}

export function normalizeRunResponse(payload) {
  const run = payload?.run;
  if (run === undefined || run === null) return null;
  return {
    id: String(run.runId ?? run.id ?? ""),
    workspaceId: String(run.workspaceId ?? ""),
    workspaceName: run.workspaceName,
    title: String(run.title ?? run.userPrompt ?? "Untitled run"),
    userPrompt: String(run.userPrompt ?? ""),
    summary: run.summary,
    status: String(run.status ?? "created"),
    granularity: String(run.granularity ?? "auto"),
    model: String(run.model ?? ""),
    createdAt: String(run.createdAt ?? ""),
    updatedAt: String(run.updatedAt ?? ""),
    href: `/runs/${String(run.runId ?? run.id ?? "")}`,
    nodeCount: numberOrUndefined(run.nodeCount),
    agentCount: numberOrUndefined(run.agentCount),
    conflictCount: numberOrUndefined(run.conflictCount)
  };
}

export function buildMonitorModel(input = {}) {
  const events = [...(input.events ?? [])].sort((left, right) => Number(left.seq ?? 0) - Number(right.seq ?? 0));
  const nodes = new Map();
  const decisions = new Map();
  const conflicts = new Map();
  const waves = new Map();
  const timeline = [];
  const seenEventFamilies = new Set();
  let controlStatus = input.run?.status ?? "idle";
  let planStats = null;
  let evidence = null;
  let metrics = null;
  let completedStatus = null;
  let context = null;

  for (const event of events) {
    const type = String(event.type ?? "");
    const payload = event.payload ?? {};
    seenEventFamilies.add(familyOf(type));

    switch (type) {
      case "run.context.resolved":
        context = {
          repo: stringValue(payload.repo),
          baseCommit: stringValue(payload.baseCommit),
          readiness: stringValue(payload.readiness)
        };
        break;
      case "run.status.changed":
        controlStatus = stringValue(payload.status) ?? controlStatus;
        break;
      case "plan.node.proposed": {
        const nodeId = stringValue(payload.nodeId);
        if (nodeId !== undefined) {
          const current = ensureNode(nodes, nodeId);
          current.title = stringValue(payload.title) ?? current.title;
          current.goal = stringValue(payload.goal) ?? current.goal;
          current.parentId = stringValue(payload.parentId) ?? null;
          current.role = stringValue(payload.role) ?? current.role;
          current.depth = numberValue(payload.depth) ?? current.depth;
        }
        break;
      }
      case "plan.ready":
        planStats = {
          rootId: stringValue(payload.rootId),
          nodeCount: numberValue(payload.nodeCount) ?? 0,
          seamCount: numberValue(payload.seamCount) ?? 0,
          criticFindings: Array.isArray(payload.criticFindings) ? payload.criticFindings.length : 0
        };
        break;
      case "wave.planned":
        for (const wave of Array.isArray(payload.waves) ? payload.waves : []) {
          const waveId = stringValue(wave?.waveId);
          if (waveId !== undefined) {
            waves.set(waveId, {
              id: waveId,
              index: numberValue(wave.index) ?? waves.size,
              nodeIds: stringArray(wave.nodeIds),
              state: "planned"
            });
          }
        }
        break;
      case "wave.opened": {
        const waveId = stringValue(payload.waveId) ?? `wave-${waves.size + 1}`;
        waves.set(waveId, {
          id: waveId,
          index: waves.get(waveId)?.index ?? waves.size,
          nodeIds: stringArray(payload.nodeIds),
          state: "opened"
        });
        break;
      }
      case "wave.closed": {
        const waveId = stringValue(payload.waveId);
        if (waveId !== undefined) {
          const current = waves.get(waveId) ?? { id: waveId, index: waves.size, nodeIds: [] };
          waves.set(waveId, { ...current, state: "closed" });
        }
        break;
      }
      case "node.execution.started": {
        const nodeId = stringValue(payload.nodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = "running";
          node.agent = stringValue(payload.agent);
          node.model = stringValue(payload.model);
          node.reason = stringValue(payload.reason);
          node.startedAt = event.at;
        }
        break;
      }
      case "node.verify.iteration": {
        const nodeId = stringValue(payload.nodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = "verifying";
          node.verify = {
            iteration: numberValue(payload.iteration) ?? 0,
            maxIterations: numberValue(payload.maxIterations) ?? 0,
            build: stringValue(payload.build) ?? "pending",
            testsPass: numberValue(payload.testsPass) ?? 0,
            testsTotal: numberValue(payload.testsTotal) ?? 0
          };
        }
        break;
      }
      case "node.verify.passed": {
        const nodeId = stringValue(payload.nodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = "done";
          node.commit = shortSha(stringValue(payload.commit));
          node.changedFiles = stringArray(payload.changedFiles);
          node.completedAt = event.at;
        }
        break;
      }
      case "node.verify.failed": {
        const nodeId = stringValue(payload.nodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = "failed";
          node.cause = stringValue(payload.cause);
        }
        break;
      }
      case "node.repair.started": {
        const nodeId = stringValue(payload.nodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = "repairing";
          node.reason = stringValue(payload.reason);
        }
        break;
      }
      case "node.execution.failed": {
        const nodeId = stringValue(payload.nodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = "failed";
          node.cause = stringValue(payload.cause);
        }
        break;
      }
      case "integration.started": {
        const nodeId = stringValue(payload.compositeNodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = "integrating";
          node.childNodeIds = stringArray(payload.childNodeIds);
        }
        break;
      }
      case "integration.validated": {
        const nodeId = stringValue(payload.compositeNodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = payload.passed === true ? "verifying" : "failed";
          node.verify = {
            iteration: 1,
            maxIterations: 1,
            build: payload.passed === true ? "pass" : "fail",
            testsPass: numberValue(payload.testsPass) ?? 0,
            testsTotal: numberValue(payload.testsTotal) ?? 0
          };
        }
        break;
      }
      case "integration.completed": {
        const nodeId = stringValue(payload.compositeNodeId);
        if (nodeId !== undefined) {
          const node = ensureNode(nodes, nodeId);
          node.status = stringValue(payload.status) === "success" ? "done" : "failed";
          node.commit = shortSha(stringValue(payload.commit));
        }
        break;
      }
      case "conflict.detected": {
        const conflictId = stringValue(payload.conflictId);
        if (conflictId !== undefined) {
          conflicts.set(conflictId, {
            id: conflictId,
            status: stringValue(payload.status) ?? "detected",
            dimension: stringValue(payload.dimension) ?? "unknown",
            files: stringArray(payload.files),
            nodeIds: stringArray(payload.nodeIds),
            autoResolvable: payload.autoResolvable === true
          });
        }
        break;
      }
      case "conflict.resolved": {
        const conflictId = stringValue(payload.conflictId);
        if (conflictId !== undefined) {
          const current = conflicts.get(conflictId) ?? { id: conflictId, files: [], nodeIds: [] };
          conflicts.set(conflictId, { ...current, status: "resolved" });
        }
        break;
      }
      case "decision.raised": {
        const decisionId = stringValue(payload.decisionId);
        if (decisionId !== undefined) {
          const contextPayload = isObject(payload.context) ? payload.context : {};
          decisions.set(decisionId, {
            id: decisionId,
            kind: stringValue(payload.kind) ?? "decision",
            blocking: payload.blocking === true,
            status: "pending",
            question: stringValue(contextPayload.question),
            nodeIds: stringArray(contextPayload.nodeIds),
            conflictId: stringValue(contextPayload.conflictId),
            amendmentId: stringValue(contextPayload.amendmentId),
            options: stringArray(contextPayload.options)
          });
        }
        break;
      }
      case "decision.resolved": {
        const decisionId = stringValue(payload.decisionId);
        if (decisionId !== undefined) {
          const current = decisions.get(decisionId);
          if (current !== undefined) decisions.set(decisionId, { ...current, status: "resolved" });
        }
        break;
      }
      case "run.evidence.ready":
        evidence = {
          tests: payload.tests,
          integrationCommit: stringValue(payload.integrationCommit),
          aggregateDiffRef: stringValue(payload.aggregateDiffRef)
        };
        break;
      case "run.metrics.ready":
        metrics = isObject(payload.metrics) ? payload.metrics : null;
        break;
      case "run.completed":
        completedStatus = stringValue(payload.status) ?? "success";
        controlStatus = completedStatus === "success" ? "completed" : "failed";
        break;
      default:
        break;
    }

    const entry = summarizeEvent(event);
    if (entry !== null) timeline.push(entry);
  }

  const nodeList = [...nodes.values()].sort(compareNodes);
  const pendingDecisions = [...decisions.values()].filter((decision) => decision.status === "pending");
  const activeConflicts = [...conflicts.values()].filter((conflict) => conflict.status !== "resolved");
  const activeNodes = nodeList.filter((node) => ["running", "verifying", "repairing", "integrating"].includes(node.status));
  const failedNodes = nodeList.filter((node) => node.status === "failed");
  const phase = derivePhase({ events, seenEventFamilies, activeNodes, activeConflicts, evidence, completedStatus, controlStatus });
  const health = deriveHealth({ controlStatus, completedStatus, pendingDecisions, activeConflicts, activeNodes, failedNodes });

  return {
    run: input.run ?? null,
    baseUrl: input.baseUrl ?? "http://localhost:3000",
    server: input.server ?? { status: "starting" },
    sse: input.sse ?? { status: "idle" },
    process: input.process ?? { status: "starting", lines: [] },
    now: input.now ?? new Date().toISOString(),
    startedAt: input.startedAt,
    context,
    controlStatus,
    phase,
    health,
    planStats,
    evidence,
    metrics,
    nodes: nodeList,
    activeNodes,
    failedNodes,
    pendingDecisions,
    activeConflicts,
    waves: [...waves.values()].sort((left, right) => left.index - right.index),
    timeline,
    lastSeq: events.at(-1)?.seq ?? 0
  };
}

export function renderDashboard(inputModel, options = {}) {
  const model = inputModel.nodes === undefined ? buildMonitorModel(inputModel) : inputModel;
  const width = clamp(numberValue(options.width) ?? 100, 72, 160);
  const height = clamp(numberValue(options.height) ?? 34, 20, 80);
  const bodyWidth = width - 2;
  const lines = [];

  lines.push(border(width));
  lines.push(row(`ManyHands Dev Console  ${model.baseUrl}`, width));
  lines.push(row(headerLine(model), width));
  lines.push(row(runLine(model), width));
  lines.push(row(`Phase ${phaseBar(model.phase, bodyWidth - 6)}  Health ${model.health.toUpperCase()}  Seq ${model.lastSeq}`, width));
  lines.push(border(width));

  lines.push(...section("Attention", attentionLines(model), width));
  lines.push(...section("Wavefront", wavefrontLines(model, { width: bodyWidth }), width));

  const remainingForTimeline = Math.max(4, height - lines.length - 8);
  lines.push(...section("Plan Map", planMapLines(model, { width: bodyWidth, max: 8 }), width));
  lines.push(...section("Timeline", timelineLines(model, { max: remainingForTimeline, width: bodyWidth }), width));
  lines.push(...section("Process", processLines(model, { width: bodyWidth, max: 4 }), width));

  const output = fitHeight(lines, height, width);
  const rendered = output.join("\n");
  return options.color === true ? colorize(rendered) : rendered;
}

export function summarizeEvent(event) {
  const type = String(event.type ?? "");
  const payload = event.payload ?? {};
  const at = formatClock(event.at);

  switch (type) {
    case "run.created":
      return { tone: "info", text: `${at} run created: ${compact(stringValue(payload.intent), 90)}` };
    case "run.context.resolved":
      return { tone: "info", text: `${at} context: ${compact(stringValue(payload.repo), 48)} @ ${shortSha(stringValue(payload.baseCommit)) ?? "?"}` };
    case "plan.started":
      return { tone: "info", text: `${at} planning started` };
    case "plan.node.proposed":
      return { tone: "info", text: `${at} proposed ${stringValue(payload.nodeId) ?? "node"}: ${stringValue(payload.title) ?? "untitled"}` };
    case "plan.ready":
      return { tone: "good", text: `${at} plan ready: ${numberValue(payload.nodeCount) ?? 0} nodes, ${numberValue(payload.seamCount) ?? 0} seams` };
    case "grounding.started":
      return { tone: "info", text: `${at} grounding started` };
    case "grounding.completed":
      return { tone: "good", text: `${at} grounding completed: ${shortSha(stringValue(payload.skeletonCommit)) ?? "no commit"}` };
    case "wave.opened":
      return { tone: "info", text: `${at} wave opened: ${stringArray(payload.nodeIds).join(", ") || "no nodes"}` };
    case "wave.closed":
      return { tone: "info", text: `${at} wave closed: ${stringValue(payload.waveId) ?? "unknown"}` };
    case "node.execution.started":
      return { tone: "info", text: `${at} ${stringValue(payload.nodeId) ?? "node"} started on ${stringValue(payload.agent) ?? "agent"}${stringValue(payload.reason) !== undefined ? ` (${stringValue(payload.reason)})` : ""}` };
    case "node.verify.iteration":
      return { tone: "info", text: `${at} ${stringValue(payload.nodeId) ?? "node"} verify: build ${stringValue(payload.build) ?? "?"}, tests ${numberValue(payload.testsPass) ?? 0}/${numberValue(payload.testsTotal) ?? 0}` };
    case "node.verify.passed":
      return { tone: "good", text: `${at} ${stringValue(payload.nodeId) ?? "node"} passed: ${shortSha(stringValue(payload.commit)) ?? "no commit"}` };
    case "node.verify.failed":
      return { tone: "warn", text: `${at} ${stringValue(payload.nodeId) ?? "node"} verify failed: ${compact(stringValue(payload.cause), 72)}` };
    case "node.repair.started":
      return { tone: "info", text: `${at} ${stringValue(payload.nodeId) ?? "node"} repair: ${compact(stringValue(payload.reason), 72)}` };
    case "node.execution.failed":
      return { tone: "bad", text: `${at} ${stringValue(payload.nodeId) ?? "node"} failed: ${compact(stringValue(payload.cause), 72)}` };
    case "node.cli.output": {
      if (stringValue(payload.stream) !== "stderr") return null;
      return { tone: "warn", text: `${at} ${stringValue(payload.nodeId) ?? "node"} stderr: ${compact(stringValue(payload.chunk), 72)}` };
    }
    case "integration.started":
      return { tone: "info", text: `${at} integration started: ${stringValue(payload.compositeNodeId) ?? "root"}` };
    case "integration.validated":
      return { tone: payload.passed === true ? "good" : "warn", text: `${at} integration tests ${numberValue(payload.testsPass) ?? 0}/${numberValue(payload.testsTotal) ?? 0}` };
    case "integration.completed":
      return { tone: stringValue(payload.status) === "success" ? "good" : "bad", text: `${at} integration ${stringValue(payload.status) ?? "done"}: ${shortSha(stringValue(payload.commit)) ?? "no commit"}` };
    case "conflict.detected":
      return { tone: payload.autoResolvable === true ? "warn" : "bad", text: `${at} conflict ${stringValue(payload.dimension) ?? "unknown"}: ${stringArray(payload.files).join(", ") || "no files"}` };
    case "conflict.resolved":
      return { tone: "good", text: `${at} conflict resolved: ${stringValue(payload.conflictId) ?? "unknown"}` };
    case "decision.raised":
      return { tone: "human", text: `${at} decision: ${stringValue(payload.kind) ?? "unknown"}${payload.blocking === true ? " (blocking)" : ""}` };
    case "decision.resolved":
      return { tone: "human", text: `${at} decision resolved: ${stringValue(payload.decisionId) ?? "unknown"}` };
    case "run.evidence.ready":
      return { tone: "good", text: `${at} evidence ready` };
    case "run.completed":
      return { tone: stringValue(payload.status) === "success" ? "good" : "bad", text: `${at} run ${stringValue(payload.status) ?? "completed"}` };
    default:
      if (type.length === 0 || type === "run.status.changed" || type === "run.scheduling.wave_selected") return null;
      return { tone: "info", text: `${at} ${type}` };
  }
}

function derivePhase(input) {
  if (input.evidence !== null || input.completedStatus !== null || ["completed", "completed_with_accepted", "failed", "interrupted"].includes(input.controlStatus)) {
    return "disposition";
  }
  if (input.activeConflicts.length > 0 || input.seenEventFamilies.has("integration")) return "reconciliation";
  if (input.activeNodes.length > 0 || input.seenEventFamilies.has("node") || input.seenEventFamilies.has("wave")) return "supervision";
  if (input.seenEventFamilies.has("grounding") || input.seenEventFamilies.has("seam") || input.seenEventFamilies.has("scope")) return "foundation";
  if (input.seenEventFamilies.has("plan") || input.seenEventFamilies.has("decision")) return "proposal";
  return "framing";
}

function deriveHealth(input) {
  if (input.completedStatus === "failed" || input.controlStatus === "failed" || input.failedNodes.length > 0) return "failing";
  if (input.pendingDecisions.some((decision) => decision.blocking) || input.activeConflicts.some((conflict) => conflict.autoResolvable !== true)) {
    return "attention";
  }
  if (input.activeNodes.length > 0 || ["generating", "approved", "running"].includes(input.controlStatus)) return "working";
  return "settled";
}

function headerLine(model) {
  const server = model.server?.status ?? "starting";
  const sse = model.sse?.status ?? "idle";
  const process = model.process?.status ?? "starting";
  const uptime = model.startedAt !== undefined ? `uptime ${formatDuration(Date.now() - Number(model.startedAt))}` : "uptime n/a";
  return `Server ${server.toUpperCase()} | Stream ${sse.toUpperCase()} | Process ${process.toUpperCase()} | ${uptime}`;
}

function runLine(model) {
  if (model.run === null || model.run === undefined) {
    return "Run: waiting for the first run. Open the web app and start a run.";
  }
  const context = model.context?.repo !== undefined ? ` | Repo ${trimPath(model.context.repo)} @ ${model.context.baseCommit ?? "?"}` : "";
  return `Run: ${model.run.title ?? model.run.userPrompt ?? model.run.id} | Status ${model.controlStatus}${context}`;
}

function attentionLines(model) {
  if (model.pendingDecisions.length === 0 && model.activeConflicts.length === 0) {
    const active = model.activeNodes.length;
    return [`[OK] Nada requiere tu atencion. ${active} agente${active === 1 ? "" : "s"} trabajando.`];
  }

  const lines = [];
  for (const decision of model.pendingDecisions.slice(0, 5)) {
    const scope = decision.nodeIds.length > 0 ? ` nodes ${decision.nodeIds.join(", ")}` : "";
    lines.push(`[${decision.blocking ? "BLOCK" : "INFO"}] ${decision.kind}: ${decision.question ?? decision.id}${scope}`);
  }
  for (const conflict of model.activeConflicts.slice(0, 3)) {
    lines.push(`[CONFLICT] ${conflict.dimension}: ${conflict.files.join(", ") || conflict.id}`);
  }
  return lines;
}

function wavefrontLines(model, options) {
  const width = options.width ?? 98;
  if (model.activeNodes.length === 0) {
    const totals = statusTotals(model.nodes);
    return [`No active agents. done ${totals.done} | waiting ${totals.idle} | failed ${totals.failed}`];
  }
  return model.activeNodes.slice(0, 10).map((node) => formatNodeLine(node, width));
}

function planMapLines(model, options) {
  const max = options.max ?? 8;
  if (model.nodes.length === 0) {
    if (model.planStats !== null) return [`Plan ready: ${model.planStats.nodeCount} nodes, ${model.planStats.seamCount} seams.`];
    return ["No plan nodes yet."];
  }

  const byParent = new Map();
  for (const node of model.nodes) {
    const key = node.parentId ?? "__root__";
    const children = byParent.get(key) ?? [];
    children.push(node);
    byParent.set(key, children);
  }
  for (const children of byParent.values()) children.sort(compareNodes);

  const roots = byParent.get("__root__") ?? model.nodes.filter((node) => node.depth === 0).slice(0, 1);
  const lines = [];
  for (const root of roots) {
    pushTree(lines, byParent, root, "", max);
    if (lines.length >= max) break;
  }
  const omitted = model.nodes.length - lines.length;
  if (omitted > 0) lines.push(`... ${omitted} more node${omitted === 1 ? "" : "s"}`);
  return lines;
}

function pushTree(lines, byParent, node, prefix, max) {
  if (lines.length >= max) return;
  lines.push(`${prefix}${statusBadge(node.status)} ${node.title ?? node.id}`);
  const children = byParent.get(node.id) ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const last = index === children.length - 1;
    pushTree(lines, byParent, children[index], `${prefix}${last ? "`- " : "|- "}`, max);
  }
}

function timelineLines(model, options) {
  const max = options.max ?? 8;
  const width = options.width ?? 98;
  if (model.timeline.length === 0) return ["Waiting for run events..."];
  return model.timeline.slice(-max).map((entry) => tonePrefix(entry.tone) + truncate(stripAnsi(entry.text), width - 4));
}

function processLines(model, options) {
  const width = options.width ?? 98;
  const max = options.max ?? 4;
  const lines = model.process?.lines ?? [];
  if (lines.length === 0) return ["Starting dev process..."];
  return lines.slice(-max).map((line) => truncate(stripAnsi(line), width));
}

function formatNodeLine(node, width) {
  const left = `${statusBadge(node.status)} ${node.title ?? node.id}`;
  const detail = nodeDetail(node);
  const age = node.startedAt !== undefined ? formatDuration(Date.now() - Date.parse(node.startedAt)) : "";
  return truncate(`${left.padEnd(34, " ")} ${detail.padEnd(34, " ")} ${age}`, width);
}

function nodeDetail(node) {
  if (node.status === "verifying" && node.verify !== undefined) {
    return `verify ${node.verify.iteration}/${node.verify.maxIterations} build ${node.verify.build} tests ${node.verify.testsPass}/${node.verify.testsTotal}`;
  }
  if (node.status === "running") return `${node.agent ?? "agent"} ${node.model ?? ""}`.trim();
  if (node.status === "repairing") return `repair ${node.reason ?? ""}`.trim();
  if (node.status === "integrating") return `integrating ${node.childNodeIds?.length ?? 0} children`;
  if (node.status === "failed") return node.cause ?? "failed";
  if (node.status === "done") return `commit ${node.commit ?? "?"} files ${node.changedFiles?.length ?? 0}`;
  return node.goal ?? "";
}

function colorize(output) {
  return output
    // Border lines
    .replace(/^(\+-+\+)$/gm, A.dim + "$1" + A.reset)
    // Section header lines: "| -- Title ---...--- |"
    .replace(/^(\| -- \S.+?-+ *\|)$/gm, A.dim + "$1" + A.reset)
    // Timeline tone prefixes (after "| ")
    .replace(/(\| )\+ /g, "$1" + A.brightGreen + "+" + A.reset + " ")
    .replace(/(\| )! /g, "$1" + A.brightYellow + "!" + A.reset + " ")
    .replace(/(\| )x /g, "$1" + A.brightRed + "x" + A.reset + " ")
    .replace(/(\| )\? /g, "$1" + A.brightCyan + "?" + A.reset + " ")
    .replace(/(\| )- /g, "$1" + A.dim + "-" + A.reset + " ")
    // Status badges
    .replace(/\[RUN \]/g, A.brightGreen + "[RUN ]" + A.reset)
    .replace(/\[TEST\]/g, A.brightYellow + "[TEST]" + A.reset)
    .replace(/\[FIX \]/g, A.brightYellow + "[FIX ]" + A.reset)
    .replace(/\[JOIN\]/g, A.cyan + "[JOIN]" + A.reset)
    .replace(/\[DONE\]/g, A.green + "[DONE]" + A.reset)
    .replace(/\[FAIL\]/g, A.brightRed + "[FAIL]" + A.reset)
    .replace(/\[WAIT\]/g, A.yellow + "[WAIT]" + A.reset)
    .replace(/\[IDLE\]/g, A.dim + "[IDLE]" + A.reset)
    // Attention prefixes
    .replace(/\[OK\]/g, A.brightGreen + "[OK]" + A.reset)
    .replace(/\[BLOCK\]/g, A.brightRed + "[BLOCK]" + A.reset)
    .replace(/\[INFO\]/g, A.cyan + "[INFO]" + A.reset)
    .replace(/\[CONFLICT\]/g, A.brightRed + "[CONFLICT]" + A.reset)
    // Health status
    .replace(/Health WORKING/g, "Health " + A.brightGreen + "WORKING" + A.reset)
    .replace(/Health ATTENTION/g, "Health " + A.brightYellow + "ATTENTION" + A.reset)
    .replace(/Health FAILING/g, "Health " + A.brightRed + "FAILING" + A.reset)
    .replace(/Health SETTLED/g, "Health " + A.dim + "SETTLED" + A.reset)
    // Phase current indicator (e.g. [FRAMING], not status badges which have trailing spaces)
    .replace(/\[(FRAMING|PROPOSAL|FOUNDATION|SUPERVISION|RECONCILIATION|DISPOSITION)\]/g, A.bold + A.brightCyan + "[$1]" + A.reset)
    // Phase arrows
    .replace(/ -> /g, A.dim + " -> " + A.reset)
    // Server/stream/process status words in header
    .replace(/(Server |Stream |Process )(PROBING|STARTING|CONNECTING|RETRYING)/g, "$1" + A.yellow + "$2" + A.reset)
    .replace(/(Server |Stream |Process )(READY|RUNNING|CONNECTED)/g, "$1" + A.brightGreen + "$2" + A.reset)
    .replace(/(Server |Stream |Process )(OFFLINE|FAILED|EXITED)/g, "$1" + A.brightRed + "$2" + A.reset)
    .replace(/(Server |Stream |Process )(IDLE|ATTACHED)/g, "$1" + A.dim + "$2" + A.reset)
    // Process log line prefixes
    .replace(/\[stdout\]/g, A.dim + "[stdout]" + A.reset)
    .replace(/\[stderr\]/g, A.brightYellow + "[stderr]" + A.reset)
    .replace(/\[manyhands\]/g, A.cyan + "[manyhands]" + A.reset)
    // Placeholder / idle messages
    .replace(/(No plan nodes yet\.|Waiting for run events\.\.\.|Starting dev process\.\.\.)/g, A.dim + "$1" + A.reset)
    .replace(/(No active agents\. done \d+ \| waiting \d+ \| failed \d+)/g, A.dim + "$1" + A.reset);
}

function section(title, sectionLines, width) {
  const lines = [row(`-- ${title} ${"-".repeat(Math.max(0, width - title.length - 8))}`, width)];
  for (const line of sectionLines) lines.push(row(line, width));
  return lines;
}

function phaseBar(activePhase, width) {
  const labels = PHASES.map((phase) => (phase === activePhase ? `[${phase.toUpperCase()}]` : phase));
  return truncate(labels.join(" -> "), Math.max(20, width));
}

function statusTotals(nodes) {
  const totals = { done: 0, idle: 0, failed: 0 };
  for (const node of nodes) {
    if (node.status === "done") totals.done += 1;
    else if (node.status === "failed") totals.failed += 1;
    else totals.idle += 1;
  }
  return totals;
}

function ensureNode(nodes, nodeId) {
  const current = nodes.get(nodeId);
  if (current !== undefined) return current;
  const node = {
    id: nodeId,
    title: nodeId,
    goal: "",
    parentId: null,
    role: "leaf",
    depth: 0,
    status: "idle"
  };
  nodes.set(nodeId, node);
  return node;
}

function compareNodes(left, right) {
  return (left.depth - right.depth) || String(left.title ?? left.id).localeCompare(String(right.title ?? right.id));
}

function statusBadge(status) {
  switch (status) {
    case "running":
      return "[RUN ]";
    case "verifying":
      return "[TEST]";
    case "repairing":
      return "[FIX ]";
    case "integrating":
      return "[JOIN]";
    case "done":
      return "[DONE]";
    case "failed":
      return "[FAIL]";
    case "blocked":
      return "[WAIT]";
    default:
      return "[IDLE]";
  }
}

function tonePrefix(tone) {
  switch (tone) {
    case "good":
      return "+ ";
    case "warn":
      return "! ";
    case "bad":
      return "x ";
    case "human":
      return "? ";
    default:
      return "- ";
  }
}

function row(text, width) {
  return `| ${truncate(text, Math.max(0, width - 4)).padEnd(Math.max(0, width - 4), " ")} |`;
}

function border(width) {
  return `+${"-".repeat(Math.max(0, width - 2))}+`;
}

function fitHeight(lines, height, width) {
  if (lines.length <= height) return lines;
  const headCount = Math.max(8, height - 6);
  const output = lines.slice(0, headCount);
  output.push(row(`... ${lines.length - height + 1} lines hidden by terminal height`, width));
  output.push(...lines.slice(-(height - output.length)));
  return output.slice(0, height);
}

function familyOf(type) {
  if (type.includes(".")) return type.split(".")[0];
  return type;
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOrUndefined(value) {
  const number = numberValue(value);
  return number === undefined ? undefined : number;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortSha(value) {
  return value === undefined ? undefined : value.slice(0, 7);
}

function compact(value, max = 80) {
  return truncate(String(value ?? "").replace(/\s+/g, " ").trim(), max);
}

function truncate(value, max) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
}

function stripAnsi(value) {
  return String(value ?? "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function trimPath(value) {
  if (value === undefined) return "";
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.length <= 2 ? normalized : `.../${parts.slice(-2).join("/")}`;
}

function formatClock(value) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
