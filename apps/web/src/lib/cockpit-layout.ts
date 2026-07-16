/**
 * Cockpit layout — pure viewport→layout decisions for the run workspace.
 *
 * PURE and node-testable: no React, no DOM. The component reads the live viewport
 * width through a thin hook and delegates the actual decision here so the
 * threshold is single-sourced and covered by tests.
 */

export type FocusDockMode = "column" | "overlay";
export type DockAttachmentMode = "column" | "overlay";
export type BottomDrawerMode = "docked" | "hidden";

/**
 * Below this viewport width the focus panel floats as an overlay drawer instead
 * of docking as a resizable third column.
 *
 * Derivation (assuming the expanded sidebar, the common case):
 *   sidebar 240 + chat-min 240 + a usable DAG canvas ~380 + focus-min 300
 *   + two resize handles ~16 ≈ 1176 → rounded to 1180.
 * Under it, a third docked column would clip both the chat and the canvas — the
 * limitation called out across blocks 2–5. Collapsing the sidebar is an escape
 * hatch that frees width within the same arrangement; it does not change the
 * docking decision.
 */
export const FOCUS_DOCK_BREAKPOINT = 1180;
export const RUN_DOCK_BREAKPOINT = 1180;

/** How the focus panel should attach at a given viewport width. */
export function focusDockMode(viewportWidth: number): FocusDockMode {
  return viewportWidth >= FOCUS_DOCK_BREAKPOINT ? "column" : "overlay";
}

/** How the free-form workspace dock should attach at a given viewport width. */
export function runDockMode(viewportWidth: number): DockAttachmentMode {
  return viewportWidth >= RUN_DOCK_BREAKPOINT ? "column" : "overlay";
}

/** The drawer is available only when the user explicitly opens it. */
export function bottomDrawerMode(open: boolean): BottomDrawerMode {
  return open ? "docked" : "hidden";
}

/**
 * Below this width the 240px app sidebar starves the cockpit (a 375px phone
 * keeps ~135px for graph + chat), so it must start collapsed no matter what
 * the user preferred on desktop. The stored preference only applies at widths
 * where an expanded sidebar still leaves a usable workspace.
 */
export const SIDEBAR_AUTO_COLLAPSE_BREAKPOINT = 900;

export type SidebarStoredPreference = "collapsed" | "expanded" | null;

/** Whether the app sidebar should mount collapsed at a given viewport width. */
export function sidebarInitiallyCollapsed(
  viewportWidth: number,
  stored: SidebarStoredPreference
): boolean {
  if (viewportWidth < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT) return true;
  return stored === "collapsed";
}

/**
 * The run workspace needs more horizontal room than the composer. Keep the
 * global preference on ordinary routes, but protect the DAG when entering a
 * run below the same width used by the contextual dock.
 */
export function sidebarInitiallyCollapsedForRoute(
  viewportWidth: number,
  stored: SidebarStoredPreference,
  pathname: string
): boolean {
  if (stored === "collapsed") return true;
  if (pathname.startsWith("/runs/")) return true;
  return sidebarInitiallyCollapsed(viewportWidth, stored);
}
