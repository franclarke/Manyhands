// Node Inspector — lab notebook style. Used inside Workspace.
// Tabs: Overview · Contract · Execution · Validation · Trace.
// Honest about MVP state — never fabricates execution data.

const NodeInspector = ({ node, onClose }) => {
  const [tab, setTab] = React.useState('overview');
  if (!node) return <div style={{ padding: 22, color: 'var(--ink-3)', fontSize: 12 }}>No node selected.</div>;

  const phase = phaseById[node.col];

  return (
    <div className="tick-frame" style={{
      height: '100%', background: 'var(--bg)', display:'flex', flexDirection:'column',
      position: 'relative', overflow:'hidden',
    }}>
      {/* header — lab specimen */}
      <div style={{ padding: '18px 22px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 12 }}>
          <span className="coord">node · {phase.code} {node.id}</span>
          <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
          <button className="btn ghost sm" style={{ height: 22, padding: '0 5px' }}><Icon name="chevronUp" size={11}/></button>
          <button className="btn ghost sm" style={{ height: 22, padding: '0 5px' }}><Icon name="chevronDown" size={11}/></button>
          <button className="btn ghost sm" onClick={onClose} style={{ height: 22, padding: '0 5px' }}><Icon name="cross" size={11}/></button>
        </div>

        <div style={{ display:'flex', alignItems:'flex-start', gap: 10 }}>
          <TypeGlyph kind={node.kind} size={20}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="serif" style={{ fontSize: 22, lineHeight: 1.12, color:'var(--ink)', letterSpacing:'-0.018em', fontWeight: 500 }}>{node.title}</div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>
              {node.handle} · {node.kind} · phase {phase.code}
            </div>
          </div>
          <Signal status={node.state}/>
        </div>
      </div>

      {/* tabs */}
      <div style={{ display:'flex', padding: '0 22px', gap: 18, borderBottom: '1px solid var(--rule)' }}>
        {[
          { id: 'overview',   label: 'Overview'   },
          { id: 'contract',   label: 'Contract'   },
          { id: 'execution',  label: 'Execution'  },
          { id: 'validation', label: 'Validation' },
          { id: 'trace',      label: 'Trace'      },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="btn ghost"
            style={{
              height: 34, padding: '0 0 8px', marginBottom: -1,
              borderRadius: 0, background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '1px solid var(--copper)' : '1px solid transparent',
              color: tab === t.id ? 'var(--ink)' : 'var(--ink-3)',
              fontWeight: tab === t.id ? 600 : 500, fontSize: 12.5,
            }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow:'auto' }}>
        {tab === 'overview'   && <OverviewTab node={node} phase={phase}/>}
        {tab === 'contract'   && <ContractTab node={node}/>}
        {tab === 'execution'  && <ExecutionTab node={node}/>}
        {tab === 'validation' && <ValidationTab node={node}/>}
        {tab === 'trace'      && <TraceTab node={node}/>}
      </div>
    </div>
  );
};

// ── Tabs ───────────────────────────────────────────────
const OverviewTab = ({ node, phase }) => (
  <div style={{ padding: '18px 22px 28px' }}>
    <Field label="Goal">
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>{overviewGoal(node)}</p>
    </Field>

    <DataGrid rows={[
      ['type',        <span className="mono" style={{ fontSize: 12 }}>{node.kind}</span>],
      ['status',      <Signal status={node.state}/>],
      ['phase',       <span className="mono" style={{ fontSize: 12 }}>{phase.code} · {phase.label.toLowerCase()}</span>],
      ['depth',       <span className="mono" style={{ fontSize: 12 }}>{depthOf(node)}</span>],
      ['mode',        <ModeBadge mode={RUN_META.mode}/>],
      ['dependencies', <DepList ids={depsOf(node.id)}/>],
      ['children',    node.children
        ? <span className="mono" style={{ fontSize: 12 }}>{node.children} sub-tasks</span>
        : <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>none</span>],
    ]}/>
  </div>
);

const ContractTab = ({ node }) => (
  <div style={{ padding: '18px 22px 28px' }}>
    <Field label="Allowed implementation paths">
      <PathList paths={contractFor(node).impl} icon="folder"/>
    </Field>
    <Field label="Allowed test paths">
      <PathList paths={contractFor(node).tests} icon="folder"/>
    </Field>
    <Field label="Forbidden paths">
      <PathList paths={contractFor(node).forbidden} icon="lock"/>
    </Field>
    <Field label="Acceptance criteria">
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
        {contractFor(node).acceptance.map((c, i) => (
          <li key={i} style={{ display:'flex', gap: 9, padding: '5px 0', fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.55 }}>
            <span className="mono" style={{ color: 'var(--ink-3)', flex:'0 0 18px' }}>{String(i+1).padStart(2,'0')}</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </Field>
    <Field label="Validation commands">
      {contractFor(node).validation.map((cmd, i) => (
        <CommandRow key={i} cmd={cmd}/>
      ))}
    </Field>
  </div>
);

const ExecutionTab = ({ node }) => {
  const ready = node.state === 'ready' || node.state === 'planned';
  const blocked = node.state === 'blocked';

  return (
    <div style={{ padding: '18px 22px 28px' }}>
      <EmptyNotice
        title={
          blocked ? 'Blocked' :
          ready ? 'Ready to run in isolated worktree' :
          'No Codex execution yet'
        }
        body={
          blocked ? `Dependencies are not satisfied yet. Awaits ${depsOf(node.id).join(', ')}.` :
          ready
            ? 'Codex CLI is not connected in this build. When connected, this task will be executed in an isolated git worktree branched from feat/webhook-idempotency.'
            : 'This node has no recorded execution. Once Codex runs it, worktree, branch, duration, exit code, and a diff summary will appear here.'
        }
      />

      <DataGrid rows={[
        ['planned worktree', <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>wt/{node.handle}</span>],
        ['planned branch',   <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>feat/webhook-idempotency/{node.handle}</span>],
        ['duration',         <Unavailable text="available after Codex run"/>],
        ['exit code',        <Unavailable text="available after Codex run"/>],
        ['changed files',    <Unavailable text="available after Codex run"/>],
        ['diff summary',     <Unavailable text="available after Codex run"/>],
      ]}/>

      <div style={{ display:'flex', gap: 8, marginTop: 18 }}>
        <button className="btn future" disabled>
          <Icon name="terminal" size={11}/>Run with Codex
          <span className="coord" style={{ marginLeft: 4 }}>future</span>
        </button>
        <button className="btn ghost sm"><Icon name="rerun" size={11}/>Mock run</button>
        <button className="btn ghost sm"><Icon name="split" size={11}/>Split</button>
      </div>
    </div>
  );
};

const ValidationTab = ({ node }) => (
  <div style={{ padding: '18px 22px 28px' }}>
    <ValidationGroup
      label="Leaf validation"
      cmds={['pnpm tsc --noEmit src/webhooks', 'pnpm vitest src/webhooks --run']}
      empty="Not yet executed"
    />
    <ValidationGroup
      label="Parent validation"
      cmds={['pnpm vitest --run --reporter=verbose']}
      empty="Available once children complete"
    />
    <ValidationGroup
      label="Run validation"
      cmds={['pnpm tsc --noEmit', 'pnpm test:e2e']}
      empty="Available once integration phase runs"
    />
  </div>
);

const ValidationGroup = ({ label, cmds, empty }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ marginBottom: 18 }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', textAlign:'left', border:'none', background:'transparent', cursor:'pointer',
        padding: '6px 0', display:'flex', alignItems:'center', gap: 10,
      }}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} style={{ color: 'var(--ink-3)' }}/>
        <span className="coord">{label}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--rule)' }}/>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{empty}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {cmds.map((c, i) => <CommandRow key={i} cmd={c}/>)}
        </div>
      )}
    </div>
  );
};

