export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/**
 * Tokenized segmented control. Generalizes the inline canvas/timeline/board
 * toggle so the same affordance can be reused (view switch, summary tabs, …).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: SegmentedControlProps<T>): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        alignSelf: "flex-start",
        display: "inline-flex",
        border: "1px solid var(--color-border)",
        background: "transparent",
        borderRadius: "var(--r-lg)",
        padding: 2
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            style={{
              border: "none",
              background: active ? "rgba(229,222,204,0.06)" : "transparent",
              color: active ? "var(--color-text)" : "var(--color-text-muted)",
              borderRadius: "var(--r-md)",
              padding: "6px 11px",
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              cursor: "pointer",
              textTransform: "capitalize"
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
