"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { formatSelectionValue, selectableModelOptions, type ModelCapability, type ModelOption } from "@/lib/models";
import { formatRate } from "@/lib/model-pricing";

interface ModelPickerProps {
  /** Selection string "executorId/modelId". */
  value: string;
  onChange: (value: string) => void;
  capability?: ModelCapability;
}

/**
 * Claude-style single model control: a compact trigger that opens a menu of the
 * enabled models grouped by provider, each annotated with its price, with a
 * checkmark on the active one.
 */
export function ModelPicker({ value, onChange, capability }: ModelPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = selectableModelOptions(capability);
  const selected = options.find((option) => formatSelectionValue({ executorId: option.executorId, model: option.id }) === value);
  const grouped = groupByProvider(options);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-meta font-medium text-[var(--color-text)] transition-colors duration-150 hover:border-[var(--color-border-strong)]"
      >
        <span className="truncate">{selected?.label ?? "Elegir modelo"}</span>
        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-subtle)]" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="mh-elev-sheet absolute bottom-full left-0 z-30 mb-1.5 max-h-[60vh] w-[280px] overflow-y-auto rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1"
        >
          {grouped.map(([provider, models]) => (
            <div key={provider} className="mb-0.5">
              <div className="mh-mono px-2 pb-0.5 pt-1.5 text-eyebrow uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">
                {provider}
              </div>
              {models.map((option) => {
                const optionValue = formatSelectionValue({ executorId: option.executorId, model: option.id });
                const active = optionValue === value;
                const rate = formatRate(option.id);
                return (
                  <button
                    key={optionValue}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(optionValue);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)]"
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--color-accent)]">
                      {active ? <Check aria-hidden className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 text-label font-medium text-[var(--color-text)]">
                        {option.label}
                        {option.capabilities.includes("planning") ? null : (
                          <span className="mh-mono rounded bg-[var(--color-bg-subtle)] px-1 py-px text-eyebrow text-[var(--color-text-subtle)]">
                            solo ejecución
                          </span>
                        )}
                      </span>
                      {rate !== undefined ? (
                        <span className="mh-mono text-eyebrow text-[var(--color-text-subtle)]">{rate}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function groupByProvider(options: readonly ModelOption[]): Array<[string, ModelOption[]]> {
  const map = new Map<string, ModelOption[]>();
  for (const option of options) {
    const list = map.get(option.provider) ?? [];
    list.push(option);
    map.set(option.provider, list);
  }
  return Array.from(map.entries());
}
