"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

const STORAGE_KEY = "mh-theme";

function appliedTheme(): Theme {
  return document.documentElement.dataset["theme"] === "light" ? "light" : "dark";
}

/**
 * Dark/light switch. The blocking script in `app/layout.tsx` applies the
 * persisted theme before first paint; this control only flips + persists it.
 */
export function ThemeToggle(): React.ReactElement {
  // Render a stable placeholder until mounted so SSR markup never disagrees
  // with the client-applied theme.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(appliedTheme());
  }, []);

  const toggle = (): void => {
    const next: Theme = appliedTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset["theme"] = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  };

  const label = theme === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro";
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      style={{
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        background: "transparent",
        color: "var(--color-text-subtle)",
        cursor: "pointer",
        transition: "color 150ms ease-out, border-color 150ms ease-out"
      }}
      className="hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
    >
      {theme === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
    </button>
  );
}
