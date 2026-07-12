import React from "react";

interface LogoProps {
  type?: "mark" | "full";
  className?: string;
}

export function Logo({ type = "mark", className }: LogoProps): React.ReactElement {
  if (type === "full") {
    return (
      <svg
        viewBox="0 0 300 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="ManyHands"
        className={className}
      >
        {/* mark */}
        <rect
          x="1.5"
          y="1.5"
          width="61"
          height="61"
          rx="14"
          fill="#141517"
          stroke="var(--color-text)"
          strokeOpacity={0.16}
        />
        <g stroke="var(--color-text-muted)" strokeWidth={2} strokeOpacity={0.65} strokeLinecap="round">
          <path d="M22 18 L43 32" />
          <path d="M22 32 L43 32" />
          <path d="M22 46 L43 32" />
        </g>
        <circle cx={44} cy={32} r={11} fill="var(--color-accent)" fillOpacity={0.18} />
        <g fill="var(--color-bg)" stroke="var(--color-text)" strokeWidth={2.2}>
          <circle cx={21} cy={18} r={4.2} />
          <circle cx={21} cy={32} r={4.2} />
          <circle cx={21} cy={46} r={4.2} />
        </g>
        <circle
          cx={44}
          cy={32}
          r={6}
          fill="var(--color-accent)"
          stroke="var(--color-accent-deep)"
          strokeWidth={1.5}
        />
      </svg>
    );
  }

  // mark only
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14"
        fill="#141517"
        stroke="var(--color-text)"
        strokeOpacity={0.16}
      />
      <g stroke="var(--color-text-muted)" strokeWidth={2} strokeOpacity={0.65} strokeLinecap="round">
        <path d="M22 18 L43 32" />
        <path d="M22 32 L43 32" />
        <path d="M22 46 L43 32" />
      </g>
      <circle cx={44} cy={32} r={11} fill="var(--color-accent)" fillOpacity={0.18} />
      <g fill="var(--color-bg)" stroke="var(--color-text)" strokeWidth={2.2}>
        <circle cx={21} cy={18} r={4.2} />
        <circle cx={21} cy={32} r={4.2} />
        <circle cx={21} cy={46} r={4.2} />
      </g>
      <circle
        cx={44}
        cy={32}
        r={6}
        fill="var(--color-accent)"
        stroke="var(--color-accent-deep)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
