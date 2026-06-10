/**
 * Route-level loading UI for /runs/[runId]. The run page is `force-dynamic` and
 * projects an event log on the server, so navigation can take a beat — show a
 * skeleton that matches the agent-first layout instead of a blank screen.
 */
export default function RunLoading(): React.ReactElement {
  return (
    <div className="mh-fullbleed" aria-busy="true" aria-label="Cargando run">
      <div className="mh-run-page">
        <div className="mh-run-main">
          <header className="mh-run-hero">
            <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 6 }}>
              <div className="mh-skeleton" style={{ width: 96, height: 12, borderRadius: 4 }} />
              <div className="mh-skeleton" style={{ width: "min(560px, 82%)", height: 42, borderRadius: 8 }} />
              <div className="mh-skeleton" style={{ width: "min(440px, 62%)", height: 14, borderRadius: 4 }} />
            </div>
          </header>
          <div
            className="mh-skeleton"
            style={{ width: "100%", height: "min(620px, calc(100dvh - 260px))", minHeight: 480 }}
          />
        </div>
      </div>
    </div>
  );
}
