"use client";

import { useRef } from "react";

interface TaskPromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  examples?: readonly string[];
}

export function TaskPrompt({ value, onChange, onSubmit, disabled, examples = [] }: TaskPromptProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        border: "1px solid var(--rule-strong)",
        background: "linear-gradient(180deg, rgba(229,222,204,0.045), rgba(229,222,204,0.018))",
        borderRadius: "var(--r-xl)",
        padding: 18
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <label className="mh-coord" htmlFor="manyhands-task-prompt" style={{ color: "var(--copper)" }}>
          Command input
        </label>
        <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
          Ctrl+Enter to generate
        </span>
      </div>
      <textarea
        id="manyhands-task-prompt"
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={6}
        spellCheck={false}
        placeholder="Example: Add passwordless login with magic links, tests, and session handling."
        style={{
          width: "100%",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text)",
          borderRadius: 0,
          fontFamily: "var(--font-sans)",
          fontSize: 18,
          lineHeight: 1.55,
          resize: "vertical",
          outline: "none",
          minHeight: 178
        }}
      />
      {examples.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onChange(example)}
              style={{
                border: "1px solid var(--rule)",
                background: "rgba(15,16,18,0.54)",
                color: "var(--text-2)",
                borderRadius: "var(--r-md)",
                padding: "6px 9px",
                fontSize: 12,
                cursor: "pointer"
              }}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
