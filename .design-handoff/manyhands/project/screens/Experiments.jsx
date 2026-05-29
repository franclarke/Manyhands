// Experiments — research notebook. Compare granularities for the same task.
// MVP-honest: missing measurements show "—".

const RUNS = [
  {
    id: 'G3', label: 'Coarse', mode: 'mock', status: 'done',
    nodes: 5, leaves: 3, depth: 2, duration: '~ 8 t', conflicts: 0, success: '2/3',
    note: 'Few large tasks. Less coordination, less surface for parallelism.',
  },
  {
    id: 'G6', label: 'Balanced', mode: 'execution-ready', status: 'ready',
    nodes: 11, leaves: 7, depth: 4, duration: '—', conflicts: '—', success: '—',
    note: 'Selected granularity for this run. Ready for Codex execution.',
    current: true,
  },
  {
    id: 'G9', label: 'Fine', mode: 'planning', status: 'planned',
    nodes: 22, leaves: 16, depth: 6, duration: '—', conflicts: '—', success: '—',
    note: 'Many small tasks. More parallelism, more reconciliation overhead.',
  },
];

const Experiments = ({ label = '05 Experiments' }) => {
  return (
    <div className="mh" data-screen-label={label}
      style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)' }}>
      <TopBar
        left={<Wordmark version="v0.3"/>}
        right={<>
          <button className="btn ghost sm"><Icon name="dag" size={11}/>Workspace</button>
          <Avatar/>
        </>}/>

      <div style={{ flex: 1, overflow:'auto', padding: '24px 40px 40px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {/* notebook head */}
          <div style={{ display:'flex', alignItems:'center', gap: 14, marginBottom: 18 }}>
            <Icon name="notebook" size={14} style={{ color: 'var(--copper)' }}/>
            <span className="coord">experiments · log 003</span>
            <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>recorded 2026-05-21</span>
          </div>

          <h1 className="serif" style={{ fontSize: 30, color: 'var(--ink)', letterSpacing: '-0.022em', lineHeight: 1.1, margin: 0 }}>
            Granularity comparison
          </h1>
          <p style={{ fontSize: 14, color:'var(--ink-2)', maxWidth: 620, lineHeight: 1.6, marginTop: 10 }}>
            The same task <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink)' }}>idempotency to webhook handlers</span>, decomposed at three granularities. We track how each plan behaves once Codex runs it.
          </p>

          {/* card row */}
          <div style={{
            display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap: 14,
            marginTop: 28,
          }}>
            {RUNS.map(r => <GranularityCard key={r.id} r={r}/>)}
          </div>

          {/* notebook table */}
          <div style={{ marginTop: 36 }}>
            <div style={{ display:'flex', alignItems:'center', gap: 14, marginBottom: 14 }}>
              <span className="coord">measurements</span>
              <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>units arbitrary · Codex CLI not connected</span>
            </div>
            <NotebookTable rows={[
              ['nodes',      5, 11, 22],
              ['leaves',     3, 7, 16],
              ['depth',      2, 4, 6],
              ['duration',   '~ 8 t', '—', '—'],
              ['conflicts',  0, '—', '—'],
              ['success',    '2/3', '—', '—'],
              ['validation', 'ok', 'ready', 'planned'],
            ]}/>
          </div>

          {/* empty state honest */}
          <div style={{ marginTop: 28, padding: '16px 18px', border: '1px dashed var(--rule-strong)', borderRadius: 6 }}>
            <div className="serif" style={{ fontSize: 15, color: 'var(--ink)' }}>Compare another task</div>
            <div style={{ fontSize: 12.5, color:'var(--ink-2)', marginTop: 6, lineHeight: 1.6 }}>
              Run the same task under multiple granularities to compare results. Mock runs are recorded automatically; real measurements appear once Codex CLI is connected.
            </div>
            <button className="btn outline sm" style={{ marginTop: 10 }}>
              <Icon name="plus" size={11}/>New comparison
            </button>
          </div>
        </div>
      </div>

      <BottomBar
        left={<>
          <span>experiments · 1 task · 3 plans</span>
          <span>Codex CLI <span style={{ color: 'var(--failed)' }}>not connected</span></span>
        </>}
        right={<span>units are arbitrary · scale is illustrative</span>}/>
    </div>
  );
};

const GranularityCard = ({ r }) => (
  <div style={{
    border: `1px solid ${r.current ? 'var(--copper)' : 'var(--rule)'}`,
    borderRadius: 6,
    padding: '14px 16px 16px',
    background: r.current ? 'rgba(180,113,72,0.04)' : 'var(--bg-1)',
    position: 'relative',
  }}>
    {r.current && (
      <span className="coord" style={{
        position:'absolute', top: 12, right: 14,
        color: 'var(--copper)',
      }}>current</span>
    )}
    <div style={{ display:'flex', alignItems:'baseline', gap: 10 }}>
      <span className="serif" style={{ fontSize: 28, color:'var(--ink)', letterSpacing:'-0.025em', lineHeight: 1 }}>{r.id}</span>
      <span className="coord">{r.label}</span>
    </div>
    <div style={{ display:'flex', alignItems:'center', gap: 10, marginTop: 10 }}>
      <ModeBadge mode={r.mode}/>
      <Signal status={r.status}/>
    </div>
    <p style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 10, lineHeight: 1.5, marginBottom: 12 }}>{r.note}</p>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 10, marginTop: 6 }}>
      <KV k="nodes"  v={r.nodes}/>
      <KV k="leaves" v={r.leaves}/>
      <KV k="depth"  v={r.depth}/>
    </div>
  </div>
);

const KV = ({ k, v }) => (
  <div>
    <div className="coord">{k}</div>
    <div className="mono" style={{ fontSize: 14, color: 'var(--ink)', marginTop: 3 }}>{v}</div>
  </div>
);

const NotebookTable = ({ rows }) => (
  <div style={{ border: '1px solid var(--rule)', borderRadius: 6, overflow:'hidden' }}>
    <div style={{
      display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr 1fr',
      padding:'10px 16px', borderBottom: '1px solid var(--rule)',
      background:'rgba(229,222,204,0.025)',
    }}>
      <span className="coord">metric</span>
      <span className="coord" style={{ textAlign:'center' }}>G3 · coarse</span>
      <span className="coord" style={{ textAlign:'center' }}>G6 · balanced</span>
      <span className="coord" style={{ textAlign:'center' }}>G9 · fine</span>
    </div>
    {rows.map((row, i) => (
      <div key={i} style={{
        display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr 1fr',
        padding:'10px 16px',
        borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--rule-soft)',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{row[0]}</span>
        {row.slice(1).map((v, j) => (
          <span key={j} className="mono" style={{
            fontSize: 13, textAlign:'center',
            color: v === '—' ? 'var(--ink-3)' : 'var(--ink)',
          }}>{v}</span>
        ))}
      </div>
    ))}
  </div>
);

Object.assign(window, { Experiments });
