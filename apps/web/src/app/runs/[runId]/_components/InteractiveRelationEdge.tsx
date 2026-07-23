"use client";

import { useState } from "react";
import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { TaskContractBundle } from "@manyhands/contracts";

import type { GraphRelationView } from "@/lib/run-model/presentation";
import { relationDisplayName } from "./cockpit-state";
import { SeamContractInspector } from "./SeamContractInspector";

export interface InteractiveRelationEdgeData extends Record<string, unknown> {
  relation: GraphRelationView;
  contracts: readonly TaskContractBundle[];
  sourceTitle: string;
  targetTitle: string;
}

export type InteractiveRelationFlowEdge = Edge<InteractiveRelationEdgeData, "interactiveRelation">;

export function InteractiveRelationEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  data
}: EdgeProps<InteractiveRelationFlowEdge>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10 });
  const label = data === undefined
    ? "Inspeccionar relación"
    : `${relationDisplayName(data.relation.kind)}: ${data.sourceTitle} a ${data.targetTitle}`;

  return (
    <>
      <BaseEdge id={id} path={path} {...(markerEnd === undefined ? {} : { markerEnd })} {...(style === undefined ? {} : { style })} />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        tabIndex={0}
        role="button"
        aria-label={label}
        className="cursor-pointer focus-visible:stroke-[var(--color-accent)] focus-visible:stroke-opacity-30 focus-visible:outline-none"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {data !== undefined ? (
        <SeamContractInspector
          relation={data.relation}
          contracts={data.contracts}
          sourceTitle={data.sourceTitle}
          targetTitle={data.targetTitle}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
