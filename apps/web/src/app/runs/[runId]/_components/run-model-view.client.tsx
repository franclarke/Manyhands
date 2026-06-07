"use client";

import { useCallback, useMemo, useState } from "react";
import { EVIDENCE_FOCUS_TARGET, buildFocusView, type FocusTarget } from "@/lib/run-model/focus-view";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import { buildTimelineView } from "@/lib/run-model/timeline-view";
import type { DecisionChoice, Run, RunEvent } from "@/lib/run-model/types";
import { FocusPanel } from "@/components/run-model/focus-panel";
import { MinimalRunGraphCanvas } from "@/components/run-model/minimal-run-graph";
import { Timeline } from "@/components/run-model/timeline";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";

export function RunModelView({ seed, initialEvents }: { seed: Run; initialEvents: RunEvent[] }): React.ReactElement {
  const { model, events, connected, streamCount } = useLiveRunModel(seed, initialEvents);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const view = useMemo(() => selectMinimalWorkspaceView(model), [model]);
  const timeline = useMemo(() => buildTimelineView(events), [events]);
  const focusView = useMemo(() => (focus !== null ? buildFocusView(model, focus) : null), [model, focus]);

  const onResolve = useCallback(
    (id: string) => {
      const decision = model.decisions.get(id);
      if (decision === undefined) return;
      const choice = defaultChoiceFor(decision.kind, decision.context.options);
      void fetch(`/api/runs/${encodeURIComponent(seed.id)}/decisions/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice })
      });
    },
    [model, seed.id]
  );

  return (
    <div className={focusView !== null ? "mh-run-page mh-run-page-with-focus" : "mh-run-page"}>
      <div className="mh-run-main">
        <RunHero
          title={view.title}
          intent={seed.intent}
          stage={view.stage}
          statusLine={view.statusLine}
          connected={connected}
        />

        {view.primaryAttention !== null ? (
          <DecisionBanner
            item={view.primaryAttention}
            pendingCount={view.pendingAttentionCount}
            onResolve={onResolve}
            onInspect={(id) => setFocus({ kind: "decision", id })}
          />
        ) : null}

        {view.reviewEvidence !== null && view.stage === "review" ? (
          <ReviewEvidence
            evidence={view.reviewEvidence}
            onInspect={() => setFocus(EVIDENCE_FOCUS_TARGET)}
          />
        ) : null}

        <MinimalRunGraphCanvas
          graph={view.graph}
          stage={view.stage}
          selectedTarget={focus}
          onFocus={setFocus}
        />

        <ActivityDrawer
          open={activityOpen}
          onToggle={() => setActivityOpen((open) => !open)}
          eventCount={events.length}
          streamCount={streamCount}
          focusedNodeId={focus?.kind === "node" ? focus.id : null}
        >
          <Timeline view={timeline} focusedNodeId={focus?.kind === "node" ? focus.id : null} />
        </ActivityDrawer>
      </div>

      {focusView !== null ? (
        <aside className="mh-run-focus" aria-label="Run detail inspector">
          <FocusPanel view={focusView} onClose={() => setFocus(null)} onFocus={setFocus} />
        </aside>
      ) : null}
    </div>
  );
}

function RunHero({
  title,
  intent,
  stage,
  statusLine,
  connected
}: {
  title: string;
  intent: string;
  stage: string;
  statusLine: string;
  connected: boolean;
}): React.ReactElement {
  return (
    <header className="mh-run-hero">
      <div>
        <span className="mh-run-stage">{stageLabel(stage)}</span>
        <h1>{title}</h1>
        <p>{statusLine}</p>
      </div>
      <div className="mh-run-hero-side">
        <span className={connected ? "mh-live mh-live-on" : "mh-live"}>{connected ? "live" : "offline"}</span>
        <span>{compactIntent(intent)}</span>
      </div>
    </header>
  );
}

function DecisionBanner({
  item,
  pendingCount,
  onResolve,
  onInspect
}: {
  item: NonNullable<ReturnType<typeof selectMinimalWorkspaceView>["primaryAttention"]>;
  pendingCount: number;
  onResolve: (id: string) => void;
  onInspect: (id: string) => void;
}): React.ReactElement {
  return (
    <section className={item.blocking ? "mh-decision-banner mh-decision-banner-blocking" : "mh-decision-banner"}>
      <div>
        <span>{item.blocking ? "Needs your call" : "For review"}</span>
        <strong>{item.label}</strong>
        <p>{item.summary}</p>
      </div>
      <div className="mh-decision-actions">
        {pendingCount > 1 ? <small>{pendingCount} pending</small> : null}
        <button type="button" className="mh-secondary-action" onClick={() => onInspect(item.id)}>
          Inspect
        </button>
        <button type="button" className="mh-primary-action" onClick={() => onResolve(item.id)}>
          {item.primaryActionLabel}
        </button>
      </div>
    </section>
  );
}

function ReviewEvidence({
  evidence,
  onInspect
}: {
  evidence: NonNullable<ReturnType<typeof selectMinimalWorkspaceView>["reviewEvidence"]>;
  onInspect: () => void;
}): React.ReactElement {
  return (
    <section className="mh-review-strip">
      <div>
        <span>Evidence</span>
        <strong>Tests {evidence.tests.pass}/{evidence.tests.total}</strong>
        <p>Integrated at {evidence.integrationCommit}. The graph stays available for context.</p>
      </div>
      <button type="button" className="mh-secondary-action" onClick={onInspect}>
        Open evidence
      </button>
    </section>
  );
}

function ActivityDrawer({
  open,
  onToggle,
  eventCount,
  streamCount,
  focusedNodeId: _focusedNodeId,
  children
}: {
  open: boolean;
  onToggle: () => void;
  eventCount: number;
  streamCount: number;
  focusedNodeId: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className={open ? "mh-activity mh-activity-open" : "mh-activity"}>
      <button type="button" onClick={onToggle} className="mh-activity-toggle">
        <span>Activity</span>
        <small>{eventCount} events · {streamCount} streamed</small>
      </button>
      {open ? <div className="mh-activity-body">{children}</div> : null}
    </section>
  );
}

function defaultChoiceFor(kind: string, options: readonly string[] | undefined): DecisionChoice {
  if (kind === "clarify") return { answer: options?.[0] ?? "" };
  if (kind === "resolve_conflict") return { resolutionId: "human-selected" };
  if (kind === "approve_merge") return { action: "accept" };
  return { action: "approve" };
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "intent":
      return "Intent";
    case "proposal":
      return "Plan";
    case "review":
      return "Review";
    case "running":
    default:
      return "Run";
  }
}

function compactIntent(intent: string): string {
  if (intent.length <= 96) return intent;
  return `${intent.slice(0, 93)}...`;
}
