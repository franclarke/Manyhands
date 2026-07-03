import { useEffect, useState } from "react";

/**
 * Live viewport width, SSR-safe. Initializes from `window.innerWidth` on the
 * client (so the first client render is already correct) and 0 during SSR. The
 * resize listener is rAF-throttled to at most one update per frame.
 *
 * Pair with the pure `focusDockMode` so the breakpoint stays single-sourced and
 * tested: `focusDockMode(useViewportWidth())`.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() =>
    typeof window === "undefined" ? 0 : window.innerWidth
  );

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener("resize", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return width;
}
