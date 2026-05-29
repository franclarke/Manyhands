// Home — Command Center. Input as protagonist. Honest controls. Quiet recent runs.

const Home = () => {
  const [draft, setDraft] = React.useState(
    "Add idempotency to webhook handlers. Cache responses for 24h, expire via a daily job. Preserve the public URL and current auth."
  );
  const [gran, setGran] = React.useState('G6');
  const [mode, setMode] = React.useState('execution-ready');
  return (
    <div className="mh" data-screen-label="01 Command Center"
      style={{ width: '100%', height: '100%', display:'flex', flexDirection:'column' }}>

      <TopBar
        left={<Wordmark version="v0.3 · research build"/>}
        right={<>
          <button className="btn ghost sm"><Icon name="notebook" size={12}/>Experiments</button>
          <button className="btn ghost sm"><Icon name="clock" size={12}/>Runs</button>
          <button className="btn ghost sm"><Icon name="cog" size={12}/></button>
          <Avatar/>
        </>}
      />

      {/* main */}
      <div style={{ flex: 1, overflow:'auto', display:'flex', justifyContent:'center' }}>
        <div style={{ width: 760, maxWidth: '92%', padding: '108px 0 64px' }}>

          {/* hero block */}
          <div style={{ marginBottom: 44, display:'flex', alignItems:'flex-end', gap: 24 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display:'flex', alignItems:'center', gap: 14, marginBottom: 14 }}>
                <span className="coord">α · Command center</span>
                <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
              </div>
              <h1 className="serif" style={{ fontSize: 44, lineHeight: 1.05, letterSpacing: '-0.025em', margin: 0, color:'var(--ink)' }}>
                Orchestrate a software task.
              </h1>
              <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 14, maxWidth: 520, lineHeight: 1.55 }}>
                Decompose work into a DAG of agent tasks. Run leaves in isolated worktrees, integrate bottom-up, and compare granularities side-by-side.
              </p>
            </div>
          </div>

          {/* prompt — borderless, input is the surface */}
          <div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)}
              placeholder="Describe the task — what should the system build, refactor, or migrate?"
              style={{
                width: '100%', minHeight: 168, padding: '6px 0',
                border: 'none', outline: 'none', resize: 'none',
                background: 'transparent', color: 'var(--ink)',
                fontFamily: 'var(--font-sans)', fontSize: 17.5, lineHeight: 1.55,
                letterSpacing: '-0.005em',
              }}/>

            <div style={{ height: 1, background: 'var(--rule)', margin: '6px 0 18px' }}/>

            {/* control rows */}
            <ControlRow label="Workspace">
              <Selector icon="package" label="acme/payments"/>
              <span className="coord" style={{ opacity:0.5, padding:'0 4px' }}>·</span>
              <Selector icon="branch"  label="main"/>
            </ControlRow>

            <ControlRow label="Granularity" hint="how deep the planner decomposes">
              <Segmented value={gran} onChange={setGran} options={[
                { id: 'Auto', label: 'Auto' },
                { id: 'G3',   label: 'G3',   coord: 'coarse'   },
                { id: 'G6',   label: 'G6',   coord: 'balanced' },
                { id: 'G9',   label: 'G9',   coord: 'fine'     },
              ]}/>
            </ControlRow>

            <ControlRow label="Mode" hint="what the run will actually do">
              <Segmented value={mode} onChange={setMode} options={[
                { id: 'planning',         label: 'Planning' },
                { id: 'mock',             label: 'Mock' },
                { id: 'execution-ready',  label: 'Execution-ready' },
              ]}/>
            </ControlRow>

            {/* actions */}
            <div style={{ display:'flex', alignItems:'center', gap: 10, marginTop: 26 }}>
              <button className="btn primary lg">
                <Icon name="play" size={12}/>Generate DAG
                <span className="kbd" style={{
                  marginLeft: 6, background: 'rgba(0,0,0,0.18)', borderColor: 'transparent', color: 'rgba(0,0,0,0.6)'
                }}>⌘↵</span>
              </button>
              <button className="btn future" title="Available once Codex CLI is connected">
                <Icon name="terminal" size={12}/>Run with Codex
                <span className="coord" style={{ marginLeft: 6 }}>future</span>
              </button>
              <div style={{ flex: 1 }}/>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                connect Codex CLI to execute leaves
              </span>
            </div>
          </div>

          {/* recent runs */}
          <div style={{ marginTop: 96 }}>
            <div style={{ display:'flex', alignItems:'center', gap: 14, marginBottom: 16 }}>
              <span className="coord">β · Recent runs</span>
              <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
              <button className="btn ghost sm" style={{ fontSize: 11, color:'var(--ink-3)' }}>View all<Icon name="chevron" size={11}/></button>
            </div>
            <div>
              <RecentRow
                title="Add idempotency to webhook handlers"
                gran="G6" mode="execution-ready" status="ready"
                meta="11 nodes · 7 leaves · depth 4" updated="2 min ago"/>
              <RecentRow
                title="Migrate sessions table to UUID"
                gran="G9" mode="mock" status="done"
                meta="24 nodes · 14 leaves · depth 5" updated="yesterday"/>
              <RecentRow
                title="OpenAPI → typed SDK"
                gran="G6" mode="planning" status="planned"
                meta="9 nodes · 6 leaves · depth 3" updated="Tue"/>
              <RecentRow
                title="Rate-limit /webhooks (token bucket)"
                gran="G3" mode="execution-ready" status="ready"
                meta="6 nodes · 4 leaves · depth 2" updated="Mon"/>
            </div>
          </div>

        </div>
      </div>

      <BottomBar
        left={<>
          <span>Manyhands · research preview</span>
          <span>Codex CLI <span style={{ color:'var(--failed)' }}>not connected</span></span>
        </>}
        right={<>
          <span><span style={{ color: 'var(--ink-2)' }}>{'⌘K'}</span> command</span>
          <span><span style={{ color: 'var(--ink-2)' }}>{'⌘↵'}</span> run</span>
        </>}/>
    </div>
  );
};

