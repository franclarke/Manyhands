// Timeline — an oscilloscope-style readout for parallelism.
// Mock data is clearly labeled. No spend / no providers / no rate limits.

const TIMELINE = {
  phases: [
    { id:'parse',     code:'α', label:'Parse',     lanes:['a-1'] },
    { id:'plan',      code:'β', label:'Plan',      lanes:['b-1','b-2'] },
    { id:'implement', code:'γ', label:'Implement', lanes:['c-1','c-2','c-3','c-4','c-5'] },
    { id:'validate',  code:'δ', label:'Validate',  lanes:['d-1','d-2'] },
    { id:'integrate', code:'ε', label:'Integrate', lanes:['e-1'] },
  ],
  // bar: { phase, lane, a, b (in arb units), state, label, note? }
  bars: [
    { phase:'parse', lane:0, a:0, b:2, state:'done', label:'N01 parse_intent' },
    // plan
    { phase:'plan', lane:0, a:3, b:9, state:'done', label:'N02 schema_audit' },
    { phase:'plan', lane:1, a:3, b:7, state:'done', label:'N03 dep_graph' },
    // implement
    { phase:'implement', lane:0, a:10, b:16, state:'done',    label:'N04 db_migration' },
    { phase:'implement', lane:1, a:17, b:22, state:'ready',   label:'N05 idempotency_repo · ready' },
    { phase:'implement', lane:2, a:17, b:21, state:'ready',   label:'N06 webhook_mw · ready' },
    { phase:'implement', lane:3, a:18, b:22, state:'ready',   label:'N07 replay_endpoint · ready' },
    { phase:'implement', lane:4, a:23, b:25, state:'planned', label:'N08 types_codegen · planned' },
    // validate
    { phase:'validate', lane:0, a:23, b:28, state:'planned', label:'N09 vitest_run · planned' },
    { phase:'validate', lane:1, a:26, b:32, state:'blocked', label:'N10 e2e_run · blocked by N08' },
    // integrate
    { phase:'integrate', lane:0, a:29, b:33, state:'planned', label:'N11 merge_branches · planned' },
  ],
  duration: 36,
  nowUnit: 16,
  unitLabel: 't',
};

const Timeline = ({ label = '03 Timeline' }) => {
  return (
    <div className="mh" data-screen-label={label}
      style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)' }}>

      <TopBar
        left={<Wordmark version="v0.3"/>}
        right={<>
          <RepoCrumb repo={RUN_META.repo} branch={RUN_META.branch}/>
          <div style={{ width: 14 }}/>
          <Avatar/>
        </>}
      />

      {/* compact run head */}
      <div style={{ padding: '14px 24px 10px', display:'flex', alignItems:'center', gap: 16 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 19, color:'var(--ink)', letterSpacing:'-0.01em', fontWeight: 500 }}>{RUN_META.title}</h2>
        <ModeBadge mode={RUN_META.mode}/>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{RUN_META.granularity}</span>
        <div style={{ flex: 1 }}/>
        <Segmented value="timeline" onChange={() => {}} options={[
          { id:'graph', label:'Graph' },
          { id:'timeline', label:'Timeline' },
          { id:'board', label:'Board' },
        ]}/>
      </div>

      <Caption text="Execution timeline · mock simulation · no Codex run yet"/>

      {/* the oscilloscope */}
      <div style={{ flex:1, overflow:'hidden', position:'relative' }}>
        <Oscilloscope/>
      </div>

      <BottomBar
        left={<>
          <span>run · {RUN_META.id}</span>
          <span>11 nodes · depth 4</span>
          <span>Codex CLI <span style={{ color: 'var(--failed)' }}>not connected</span></span>
        </>}
        right={<span>units are arbitrary · scale is illustrative</span>}/>
    </div>
  );
};

const Caption = ({ text }) => (
  <div style={{ padding: '0 24px 12px', display:'flex', alignItems:'center', gap: 10 }}>
    <Icon name="flask" size={11} style={{ color: 'var(--ink-3)' }}/>
    <span className="coord">{text}</span>
    <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
  </div>
);

