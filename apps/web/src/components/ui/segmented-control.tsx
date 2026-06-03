export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Renders the segment as non-interactive (e.g. a future/unavailable mode). */
  disabled?: boolean;
  /** Native tooltip — useful to explain why a segment is disabled. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Let the control fill its container instead of hugging its content. */
  fluid?: boolean;
}

/**
 * Tokenized segmented control. Generalizes the inline canvas/timeline/board
 * toggle so the same affordance can be reused (view switch, summary tabs,
 * granularity, …). Supports disabled segments for future/unavailable modes.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  fluid = false
}: SegmentedControlProps<T>): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        alignSelf: fluid ? "stretch" : "flex-start",
        display: fluid ? "flex" : "inline-flex",
        width: fluid ? "100%" : undefined,
        border: "1px solid var(--color-border-control)",
        background: "rgba(241,234,216,0.035)",
        borderRadius: "var(--r-lg)",
        padding: 3
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        const disabled = option.disabled === true;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            disabled={disabled}
            title={option.title}
            onClick={() => {
              if (!disabled) onChange(option.value);
            }}
            style={{
              flex: fluid ? 1 : undefined,
              border: "none",
              minHeight: 34,
              background: active ? "rgba(241,234,216,0.11)" : "transparent",
              color: disabled
                ? "var(--color-text-faint)"
                : active
                  ? "var(--color-text)"
                  : "var(--color-text-muted)",
              borderRadius: "var(--r-md)",
              padding: "0 12px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              textTransform: "capitalize",
              transition: "background 150ms ease-out, color 150ms ease-out"
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
