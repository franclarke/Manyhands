"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/workspaces", label: "Workspaces" },
  { href: "/lab", label: "Lab" },
  { href: "/replay", label: "Replay" }
];

export function AppNav(): React.ReactElement {
  const pathname = usePathname();

  return (
    <header
      style={{
        borderBottom: "1px solid var(--border)",
        background: "rgba(26, 25, 21, 0.86)",
        backdropFilter: "blur(8px)"
      }}
    >
      <div className="mh-container flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 6,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--coral)"
            }}
          >
            <svg width={16} height={16} viewBox="0 0 14 14">
              <circle cx="3" cy="3" r="1.5" fill="currentColor" />
              <circle cx="11" cy="3" r="1.5" fill="currentColor" />
              <circle cx="7" cy="9" r="1.5" fill="currentColor" />
              <circle cx="11" cy="13" r="1.2" fill="currentColor" opacity="0.55" />
              <line x1="3.5" y1="4" x2="6.5" y2="8" stroke="currentColor" strokeWidth="1.1" />
              <line x1="10.5" y1="4" x2="7.5" y2="8" stroke="currentColor" strokeWidth="1.1" />
              <line x1="8" y1="10" x2="10.5" y2="12.5" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
            </svg>
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span
              className="mh-serif"
              style={{ fontSize: 17, color: "var(--text)" }}
            >
              ManyHands
            </span>
            <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
              visual orchestration workspace
            </span>
          </span>
        </Link>
        <nav className="flex flex-wrap gap-1.5">
          {navItems.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: "7px 12px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: `1px solid ${active ? "var(--coral)" : "var(--border)"}`,
                  background: active ? "rgba(204,120,92,0.10)" : "var(--surface)",
                  color: active ? "var(--coral-hi)" : "var(--text-2)",
                  transition: "background 150ms ease-out, border-color 150ms ease-out"
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
