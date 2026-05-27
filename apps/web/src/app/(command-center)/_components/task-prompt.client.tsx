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
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--text-3)"
        }}
      >
        ¿Qué quieres construir?
      </label>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={6}
        spellCheck={false}
        placeholder="Describí la feature, módulo o cambio. Ej: Implementar login con email/password, validaciones, manejo de sesión y tests."
        style={{
          width: "100%",
          padding: "14px 16px",
          border: "1px solid var(--border)",
          background: "var(--bg-1)",
          color: "var(--text)",
          borderRadius: "var(--r-md)",
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          lineHeight: 1.55,
          resize: "vertical",
          outline: "none",
          minHeight: 144
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap"
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            fontFamily: "var(--font-mono)"
          }}
        >
          ⌘ + ↵ para iniciar
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={onSubmit}
          style={{
            padding: "9px 18px",
            border: `1px solid ${disabled ? "var(--border)" : "var(--coral)"}`,
            background: disabled ? "var(--surface-2)" : "var(--coral)",
            color: disabled ? "var(--text-3)" : "#1A1915",
            borderRadius: "var(--r-md)",
            fontSize: 13,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
            letterSpacing: 0.3,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            transition: "background 150ms ease-out, border-color 150ms ease-out"
          }}
        >
          <svg width={11} height={11} viewBox="0 0 18 18" fill="currentColor" aria-hidden>
            <polygon points="5 3 14 9 5 15" />
          </svg>
          Iniciar descomposición
        </button>
      </div>
    </div>
  );
}
