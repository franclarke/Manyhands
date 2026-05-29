// Workspace — the DAG protagonist. Canvas + inspector together.
// Task wafers, blueprint grid, phase coordinates, organic edges.

const Workspace = ({ label = '02 DAG Workspace' }) => {
  const [selected, setSelected] = React.useState('N05');
  const [view, setView] = React.useState('graph');

  return (
    <div className="mh" data-screen-label={label}
      style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)' }}>

      <TopBar
        left={<Wordmark version="v0.3"/>}
        right={<>
          <RepoCrumb repo={RUN_META.repo} branch={RUN_META.branch}/>
          <div style={{ width: 14 }}/>
          <button className="btn ghost sm"><Icon name="search" size={11}/><span className="kbd" style={{ marginLeft: 2 }}>⌘K</span></button>
          <Avatar/>
        </>}
      />

      {/* run header strip */}
      <RunHeader/>

      {/* split: canvas + inspector */}
      <div style={{ flex: 1, display:'flex', minHeight: 0, overflow:'hidden' }}>
        <div style={{ flex: 1, position:'relative', overflow:'hidden', background:'var(--bg)' }}>
          <OrchestrationGrid selectedId={selected} onSelect={setSelected}/>
          <ViewToolbar view={view} setView={setView}/>
          <CanvasLegend/>
        </div>
        <div style={{ flex:'0 0 360px', width: 360, borderLeft:'1px solid var(--rule)' }}>
          <NodeInspector node={nodeById[selected]} onClose={() => {}}/>
        </div>
      </div>

      <BottomBar
        left={<>
          <span>run <span style={{ color: 'var(--ink-2)' }}>{RUN_META.id}</span></span>
          <span>{RUN_META.granularity} <span style={{ color: 'var(--ink-4)' }}>·</span> {RUN_META.totals.nodes} nodes <span style={{ color: 'var(--ink-4)' }}>·</span> depth {RUN_META.totals.depth}</span>
          <span>Codex CLI <span style={{ color: 'var(--failed)' }}>not connected</span></span>
        </>}
        right={<>
          <span>{RUN_META.updated}</span>
          <span><span style={{ color: 'var(--ink-2)' }}>{'⌘K'}</span> command</span>
        </>}/>
    </div>
  );
};

