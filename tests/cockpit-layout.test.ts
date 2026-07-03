/**
 * Cockpit layout — pure viewport→layout decisions for the run workspace.
 *
 * The run cockpit is a horizontal multipanel: [sidebar] chat | artifacts | focus.
 * On a wide desktop the focus panel docks as a resizable third column. On a
 * narrower viewport that third column would steal width from chat AND from the
 * DAG canvas, clipping both — the named limitation from blocks 2–5. Below a
 * derived threshold the focus panel must instead float as an overlay drawer so
 * chat + artifacts keep their space. This decision is pure and node-testable.
 */
import { describe, expect, it } from "vitest";
import {
  FOCUS_DOCK_BREAKPOINT,
  RUN_DOCK_BREAKPOINT,
  SIDEBAR_AUTO_COLLAPSE_BREAKPOINT,
  bottomDrawerMode,
  focusDockMode,
  runDockMode,
  sidebarInitiallyCollapsed
} from "@/lib/cockpit-layout";

describe("focusDockMode", () => {
  it("docks the focus panel as a column on a wide desktop", () => {
    expect(focusDockMode(1440)).toBe("column");
    expect(focusDockMode(1920)).toBe("column");
  });

  it("floats the focus panel as an overlay on a tablet-width viewport", () => {
    expect(focusDockMode(1024)).toBe("overlay");
    expect(focusDockMode(834)).toBe("overlay");
  });

  it("switches exactly at the derived breakpoint", () => {
    // At the breakpoint there is room for all three columns; one pixel under, there isn't.
    expect(focusDockMode(FOCUS_DOCK_BREAKPOINT)).toBe("column");
    expect(focusDockMode(FOCUS_DOCK_BREAKPOINT - 1)).toBe("overlay");
  });

  it("treats an unknown/zero width as overlay (safe default before measurement)", () => {
    // SSR / first paint may report 0; the overlay never clips, so it is the safe pick.
    expect(focusDockMode(0)).toBe("overlay");
  });
});

describe("runDockMode", () => {
  it("docks the free workspace dock on wide screens", () => {
    expect(runDockMode(1440)).toBe("column");
    expect(runDockMode(RUN_DOCK_BREAKPOINT)).toBe("column");
  });

  it("uses an overlay when a dock column would crowd the graph", () => {
    expect(runDockMode(1024)).toBe("overlay");
    expect(runDockMode(RUN_DOCK_BREAKPOINT - 1)).toBe("overlay");
    expect(runDockMode(0)).toBe("overlay");
  });
});

describe("bottomDrawerMode", () => {
  it("is hidden until the user opens the drawer", () => {
    expect(bottomDrawerMode(false)).toBe("hidden");
    expect(bottomDrawerMode(true)).toBe("docked");
  });
});

describe("sidebarInitiallyCollapsed", () => {
  it("honors the stored preference on a wide viewport", () => {
    expect(sidebarInitiallyCollapsed(1440, "collapsed")).toBe(true);
    expect(sidebarInitiallyCollapsed(1440, "expanded")).toBe(false);
  });

  it("defaults to expanded on a wide viewport without a stored preference", () => {
    expect(sidebarInitiallyCollapsed(1440, null)).toBe(false);
  });

  it("starts collapsed on narrow viewports regardless of the stored preference", () => {
    // A 240px sidebar on a 375px phone leaves no room for the cockpit; the
    // stored desktop preference must not leak into the phone layout.
    expect(sidebarInitiallyCollapsed(375, "expanded")).toBe(true);
    expect(sidebarInitiallyCollapsed(375, null)).toBe(true);
    expect(sidebarInitiallyCollapsed(SIDEBAR_AUTO_COLLAPSE_BREAKPOINT - 1, "expanded")).toBe(true);
  });

  it("switches exactly at the breakpoint", () => {
    expect(sidebarInitiallyCollapsed(SIDEBAR_AUTO_COLLAPSE_BREAKPOINT, null)).toBe(false);
  });

  it("treats an unknown/zero width as collapsed (safe default before measurement)", () => {
    expect(sidebarInitiallyCollapsed(0, "expanded")).toBe(true);
  });
});
