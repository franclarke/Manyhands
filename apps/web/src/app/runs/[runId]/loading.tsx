/**
 * Route-level loading UI for /runs/[runId]. The run page is `force-dynamic` and
 * projects an event log on the server, so navigation can take a beat — show a
 * structural skeleton that matches the cockpit layout (header | chat | canvas)
 * instead of a blank screen.
 */
export default function RunLoading(): React.ReactElement {
  return (
    <div className="mh-workspace-frame" aria-busy="true" aria-label="Cargando run">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)]">
        {/* Header skeleton */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
          <div className="mh-skeleton h-5 w-24" />
          <div className="mh-skeleton h-5 w-64" />
          <div className="mh-skeleton h-5 w-16" />
          <div className="ml-auto flex items-center gap-3">
            <div className="mh-skeleton h-4 w-28" />
            <div className="mh-skeleton h-4 w-20" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* Chat panel skeleton */}
          <div className="flex w-[30%] min-w-[240px] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex h-11 items-center gap-2 border-b border-[var(--color-border)] px-5">
              <div className="mh-skeleton h-4 w-24" />
            </div>
            <div className="flex flex-1 flex-col gap-4 px-5 py-5">
              <div className="mh-skeleton h-16 w-[85%]" />
              <div className="mh-skeleton ml-auto h-9 w-[55%]" />
              <div className="mh-skeleton h-20 w-[85%]" />
            </div>
            <div className="border-t border-[var(--color-border)] p-4">
              <div className="mh-skeleton h-11 w-full" />
            </div>
          </div>
          {/* Canvas skeleton */}
          <div className="relative flex-1 bg-[var(--color-bg)]">
            <div className="absolute left-0 right-0 top-0 flex h-11 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              <div className="mh-skeleton h-4 w-16" />
              <div className="mh-skeleton h-4 w-12" />
              <div className="mh-skeleton h-4 w-20" />
              <div className="mh-skeleton h-4 w-16" />
            </div>
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-8">
                <div className="mh-skeleton h-[76px] w-[200px]" />
                <div className="flex flex-col gap-6">
                  <div className="mh-skeleton h-[76px] w-[200px]" />
                  <div className="mh-skeleton h-[76px] w-[200px]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