// ── Run header: title + mode + 4 honest metrics + filters ─────
const RunHeader = () => (
  <div style={{ padding: '16px 24px 14px', display:'flex', alignItems:'flex-end', gap: 28 }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: 6 }}>
        <span className="coord">run · α 01</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{RUN_META.id}</span>
      </div>
      <div style={{ display:'flex', alignItems:'baseline', gap: 14 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.018em', fontWeight: 500, lineHeight: 1.1 }}>
          {RUN_META.title}
        </h2>
        <ModeBadge mode={RUN_META.mode}/>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{RUN_META.granularity} balanced</span>
      </div>
    </div>

    <div style={{ flex: 1 }}/>

    {/* honest 4-metric summary */}
    <div style={{ display:'flex', gap: 28 }}>
      <Metric label="nodes"  value={RUN_META.totals.nodes}/>
      <Metric label="leaves" value={RUN_META.totals.leaves}/>
      <Metric label="depth"  value={RUN_META.totals.depth}/>
      <Metric label="ready"  value={RUN_META.totals.ready} color="var(--ready)"/>
    </div>
  </div>
);

const Metric = ({ label, value, color }) => (
  <div style={{ textAlign: 'right', minWidth: 38 }}>
    <div className="mono" style={{ fontSize: 22, color: color || 'var(--ink)', lineHeight: 1, letterSpacing: '-0.01em' }}>{value}</div>
    <div className="coord" style={{ marginTop: 6 }}>{label}</div>
  </div>
);

// ── Orchestration grid ───────────────────────────────────────
const ORCH_W = 1380;
const ORCH_H = 920;

const OrchestrationGrid = ({ selectedId, onSelect }) => {
  return (
    <div className="tick-frame" style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      // blueprint dot grid + ruler hatching at edges
      backgroundImage: `
        radial-gradient(circle, rgba(229,222,204,0.045) 1px, transparent 1px),
        linear-gradient(to right, transparent 0, transparent calc(100% - 1px), var(--rule) calc(100% - 1px)),
        linear-gradient(to bottom, transparent 0, transparent calc(100% - 1px), var(--rule) calc(100% - 1px))
      `,
      backgroundSize: '24px 24px, 100% 100%, 100% 100%',
      backgroundPosition: '12px 12px, 0 0, 0 0',
    }}>
      {/* ruler ticks on left edge */}
      <div style={{ position:'absolute', left: 0, top: 0, bottom: 0, width: 1, pointerEvents:'none' }}>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} style={{
            position:'absolute', left: 0, top: `${i * 5}%`,
            width: i % 4 === 0 ? 9 : 4, height: 1,
            background: 'var(--rule-marker)', opacity: i % 4 === 0 ? 1 : 0.45,
          }}/>
        ))}
      </div>

      <div style={{
        position:'absolute', top: 26, left: 22,
        width: ORCH_W, height: ORCH_H,
        transform: 'scale(0.86)', transformOrigin: '0 0',
      }}>
        {/* Phase headers */}
        {PHASES.map((p, i) => (
          <React.Fragment key={p.id}>
            <div style={{
              position:'absolute', top: 8, left: p.x,
              width: NODE_W, display: 'flex', alignItems:'center', gap: 10,
            }}>
              <span className="coord" style={{ color: 'var(--copper)', opacity: 0.75 }}>{p.code}</span>
              <span className="coord">{String(i+1).padStart(2,'0')} · {p.label}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{p.tasks}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
            </div>
            {/* very faint vertical guide */}
            <div style={{
              position: 'absolute', top: 40, left: p.x + NODE_W / 2,
              width: 1, height: ORCH_H - 80,
              background: `repeating-linear-gradient(to bottom, var(--rule-soft) 0 2px, transparent 2px 10px)`,
            }}/>
          </React.Fragment>
        ))}

        {/* edges */}
        <svg width={ORCH_W} height={ORCH_H} style={{ position:'absolute', top:0, left:0, pointerEvents:'none', overflow:'visible' }}>
          <defs>
            <marker id="arrow-neutral" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-4)"/>
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--copper)"/>
            </marker>
          </defs>
          {EDGES.map(([a, b], i) => {
            const A = nodeById[a], B = nodeById[b];
            const ax = phaseById[A.col].x + NODE_W;
            const bx = phaseById[B.col].x;
            const ay = A.y + 44;
            const by = B.y + 44;
            const dx = Math.max(36, (bx - ax) * 0.5);
            const d = `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
            const isActive = a === selectedId || b === selectedId;
            return (
              <path key={i} d={d}
                fill="none"
                stroke={isActive ? 'var(--copper)' : 'var(--ink-4)'}
                strokeWidth={isActive ? 1.2 : 1}
                opacity={isActive ? 0.95 : 0.55}
                markerEnd={`url(#${isActive ? 'arrow-active' : 'arrow-neutral'})`}
              />
            );
          })}
        </svg>

        {/* task wafers */}
        {NODES.map(n => (
          <TaskWafer key={n.id} node={n} x={phaseById[n.col].x}
            selected={selectedId === n.id}
            onClick={() => onSelect(n.id)}/>
        ))}
      </div>
    </div>
  );
};