const TraceTab = ({ node }) => (
  <div style={{ padding: '18px 22px 28px' }}>
    <EmptyNotice title="No trace recorded" body="Trace events, prompts, stdout and stderr appear here once this task runs."/>
    <Collapsible label="Planner prompt" hint="trimmed, last revision" />
    <Collapsible label="Tool calls"     hint="reads · edits · shell" />
    <Collapsible label="stdout"         hint="captured per run" />
    <Collapsible label="stderr"         hint="captured per run" />
  </div>
);

const Collapsible = ({ label, hint }) => (
  <div style={{ borderBottom: '1px solid var(--rule-soft)' }}>
    <button style={{
      width:'100%', textAlign:'left', background:'transparent', border:'none', cursor:'pointer',
      padding: '10px 0', display:'flex', alignItems:'center', gap: 10,
    }}>
      <Icon name="chevronRight" size={11} style={{ color: 'var(--ink-3)' }}/>
      <span className="coord">{label}</span>
      <div style={{ flex: 1 }}/>
      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{hint}</span>
    </button>
  </div>
);

// ── Building blocks ────────────────────────────────────
const Field = ({ label, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div className="coord" style={{ marginBottom: 8 }}>{label}</div>
    {children}
  </div>
);

const DataGrid = ({ rows }) => (
  <div style={{ marginTop: 6, borderTop: '1px solid var(--rule-soft)' }}>
    {rows.map(([k, v], i) => (
      <div key={i} style={{
        display:'flex', alignItems:'flex-start', gap: 14,
        padding: '9px 0', borderBottom: '1px solid var(--rule-soft)',
      }}>
        <div className="coord" style={{ width: 110, flex: '0 0 110px', paddingTop: 2 }}>{k}</div>
        <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)' }}>{v}</div>
      </div>
    ))}
  </div>
);

