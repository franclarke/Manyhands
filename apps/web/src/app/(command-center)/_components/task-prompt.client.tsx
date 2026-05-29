"use client";

import { useRef } from "react";

interface TaskPromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}

export function TaskPrompt({ value, onChange, onSubmit, disabled }: TaskPromptProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label className="mh-coord" htmlFor="manyhands-task-prompt">
        Describe the task
      </label>
      <textarea
        id="manyhands-task-prompt"
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={6}
        spellCheck={false}
        placeholder="Describe what should be built, refactored, migrated, or validated."
        style={{
          width: "100%",
          padding: "6px 0",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          borderRadius: 0,
          fontFamily: "var(--font-sans)",
          fontSize: 17,
          lineHeight: 1.55,
          resize: "vertical",
          outline: "none",
          minHeight: 156
        }}
      />
    </div>
  );
}