// ── Task wafer ──
// Geometry: top-strip with type glyph + node id (coord), title in the body, footer line with summary.
// Visual: very thin rule, no chunky shadow, copper ring on selected.
const TaskWafer = ({ node, x, selected, onClick }) => {
  const s = node.state;
  const isRunning = s === 'running';
  return (
    <div onClick={onClick}
      style={{
        position:'absolute', left: x, top: node.y,
        width: NODE_W,
        background: selected ? 'rgba(180,113,72,0.04)' : 'var(--bg-1)',
        border: `1px solid ${selected ? 'transparent' : 'var(--rule)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        boxShadow: selected ? '0 0 0 1px var(--copper), 0 0 0 4px rgba(180, 113, 72, 0.12)' : 'none',
        animation: isRunning ? 'pulseSoft 2.6s ease-in-out infinite' : 'none',
        opacity: s === 'blocked' ? 0.58 : 1,
      }}>
      {/* top strip: type + id + signal dot */}
      <div style={{
        display:'flex', alignItems:'center', gap: 8,
        padding: '7px 10px',
        borderBottom: '1px solid var(--rule-soft)',
      }}>
        <TypeGlyph kind={node.kind} size={14}/>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-2)' }}>{node.id}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>· {node.handle}</span>
        <div style={{ flex: 1 }}/>
        <span className={`dot`} style={{
          background:
            s === 'running' ? 'var(--running)' :
            s === 'ready'   ? 'var(--ready)' :
            s === 'done'    ? 'var(--done)' :
            s === 'failed'  ? 'var(--failed)' :
            s === 'planned' ? 'var(--planned)' :
            s === 'blocked' ? 'var(--blocked)' : 'var(--ink-4)',
        }}/>
      </div>

      {/* body */}
      <div style={{ padding: '10px 12px 12px' }}>
        <div className="serif" style={{ fontSize: 15, lineHeight: 1.2, color: 'var(--ink)', letterSpacing: '-0.005em' }}>
          {node.title}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 6, whiteSpace: 'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {node.summary}
        </div>

        {/* footer: paths count + children badge */}
        <div style={{ display:'flex', alignItems:'center', gap: 10, marginTop: 9 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {node.paths > 0 ? `${node.paths} path${node.paths === 1 ? '' : 's'}` : '—'}
          </span>
          {node.children && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-2)', display:'inline-flex', alignItems:'center', gap: 4 }}>
              <Icon name="layers" size={10}/>{node.children} children
            </span>
          )}
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }} className="mono">{capitalize(s)}</span>
        </div>
      </div>
    </div>
  );
};

const capitalize = (s) => s ? s[0].toUpperCase() + s.slice(1) : '';

// ── Floating view toolbar (Graph / Timeline / Board) ─────────
const ViewToolbar = ({ view, setView }) => (
  <div style={{
    position: 'absolute', right: 18, top: 18,
    display: 'flex', gap: 6,
    padding: 0, zIndex: 5,
  }}>
    <Segmented value={view} onChange={setView} options={[
      { id: 'graph',    label: 'Graph' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'board',    label: 'Board' },
    ]}/>
    <button className="btn sm outline"><Icon name="play" size={11}/>Generate next</button>
  </div>
);

// ── Bottom-left legend / state distribution ──────────────────
const CanvasLegend = () => {
  const c = RUN_META.counters;
  return (
    <div style={{
      position: 'absolute', left: 22, bottom: 18,
      display:'flex', alignItems:'center', gap: 18,
      padding: '8px 14px',
      background: 'rgba(15,16,18,0.78)',
      border: '1px solid var(--rule)',
      borderRadius: 8,
      backdropFilter: 'blur(10px)',
      fontSize: 11, color: 'var(--ink-2)',
    }}>
      <span className="coord">distribution</span>
      <LegendDot color="var(--planned)" label="planned" n={c.planned}/>
      <LegendDot color="var(--ready)"   label="ready"   n={c.ready}/>
      <LegendDot color="var(--running)" label="running" n={c.running}/>
      <LegendDot color="var(--done)"    label="done"    n={c.done}/>
      <LegendDot color="var(--blocked)" label="blocked" n={c.blocked}/>
    </div>
  );
};

const LegendDot = ({ color, label, n }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap: 5 }}>
    <span className="dot" style={{ background: color }}/>
    <span style={{ color: 'var(--ink-2)', fontSize: 11 }}>{label}</span>
    <span className="mono" style={{ fontSize: 11, color: n === 0 ? 'var(--ink-3)' : 'var(--ink)' }}>{n}</span>
  </span>
);

Object.assign(window, { Workspace });
