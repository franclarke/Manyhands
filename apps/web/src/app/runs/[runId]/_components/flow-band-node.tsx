"use client";

import type { Node, NodeProps } from "@xyflow/react";

export interface FlowBandData extends Record<string, unknown> {
  level: number;
  count: number;
  width: number;
  height: number;
}

export type FlowBandFlowNode = Node<FlowBandData, "flowBand">;

/**
 * The backdrop for one topological level.
 *
 * A band is what became eligible at the same distance from the start — NOT a
 * wave. The wave was a barrier the runtime synchronised on and it was removed;
 * naming it here would put back into the operator's head the thing we took out
 * of the scheduler. For the same reason the label never mentions time: two
 * nodes on a row do not run together, they became runnable at the same depth.
 *
 * Decoration for assistive tech: the rail repeats what each node's accessible
 * name already carries, and a screen reader reading "level 2, 3 units" between
 * every node would be noise. It is `aria-hidden`, and the level travels where
 * it is useful instead.
 */
export function FlowBandNode({ data }: NodeProps<FlowBandFlowNode>): React.ReactElement {
  const { level, count, width, height } = data;
  return (
    <div
      aria-hidden="true"
      style={{ width, height }}
      className="pointer-events-none relative rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-bg-subtle)]/40"
    >
      <div className="absolute left-0 top-0 flex h-full w-[76px] flex-col justify-center gap-0.5 border-r border-[var(--color-border-soft)] px-3">
        <span className="font-mono text-xl font-semibold leading-none tabular-nums text-[var(--color-text-subtle)]">
          {level}
        </span>
        <span className="text-eyebrow font-medium uppercase leading-tight tracking-[0.14em] text-[var(--color-text-subtle)]">
          {count === 1 ? "1 unidad" : `${count} unidades`}
        </span>
      </div>
      <span className="absolute bottom-2 left-[88px] text-micro leading-none text-[var(--color-text-subtle)]">
        {level === 0 ? "sin dependencias" : `tras ${level === 1 ? "1 dependencia" : `${level} dependencias`}`}
      </span>
    </div>
  );
}