const PathList = ({ paths, icon }) => (
  <div>
    {(paths || []).length === 0 && <Unavailable text="none"/>}
    {(paths || []).map((p, i) => (
      <div key={i} style={{ display:'flex', alignItems:'center', gap: 8, padding: '5px 0' }}>
        <Icon name={icon} size={11} style={{ color: 'var(--ink-3)' }}/>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{p}</span>
      </div>
    ))}
  </div>
);

const CommandRow = ({ cmd }) => (
  <div style={{ display:'flex', alignItems:'center', gap: 9, padding: '6px 10px',
    background: 'rgba(229,222,204,0.025)', border: '1px solid var(--rule-soft)',
    borderRadius: 4, marginBottom: 4 }}>
    <span className="mono" style={{ color: 'var(--copper)', fontSize: 11 }}>$</span>
    <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{cmd}</span>
  </div>
);

const DepList = ({ ids }) => (
  ids.length === 0
    ? <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>none</span>
    : <div style={{ display:'flex', flexWrap:'wrap', gap: 5 }}>
        {ids.map(id => (
          <span key={id} className="mono" style={{
            fontSize: 11, padding: '2px 7px',
            border: '1px solid var(--rule)', borderRadius: 3, color: 'var(--ink-2)',
          }}>{id}</span>
        ))}
      </div>
);

const Unavailable = ({ text }) => (
  <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>{text}</span>
);

const EmptyNotice = ({ title, body }) => (
  <div style={{
    padding: '14px 16px', marginBottom: 16,
    border: '1px dashed var(--rule-strong)', borderRadius: 6,
    background: 'rgba(229,222,204,0.02)',
  }}>
    <div className="serif" style={{ fontSize: 15, color: 'var(--ink)', letterSpacing:'-0.005em' }}>{title}</div>
    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 6, lineHeight: 1.55 }}>{body}</div>
  </div>
);

// ── Local lookups (mock content tied to NODES) ────────
const overviewGoal = (n) => ({
  N01: 'Convert the natural-language task description into a structured task spec consumed by the planner.',
  N02: 'Audit the data layer for tables and indices touched by idempotency. Produce a migration plan.',
  N03: 'Compute file/symbol dependencies relevant to the task. Used by the planner to bound child tasks.',
  N04: 'Add the idempotency_keys table with proper indices and a 24h expiry policy.',
  N05: 'Implement and test the idempotency repository — read, write, invalidate, expire.',
  N06: 'Insert middleware that consumes the idempotency header and serves cached responses on hit.',
  N07: 'Expose a replay endpoint that returns the previously-served response for a given key.',
  N08: 'Regenerate type declarations from the updated schema.',
  N09: 'Run unit and integration tests across the touched modules.',
  N10: 'Run end-to-end webhook tests across the affected endpoints.',
  N11: 'Reconcile branches into a single integration branch and prepare a pull request.',
}[n.id] || '—');

const depsOf = (id) => EDGES.filter(([, b]) => b === id).map(([a]) => a);
const depthOf = (n) => {
  const cache = {};
  const walk = (id) => {
    if (cache[id] != null) return cache[id];
    const ps = depsOf(id);
    cache[id] = ps.length === 0 ? 0 : 1 + Math.max(...ps.map(walk));
    return cache[id];
  };
  return walk(n.id);
};

const contractFor = (n) => ({
  N05: {
    impl: ['src/billing/idempotency.ts', 'src/billing/idempotency.repo.ts'],
    tests: ['src/billing/idempotency.test.ts'],
    forbidden: ['src/webhooks/**', 'db/migrations/**'],
    acceptance: [
      'Repository exposes lookup, store, invalidate, expire.',
      'Keys past 24h are reported missing.',
      'Concurrent writes for the same key are safe.',
      'No public API of src/webhooks is changed.',
    ],
    validation: ['pnpm tsc --noEmit src/billing', 'pnpm vitest src/billing --run'],
  },
  N06: {
    impl: ['src/webhooks/middleware.ts'],
    tests: ['src/webhooks/middleware.test.ts'],
    forbidden: ['db/**', 'src/billing/**'],
    acceptance: [
      'Cache hit returns the stored response with x-idempotent-replay: true.',
      'Cache miss falls through to the existing handler chain.',
      'Latency overhead ≤ 12ms p95.',
    ],
    validation: ['pnpm tsc --noEmit src/webhooks', 'pnpm vitest src/webhooks --run'],
  },
}[n.id] || {
  impl: [],
  tests: [],
  forbidden: [],
  acceptance: ['Task contract not yet generated.'],
  validation: [],
});

Object.assign(window, { NodeInspector });