// ── Oscilloscope ──
const Oscilloscope = () => {
  const labelW = 200;
  const W = 1280;
  const sec2px = W / TIMELINE.duration;
  const rowH = 28;
  const phaseH = 22;

  const rows = [];
  TIMELINE.phases.forEach(p => {
    rows.push({ kind: 'phase', code: p.code, label: p.label });
    p.lanes.forEach((agent, i) => rows.push({ kind: 'lane', phase: p.id, lane: i, agent }));
  });

  return (
    <div style={{ position:'absolute', inset: 0, display:'flex', flexDirection:'column' }}>
      {/* ruler */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--rule-soft)', background:'var(--bg)' }}>
        <div style={{ width: labelW, flex:`0 0 ${labelW}px`, borderRight:'1px solid var(--rule)', padding:'8px 14px' }}>
          <span className="coord">phase · lane</span>
        </div>
        <div style={{ position:'relative', flex: 1, height: 30 }}>
          {Array.from({ length: TIMELINE.duration + 1 }).map((_, i) => {
            if (i % 4 !== 0) return null;
            const x = i * sec2px;
            return (
              <React.Fragment key={i}>
                <div style={{ position:'absolute', left: x, top: 22, bottom: 0, width: 1, background: 'var(--rule-marker)', opacity: 0.6 }}/>
                <span className="mono" style={{ position:'absolute', left: x + 4, top: 7, fontSize: 10, color:'var(--ink-3)' }}>{i}{TIMELINE.unitLabel}</span>
              </React.Fragment>
            );
          })}
          {/* now */}
          <div style={{
            position:'absolute', left: TIMELINE.nowUnit * sec2px - 14, top: 4,
            padding: '1px 6px',
            border: '1px solid var(--copper)',
            color: 'var(--copper)',
            fontSize: 9.5, fontFamily: 'var(--font-mono)',
            letterSpacing: '0.14em', textTransform: 'uppercase',
            borderRadius: 2,
            background: 'var(--bg)',
          }}>now</div>
        </div>
      </div>

      {/* rows */}
      <div style={{ flex: 1, overflow:'auto', position:'relative' }}>
        {/* now line */}
        <div style={{
          position:'absolute', left: labelW + TIMELINE.nowUnit * sec2px, top: 0, bottom: 0, width: 1,
          background: 'var(--copper)', opacity: 0.45, zIndex: 3,
        }}/>

        {rows.map((r, i) => r.kind === 'phase' ? (
          <div key={i} style={{
            display:'flex', height: phaseH, alignItems:'center',
            borderBottom: '1px solid var(--rule-soft)',
          }}>
            <div style={{ width: labelW, flex:`0 0 ${labelW}px`, padding: '0 14px', borderRight: '1px solid var(--rule)' }}>
              <span className="coord" style={{ color: 'var(--copper)', opacity: 0.8 }}>{r.code}</span>
              <span className="coord" style={{ marginLeft: 8 }}>{r.label}</span>
            </div>
            <div style={{ flex: 1, height: phaseH,
              background: 'repeating-linear-gradient(135deg, transparent 0 8px, var(--rule-soft) 8px 9px)' }}/>
          </div>
        ) : (
          <div key={i} style={{
            display:'flex', height: rowH, alignItems:'center',
            borderBottom: '1px solid var(--rule-soft)',
          }}>
            <div style={{ width: labelW, flex:`0 0 ${labelW}px`, padding: '0 14px 0 30px', borderRight: '1px solid var(--rule)' }}>
              <span className="mono" style={{ fontSize: 11, color:'var(--ink-3)' }}>{r.agent}</span>
            </div>
            <div style={{ flex: 1, position:'relative', height: rowH }}>
              {/* lane baseline */}
              <div style={{ position:'absolute', top: rowH/2, left: 0, right: 0, height: 1, background: 'var(--rule-soft)' }}/>
              {TIMELINE.bars
                .filter(b => b.phase === r.phase && b.lane === r.lane)
                .map((b, j) => <OscBar key={j} bar={b} sec2px={sec2px} rowH={rowH}/>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const OscBar = ({ bar, sec2px, rowH }) => {
  const left = bar.a * sec2px;
  const width = Math.max(8, (bar.b - bar.a) * sec2px);
  const isPlanned = bar.state === 'planned';
  const isBlocked = bar.state === 'blocked';
  const isReady   = bar.state === 'ready';
  const color =
    bar.state === 'done'    ? 'var(--done)' :
    bar.state === 'running' ? 'var(--running)' :
    bar.state === 'ready'   ? 'var(--ready)' :
    bar.state === 'failed'  ? 'var(--failed)' :
    bar.state === 'blocked' ? 'var(--blocked)' : 'var(--planned)';

  // visual style: planned/blocked = dashed outline; ready = thin solid outline; done/running = filled tinted
  const filled = bar.state === 'done' || bar.state === 'running';
  return (
    <div style={{
      position:'absolute', left, top: 4, height: rowH - 8, width,
      borderRadius: 3,
      background: filled ? `${color}22` : 'transparent',
      border: `1px ${isPlanned || isBlocked ? 'dashed' : 'solid'} ${color}`,
      opacity: isBlocked ? 0.5 : 1,
      display:'flex', alignItems:'center', padding:'0 8px', gap: 6, overflow:'hidden', whiteSpace:'nowrap',
      animation: bar.state === 'running' ? 'pulseSoft 2.6s ease-in-out infinite' : 'none',
    }}>
      <span className="mono" style={{ fontSize: 10.5, color: filled ? 'var(--ink)' : color }}>{bar.label}</span>
    </div>
  );
};

Object.assign(window, { Timeline });
