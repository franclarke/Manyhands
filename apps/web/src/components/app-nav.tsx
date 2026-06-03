"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Command" },
  { href: "/lab", label: "Experiments" },
  { href: "/workspaces", label: "Workspaces" }
];

export function AppNav(): React.ReactElement {
  const pathname = usePathname();

  return (
    <header
      style={{
        borderBottom: "1px solid var(--rule)",
        background: "rgba(15, 16, 18, 0.82)",
        backdropFilter: "blur(10px)"
      }}
    >
      <div className="mh-container flex h-[58px] items-center justify-between gap-5">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <ManyHandsMark />
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, minWidth: 0 }}>
            <span className="mh-serif" style={{ fontSize: 17, color: "var(--text)" }}>
              ManyHands
            </span>
            <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
              orchestration lab
            </span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1.5">
          {navItems.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: "8px 11px",
                  fontSize: 13,
                  borderRadius: 4,
                  border: "1px solid transparent",
                  background: active ? "rgba(241,234,216,0.08)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-2)",
                  transition: "background 150ms ease-out, color 150ms ease-out"
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

function ManyHandsMark(): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 5,
        background: "rgba(241,234,216,0.055)",
        border: "1px solid var(--rule)",
        color: "var(--copper)"
      }}
    >
      <svg width={17} height={17} viewBox="0 0 18 18" fill="none">
        <path d="M9 2.5v4.2M9 6.7 4.5 11M9 6.7l4.5 4.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <circle cx="9" cy="2.5" r="1.6" fill="currentColor" />
        <circle cx="4.5" cy="11" r="1.6" fill="currentColor" />
        <circle cx="13.5" cy="11" r="1.6" fill="currentColor" />
        <path d="M4.5 12.6v2.2M13.5 12.6v2.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" opacity="0.55" />
      </svg>
    </span>
  );
}
