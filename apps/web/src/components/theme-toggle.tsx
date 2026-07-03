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
      className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-[var(--color-border)] bg-transparent text-[var(--color-text-subtle)] transition-colors duration-150 ease-out hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
    >
      {theme === "light" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
    </button>
  );
}
