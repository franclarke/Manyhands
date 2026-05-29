// Board — simple kanban. Status columns. No cloud data.

const COLUMNS = [
  { id: 'planned',      label: 'Planned',       color: 'var(--planned)' },
  { id: 'ready',        label: 'Ready',         color: 'var(--ready)' },
  { id: 'running',      label: 'Running',       color: 'var(--running)' },
  { id: 'needs_review', label: 'Needs review',  color: 'var(--ink-2)' },
  { id: 'done',         label: 'Done',          color: 'var(--done)' },
  { id: 'integrated',   label: 'Integrated',    color: 'var(--copper)' },
];

const Board = ({ label = '04 Board' }) => {
  // map nodes to columns (mock state)
  const buckets = {
    planned:      ['N08'],
    ready:        ['N05', 'N06', 'N07'],
    running:      [],
    needs_review: [],
    done:         ['N01', 'N02', 'N03', 'N04'],
    integrated:   [],
  };
  return (
    <div className="mh" data-screen-label={label}
      style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)' }}>
      <TopBar
        left={<Wordmark version="v0.3"/>}
        right={<>
          <RepoCrumb repo={RUN_META.repo} branch={RUN_META.branch}/>
          <div style={{ width: 14 }}/>
          <Avatar/>
        </>}/>

      <div style={{ padding: '14px 24px 10px', display:'flex', alignItems:'center', gap: 16 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 19, color:'var(--ink)', letterSpacing:'-0.01em', fontWeight: 500 }}>{RUN_META.title}</h2>
        <ModeBadge mode={RUN_META.mode}/>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{RUN_META.granularity}</span>
        <div style={{ flex: 1 }}/>
        <Segmented value="board" onChange={() => {}} options={[
          { id:'graph', label:'Graph' },
          { id:'timeline', label:'Timeline' },
          { id:'board', label:'Board' },
        ]}/>
      </div>

      <Caption text="Operational view · group by state · MVP scope only"/>

      <div style={{ flex: 1, overflow:'auto', padding: '8px 24px 24px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6, minmax(0, 1fr))', gap: 14, minWidth: 1100 }}>
          {COLUMNS.map(col => (
            <BoardColumn key={col.id} col={col} ids={buckets[col.id] || []}/>
          ))}
        </div>
      </div>

      <BottomBar
        left={<>
          <span>run · {RUN_META.id}</span>
          <span>group by state · 11 nodes</span>
        </>}
        right={<span>drag cards to update state · future</span>}/>
    </div>
  );
};

const BoardColumn = ({ col, ids }) => (
  <div>
    <div style={{ display:'flex', alignItems:'center', gap: 8, padding: '6px 4px 12px' }}>
      <span className="dot" style={{ background: col.color, width: 6, height: 6 }}/>
      <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>{col.label}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{ids.length}</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ids.map(id => <BoardCard key={id} node={nodeById[id]}/>)}
      {ids.length === 0 && (
        <div style={{
          padding: '12px', borderRadius: 5, fontSize: 11,
          color: 'var(--ink-3)', textAlign: 'center',
          border: '1px dashed var(--rule-soft)',
        }}>—</div>
      )}
    </div>
  </div>
);

const BoardCard = ({ node }) => (
  <div style={{
    background: 'var(--bg-1)', border: '1px solid var(--rule)', borderRadius: 6,
    padding: '9px 10px',
  }}>
    <div style={{ display:'flex', alignItems:'center', gap: 7 }}>
      <TypeGlyph kind={node.kind} size={12}/>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-2)' }}>{node.id}</span>
      <div style={{ flex: 1 }}/>
      <span className="dot" style={{
        width: 5, height: 5,
        background:
          node.state === 'ready'   ? 'var(--ready)' :
          node.state === 'done'    ? 'var(--done)' :
          node.state === 'running' ? 'var(--running)' :
          node.state === 'blocked' ? 'var(--blocked)' : 'var(--planned)',
      }}/>
    </div>
    <div className="serif" style={{ fontSize: 13.5, color: 'var(--ink)', marginTop: 8, lineHeight: 1.25, letterSpacing: '-0.005em' }}>{node.title}</div>
    <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{node.summary}</div>
  </div>
);

Object.assign(window, { Board });
