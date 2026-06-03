interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
}

export function PageHeader({
  eyebrow,
  title,
  description
}: PageHeaderProps): React.ReactElement {
  return (
    <section className="mb-8">
      {eyebrow ? (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--coral)",
            marginBottom: 14
          }}
        >
          {eyebrow}
        </p>
      ) : null}
      <h1
        className="mh-serif"
        style={{
          fontSize: 40,
          lineHeight: 1.1,
          color: "var(--text)",
          maxWidth: 880,
          margin: 0
        }}
      >
        {title}
      </h1>
      <p
        style={{
          marginTop: 14,
          maxWidth: 720,
          fontSize: 15,
          lineHeight: 1.6,
          color: "var(--text-2)"
        }}
      >
        {description}
      </p>
    </section>
  );
}
