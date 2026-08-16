/**
 * Route-level loading UI for /runs/[runId]. The run page is `force-dynamic` and
 * projects an event log on the server, so navigation can take a beat. Keep this
 * structure aligned with RunModelView to avoid a layout jump when it resolves.
 */
export default function RunLoading(): React.ReactElement {
  return (
    <div
      className="mh-workspace-frame"
      role="status"
      aria-busy="true"
      aria-label="Cargando run"
      aria-live="polite"
    >
      <main
        aria-hidden="true"
        className="flex h-dvh min-h-[680px] flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]"
      >
        {/* Header skeleton */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <div className="mh-skeleton h-2.5 w-24" />
              <div className="mh-skeleton h-2.5 w-28" />
            </div>
            <div className="mh-skeleton h-5 w-80 max-w-[55vw]" />
            <div className="mh-skeleton mt-2 h-3 w-[520px] max-w-[65vw]" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="mh-skeleton h-6 w-20 rounded-full" />
            <div className="mh-skeleton h-8 w-20" />
            <div className="mh-skeleton h-8 w-8" />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
          {/* Graph workspace skeleton */}
          <section className="relative min-h-0 overflow-hidden lg:border-r lg:border-[var(--color-border)] bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [background-size:22px_22px]">
            <div className="mh-graph-toolbar absolute left-0 top-0 z-10">
              <div className="flex items-center gap-2">
                <div className="mh-skeleton h-5 w-16" />
                <div className="mh-skeleton h-5 w-20" />
                <div className="mh-skeleton h-5 w-16" />
                <div className="mh-skeleton h-5 w-20" />
              </div>
              <div className="mh-graph-toolbar-actions">
                <div className="mh-skeleton h-5 w-16" />
              </div>
            </div>

            <div className="absolute inset-0 flex items-center justify-center px-8 pt-20">
              <div className="grid grid-cols-2 gap-x-10 gap-y-10">
                <SkeletonNode className="col-span-2 mx-auto" />
                <SkeletonNode />
                <SkeletonNode />
              </div>
            </div>
          </section>

          {/* Inspector skeleton */}
          <aside className="min-h-0 overflow-y-auto bg-[var(--color-surface)]">
            <section className="border-b border-[var(--color-border)] p-5">
              <div className="mh-skeleton h-2.5 w-28" />
              <div className="mh-skeleton mt-3 h-4 w-52" />
              <div className="mt-4 grid grid-cols-3 gap-2">
                <SkeletonMetric />
                <SkeletonMetric />
                <SkeletonMetric />
              </div>
              <div className="mh-skeleton mt-4 h-3 w-full" />
              <div className="mh-skeleton mt-2 h-3 w-4/5" />
            </section>

            <section className="p-5">
              <div className="mh-skeleton h-2.5 w-24" />
              <div className="mt-4 space-y-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="flex gap-3">
                    <div className="mh-skeleton mt-1 h-2 w-2 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <div className="mh-skeleton h-3 w-full" />
                      <div className="mh-skeleton mt-2 h-2.5 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SkeletonNode({ className = "" }: { className?: string }): React.ReactElement {
  return (
    <div className={`w-[230px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="mh-skeleton h-2.5 w-16" />
        <div className="mh-skeleton h-2.5 w-14" />
      </div>
      <div className="mh-skeleton mt-3 h-3.5 w-4/5" />
      <div className="mt-2 space-y-1.5">
        <div className="mh-skeleton h-2.5 w-full" />
        <div className="mh-skeleton h-2.5 w-2/3" />
      </div>
    </div>
  );
}

function SkeletonMetric(): React.ReactElement {
  return (
    <div className="rounded-lg bg-[var(--color-bg-subtle)] p-2">
      <div className="mh-skeleton mx-auto h-4 w-8" />
      <div className="mh-skeleton mx-auto mt-2 h-2 w-10" />
    </div>
  );
}
