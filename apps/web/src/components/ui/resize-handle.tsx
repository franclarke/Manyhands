"use client";

import { Separator } from "react-resizable-panels";

/**
 * Hairline panel divider for the control-room multipanel layout
 * (react-resizable-panels v4 Separator). The library widens the interactive
 * hit area itself (`resizeTargetMinimumSize` on the Group); this component
 * only owns the visuals: a 1px rule that brightens on hover and takes the
 * accent token while dragging, plus a grip pill for affordance.
 */
export function ResizeHandle(): React.ReactElement {
  return (
    <Separator className="group relative w-px shrink-0 cursor-col-resize bg-[var(--color-border)] outline-none transition-colors duration-150 data-[separator=hover]:bg-[var(--color-border-strong)] data-[separator=active]:bg-[var(--color-accent)]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-9 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-border-strong)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-[separator=active]:bg-[var(--color-accent)] group-data-[separator=active]:opacity-100"
      />
    </Separator>
  );
}
