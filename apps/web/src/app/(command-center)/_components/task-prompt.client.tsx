"use client";

import { useRef } from "react";

interface TaskPromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  examples?: readonly string[];
}

export function TaskPrompt({
  value,
  onChange,
  onSubmit,
  disabled,
  examples = []
}: TaskPromptProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  }

  const showExamples = examples.length > 0 && value.trim().length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <label htmlFor="manyhands-task-prompt" className="mh-coord" style={{ color: "var(--copper)" }}>
        Task
      </label>
      <textarea
        id="manyhands-task-prompt"
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={6}
        spellCheck={false}
        placeholder="Describe the task — what should the system build, refactor, or migrate?"
        style={{
          width: "100%",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text)",
          borderRadius: 0,
          fontFamily: "var(--font-sans)",
          fontSize: 17.5,
          lineHeight: 1.55,
          letterSpacing: "-0.003em",
          resize: "vertical",
          outline: "none",
          minHeight: 168
        }}
      />
      {showExamples ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="mh-coord" style={{ marginRight: 2 }}>
            try
          </span>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onChange(example)}
              className="mh-example-chip"
              style={{
                border: "1px solid var(--rule)",
                background: "transparent",
                color: "var(--text-2)",
                borderRadius: "var(--r-md)",
                padding: "6px 10px",
                fontSize: 12,
                lineHeight: 1.3,
                textAlign: "left",
                cursor: "pointer",
                transition: "border-color 150ms ease-out, color 150ms ease-out"
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