const ControlRow = ({ label, hint, children }) => (
  <div style={{ display:'flex', alignItems:'center', gap: 18, padding: '11px 0', borderBottom: '1px solid var(--rule-soft)' }}>
    <div style={{ width: 124, flex:'0 0 124px' }}>
      <div className="coord">{label}</div>
      {hint && <div style={{ fontSize: 11, color:'var(--ink-3)', marginTop: 4 }}>{hint}</div>}
    </div>
    <div style={{ flex: 1, display:'flex', alignItems:'center', gap: 8, flexWrap:'wrap' }}>
      {children}
    </div>
  </div>
);

const Selector = ({ icon, label }) => (
  <button className="btn ghost sm" style={{ height: 26, color: 'var(--ink-2)' }}>
    {icon && <Icon name={icon} size={11} style={{ color: 'var(--ink-3)' }}/>}
    <span className="mono" style={{ fontSize: 12 }}>{label}</span>
    <Icon name="chevronDown" size={10} style={{ color: 'var(--ink-3)' }}/>
  </button>
);

const RecentRow = ({ title, gran, mode, status, meta, updated }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '1fr auto auto auto auto',
    columnGap: 24,
    alignItems: 'center',
    padding: '14px 0',
    borderBottom: '1px solid var(--rule-soft)',
    cursor: 'pointer',
  }}>
    <div style={{ minWidth: 0 }}>
      <div className="serif" style={{ fontSize: 15, color: 'var(--ink)', letterSpacing: '-0.005em' }}>{title}</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{meta}</div>
    </div>
    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{gran}</span>
    <ModeBadge mode={mode}/>
    <Signal status={status}/>
    <span style={{ fontSize: 11, color: 'var(--ink-3)', minWidth: 70, textAlign: 'right' }}>{updated}</span>
  </div>
);

Object.assign(window, { Home });
