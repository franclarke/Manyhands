"use client";

import { useState } from "react";
import type { InspectorView } from "@/lib/graph-view-model";

export const smallButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--rule)",
  color: "var(--text-2)",
  fontSize: 11,
  padding: "3px 8px",
  cursor: "pointer",
  borderRadius: 4,
  fontFamily: "var(--font-mono)"
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--rule)",
  background: "var(--bg-1)",
  color: "var(--text)",
  borderRadius: 5,
  padding: "9px 10px",
  fontSize: 13,
  outline: "none"
};

export const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  lineHeight: 1.45,
  fontFamily: "var(--font-sans)"
};

export const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--rule)",
  background: "transparent",
  color: "var(--text-2)",
  borderRadius: 5,
  padding: "7px 11px",
  cursor: "pointer",
  fontSize: 12
};

export const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--copper)",
  background: "rgba(180,113,72,0.14)",
  color: "var(--copper-hi)",
  borderRadius: 5,
  padding: "7px 12px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
};

export function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h4 className="mh-coord" style={{ margin: 0, color: "var(--copper)" }}>
        {title}
      </h4>
      <div>{children}</div>
    </section>
  );
}

export function KvGrid({
  rows
}: {
  rows: Array<{ label: string; value: string; mono?: boolean }>;
}): React.ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 18px", fontSize: 12 }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
          <span style={{ color: "var(--text-3)" }}>{row.label}</span>
          <span
            style={{
              color: "var(--text)",
              fontFamily: row.mono ? "var(--font-mono)" : "var(--font-sans)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
            title={row.value}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MonoList({ items, empty }: { items: string[]; empty: string }): React.ReactElement {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) {
    return <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>;
  }
  const limit = 8;
  const displayed = showAll ? items : items.slice(0, limit);
  return (
    <div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 0,
          listStyle: "none",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--text-2)",
          lineHeight: 1.55
        }}
      >
        {displayed.map((item, idx) => (
          <li key={`${item}-${idx}`} style={{ wordBreak: "break-word" }}>
            {item}
          </li>
        ))}
      </ul>
      {items.length > limit ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          style={{
            marginTop: 6,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--copper)",
            fontSize: 11,
            fontFamily: "var(--font-mono)"
          }}
        >
          {showAll ? "show less" : `show ${items.length - limit} more`}
        </button>
      ) : null}
    </div>
  );
}

export function Checklist({ items, empty }: { items: string[]; empty: string }): React.ReactElement {
  if (items.length === 0) {
    return <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`} style={{ display: "flex", gap: 8, padding: "4px 0" }}>
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              border: "1px solid var(--rule-strong)",
              borderRadius: 3,
              marginTop: 3,
              flex: "0 0 auto"
            }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function LinkedNodeList({ items, empty }: { items: string[]; empty: string }): React.ReactElement {
  if (items.length === 0) {
    return <div style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((item) => (
        <span
          key={item}
          className="mh-mono"
          style={{
            border: "1px solid var(--rule)",
            background: "rgba(229,222,204,0.025)",
            color: "var(--text-2)",
            borderRadius: "var(--r-md)",
            padding: "4px 7px",
            fontSize: 11
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ border: "1px solid var(--rule)", background: "var(--bg-1)", padding: "10px 12px", borderRadius: "var(--r-md)" }}>
      {children}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--text-3)",
        fontStyle: "italic",
        padding: "10px 12px",
        border: "1px dashed var(--rule)",
        borderRadius: "var(--r-md)",
        lineHeight: 1.5
      }}
    >
      {children}
    </div>
  );
}

export function Prose({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p style={{ margin: 0, fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>{children}</p>;
}

export function Tag({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "warning" | "danger";
}): React.ReactElement {
  const palette: Record<NonNullable<typeof tone>, string> = {
    default: "var(--text-2)",
    accent: "var(--done)",
    warning: "var(--ready)",
    danger: "var(--error)"
  };
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        color: palette[tone],
        textTransform: "uppercase"
      }}
    >
      <span className="mh-dot" style={{ width: 5, height: 5 }} />
      {children}
    </span>
  );
}

export function SnippetList({
  snippets
}: {
  snippets: NonNullable<InspectorView["contract"]>["context"]["referenceSnippets"];
}): React.ReactElement {
  if (snippets.length === 0) {
    return <EmptyHint>No reference snippets declared.</EmptyHint>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {snippets.slice(0, 3).map((snippet) => (
        <Card key={snippet.path}>
          <div className="mh-mono" style={{ color: "var(--text)", fontSize: 11.5, marginBottom: 5 }}>
            {snippet.path}
          </div>
          <Prose>{snippet.content.length > 180 ? `${snippet.content.slice(0, 180)}...` : snippet.content}</Prose>
        </Card>
      ))}
    </div>
  );
}

export function InterfaceList({
  title,
  items
}: {
  title: string;
  items: NonNullable<InspectorView["contract"]>["consumedInterfaces"];
}): React.ReactElement {
  if (items.length === 0) {
    return <EmptyHint>No {title} interfaces declared.</EmptyHint>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="mh-coord" style={{ color: "var(--text-3)" }}>
        {title}
      </div>
      {items.map((item) => (
        <Card key={item.id}>
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginBottom: 5 }}>
            <Tag>{item.kind}</Tag>
            <span className="mh-mono" style={{ color: "var(--text)", fontSize: 11.5 }}>
              {item.id}
            </span>
            {item.definedAtNodeId !== undefined ? <Tag>{item.definedAtNodeId}</Tag> : null}
          </div>
          <Prose>{item.description}</Prose>
          <pre
            style={{
              margin: "7px 0 0",
              padding: 8,
              background: "var(--bg-1)",
              border: "1px solid var(--rule-soft)",
              borderRadius: 5,
              color: "var(--text-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {item.signature}
          </pre>
        </Card>
      ))}
    </div>
  );
}

export function DialogField({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mh-coord">{label}</span>
      {children}
    </label>
  );
}

export function DialogError({ message }: { message: string | null }): React.ReactElement | null {
  if (message === null) {
    return null;
  }
  return (
    <div
      style={{
        border: "1px solid rgba(178,106,96,0.35)",
        background: "rgba(178,106,96,0.08)",
        color: "var(--error)",
        borderRadius: "var(--r-md)",
        padding: "9px 10px",
        fontSize: 12,
        lineHeight: 1.45
      }}
    >
      {message}
    </div>
  );
}

export function DialogActions({
  onCancel,
  primaryLabel,
  primaryDisabled
}: {
  onCancel: () => void;
  primaryLabel: string;
  primaryDisabled: boolean;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
        Cancel
      </button>
      <button type="submit" disabled={primaryDisabled} style={primaryButtonStyle}>
        {primaryLabel}
      </button>
    </div>
  );
}

export async function errorMessageFromResponse(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // fall through to the status text
  }
  return response.statusText || `Request failed with ${response.status}`;
}
