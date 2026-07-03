import Link from "next/link";

export default function NotFound(): React.ReactElement {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: "12vh auto 0",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        textAlign: "center",
        alignItems: "center"
      }}
    >
      <span className="mh-coord" style={{ color: "var(--copper)" }}>
        error 404
      </span>
      <h1
        className="mh-serif"
        style={{
          margin: 0,
          fontSize: "clamp(30px, 5vw, 44px)",
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
          color: "var(--text)"
        }}
      >
        No encontramos esa página.
      </h1>
      <p style={{ margin: 0, maxWidth: 420, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-2)" }}>
        El run o la ruta que buscás no existe, o todavía no se generó. Volvé al command center para
        empezar uno nuevo.
      </p>
      <Link
        href="/"
        className="mh-primary-action"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 38,
          padding: "0 16px",
          fontSize: 13,
          fontWeight: 650,
          textDecoration: "none"
        }}
      >
        Ir al command center
      </Link>
    </div>
  );
}
