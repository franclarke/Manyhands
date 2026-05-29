// Shared atoms: Icon, Logo, Wordmark, top-bar chrome, signals, type glyphs.

const Icon = ({ name, size = 14, color, style, className }) => {
  const p = {
    branch:    <g><line x1="6" y1="3" x2="6" y2="15"/><circle cx="6" cy="3" r="1.6"/><circle cx="6" cy="15" r="1.6"/><circle cx="12" cy="9" r="1.6"/><path d="M12 7.4V6c0-1.6-1.4-3-3-3H7.5"/></g>,
    play:      <polygon points="5 3 14 9 5 15" fill="currentColor" stroke="none"/>,
    plus:      <g><line x1="9" y1="3" x2="9" y2="15"/><line x1="3" y1="9" x2="15" y2="9"/></g>,
    minus:     <line x1="3" y1="9" x2="15" y2="9"/>,
    search:    <g><circle cx="8" cy="8" r="5"/><line x1="12" y1="12" x2="15" y2="15"/></g>,
    filter:    <polygon points="2 3 16 3 11 9 11 14 7 16 7 9"/>,
    grid:      <g><rect x="3" y="3" width="5" height="5"/><rect x="10" y="3" width="5" height="5"/><rect x="3" y="10" width="5" height="5"/><rect x="10" y="10" width="5" height="5"/></g>,
    timeline:  <g><line x1="3" y1="5" x2="15" y2="5"/><line x1="3" y1="9" x2="11" y2="9"/><line x1="3" y1="13" x2="13" y2="13"/></g>,
    board:     <g><rect x="3" y="3" width="3.5" height="12"/><rect x="8" y="3" width="3.5" height="8"/><rect x="13" y="3" width="2" height="10"/></g>,
    dag:       <g><circle cx="4" cy="9" r="1.5"/><circle cx="9" cy="4" r="1.5"/><circle cx="9" cy="14" r="1.5"/><circle cx="14" cy="9" r="1.5"/><line x1="5.4" y1="8.2" x2="7.6" y2="4.8"/><line x1="5.4" y1="9.8" x2="7.6" y2="13.2"/><line x1="10.4" y1="4.8" x2="12.6" y2="8.2"/><line x1="10.4" y1="13.2" x2="12.6" y2="9.8"/></g>,
    chevron:   <polyline points="6 4 11 9 6 14"/>,
    chevronDown: <polyline points="4 7 9 12 14 7"/>,
    chevronUp:   <polyline points="4 11 9 6 14 11"/>,
    chevronRight:<polyline points="7 4 12 9 7 14"/>,
    file:      <g><polygon points="4 2 11 2 14 5 14 16 4 16"/><polyline points="11 2 11 5 14 5"/></g>,
    folder:    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3.2L8 4.5h6.5A1.5 1.5 0 0 1 16 6v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 14z"/>,
    terminal:  <g><polyline points="3 5 7 9 3 13"/><line x1="9" y1="13" x2="15" y2="13"/></g>,
    code:      <g><polyline points="6 5 2 9 6 13"/><polyline points="12 5 16 9 12 13"/></g>,
    cog:       <g><circle cx="9" cy="9" r="2.4"/><path d="M9 2v2M9 14v2M2 9h2M14 9h2M4 4l1.4 1.4M12.6 12.6L14 14M4 14l1.4-1.4M12.6 5.4L14 4"/></g>,
    pulse:     <polyline points="2 9 5 9 7 4 10 14 12 9 16 9"/>,
    abort:     <g><circle cx="9" cy="9" r="6"/><line x1="5" y1="5" x2="13" y2="13"/></g>,
    rerun:     <g><polyline points="3 4 3 8 7 8"/><path d="M3 8a6 6 0 1 0 1.8-4.2L3 5.5"/></g>,
    split:     <g><circle cx="9" cy="3.5" r="1.4"/><circle cx="4" cy="13.5" r="1.4"/><circle cx="14" cy="13.5" r="1.4"/><path d="M9 5v2c0 1-1 2-2 2H6c-1 0-2 1-2 2v1M9 5v2c0 1 1 2 2 2h1c1 0 2 1 2 2v1"/></g>,
    warn:      <g><path d="M9 2.5l7 13H2z"/><line x1="9" y1="7" x2="9" y2="11"/><circle cx="9" cy="13" r=".4" fill="currentColor"/></g>,
    error:     <g><circle cx="9" cy="9" r="6"/><line x1="9" y1="6" x2="9" y2="10"/><circle cx="9" cy="12.5" r=".5" fill="currentColor"/></g>,
    check:     <polyline points="3 9 7 13 15 5"/>,
    cross:     <g><line x1="4" y1="4" x2="14" y2="14"/><line x1="14" y1="4" x2="4" y2="14"/></g>,
    info:      <g><circle cx="9" cy="9" r="6"/><line x1="9" y1="8" x2="9" y2="13"/><circle cx="9" cy="5.5" r=".6" fill="currentColor"/></g>,
    bolt:      <polygon points="10 2 4 10 8 10 8 16 14 8 10 8"/>,
    clock:     <g><circle cx="9" cy="9" r="6"/><polyline points="9 5 9 9 12 11"/></g>,
    bell:      <g><path d="M4.5 13h9V8a4.5 4.5 0 0 0-9 0z"/><path d="M7.5 14a1.5 1.5 0 0 0 3 0"/></g>,
    map:       <g><polygon points="2 4 7 2 12 4 16 2 16 14 12 16 7 14 2 16"/><line x1="7" y1="2" x2="7" y2="14"/><line x1="12" y1="4" x2="12" y2="16"/></g>,
    lock:      <g><rect x="4" y="8" width="10" height="7" rx="1"/><path d="M6 8V6a3 3 0 0 1 6 0v2"/></g>,
    eye:       <g><path d="M1.5 9C3 5.5 6 4 9 4s6 1.5 7.5 5C15 12.5 12 14 9 14S3 12.5 1.5 9z"/><circle cx="9" cy="9" r="2"/></g>,
    flag:      <g><path d="M4 14V3l8 2-2 3 2 3-8-2"/><line x1="4" y1="14" x2="4" y2="16"/></g>,
    sparkle:   <g><path d="M9 2v3M9 13v3M2 9h3M13 9h3M5 5l2 2M11 11l2 2M5 13l2-2M11 7l2-2"/></g>,
    arrowDown: <g><line x1="9" y1="3" x2="9" y2="15"/><polyline points="5 11 9 15 13 11"/></g>,
    arrowRight: <g><line x1="3" y1="9" x2="15" y2="9"/><polyline points="11 5 15 9 11 13"/></g>,
    hash:      <g><line x1="4" y1="7" x2="14" y2="7"/><line x1="4" y1="11" x2="14" y2="11"/><line x1="8" y1="3" x2="6" y2="15"/><line x1="12" y1="3" x2="10" y2="15"/></g>,
    layers:    <g><polygon points="9 2 2 6 9 10 16 6"/><polyline points="2 10 9 14 16 10"/></g>,
    package:   <g><polygon points="9 2 16 6 16 12 9 16 2 12 2 6"/><polyline points="2 6 9 10 16 6"/><line x1="9" y1="10" x2="9" y2="16"/></g>,
    flask:     <g><polyline points="7 2 7 7 3 14 15 14 11 7 11 2"/><line x1="6" y1="2" x2="12" y2="2"/></g>,
    bookmark:  <polygon points="5 2 13 2 13 16 9 13 5 16"/>,
    crosshair: <g><circle cx="9" cy="9" r="5"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="9" y1="14" x2="9" y2="17"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="14" y1="9" x2="17" y2="9"/></g>,
    arrowUR:   <g><line x1="4" y1="14" x2="14" y2="4"/><polyline points="6 4 14 4 14 12"/></g>,
    notebook:  <g><rect x="4" y="2" width="11" height="14" rx="1"/><line x1="4" y1="6" x2="15" y2="6"/><line x1="4" y1="10" x2="15" y2="10"/><line x1="7" y1="2" x2="7" y2="16"/></g>,
  }[name];
  return (
    <svg className={'icon' + (className ? ' ' + className : '')} width={size} height={size}
      viewBox="0 0 18 18" style={{ color, ...style }}>{p || null}</svg>
  );
};

// ── Logo ────────────────────────────────────────────
// "Many hands" — one input that fans into many work units.
// A single vertical stem decomposes into three diverging branches with terminal dots.
const Logo = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 22 22" style={{ flex: '0 0 auto' }}>
    {/* central node */}
    <circle cx="11" cy="5" r="1.8" fill="var(--copper)"/>
    {/* three branches */}
    <path d="M11 6.6 L11 9.5 L4 14.5" stroke="var(--copper)" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
    <path d="M11 6.6 L11 14.5" stroke="var(--copper)" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.85"/>
    <path d="M11 6.6 L11 9.5 L18 14.5" stroke="var(--copper)" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.7"/>
    {/* leaves */}
    <circle cx="4"  cy="14.5" r="1.5" fill="var(--copper)" opacity="0.9"/>
    <circle cx="11" cy="14.5" r="1.5" fill="var(--copper)" opacity="0.75"/>
    <circle cx="18" cy="14.5" r="1.5" fill="var(--copper)" opacity="0.6"/>
  </svg>
);

// ── Wordmark — small caps, technical
const Wordmark = ({ version }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
    <Logo size={20}/>
    <span style={{
      fontFamily: 'var(--font-serif)', fontSize: 16,
      letterSpacing: '-0.005em', color: 'var(--ink)', fontWeight: 500
    }}>Manyhands</span>
    {version && (
      <span className="coord" style={{ marginLeft: 4 }}>{version}</span>
    )}
  </div>
);

// ── TopBar — borderless; padding-based separation
const TopBar = ({ left, center, right, height = 56 }) => (
  <div style={{
    height, display: 'flex', alignItems: 'center', padding: '0 22px',
    gap: 16, flex: '0 0 auto', background: 'var(--bg)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>{left}</div>
    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>{center}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{right}</div>
  </div>
);

// Bottom bar — minimal, almost invisible
const BottomBar = ({ left, right, height = 26 }) => (
  <div style={{
    height, display: 'flex', alignItems: 'center',
    padding: '0 22px', background: 'var(--bg)',
    fontSize: 10.5, color: 'var(--ink-3)',
    borderTop: '1px solid var(--rule-soft)',
    gap: 16, flex: '0 0 auto', fontFamily: 'var(--font-mono)',
    letterSpacing: '0.02em',
  }}>
    <div style={{ display:'flex', alignItems:'center', gap: 16 }}>{left}</div>
    <div style={{ flex: 1 }}/>
    <div style={{ display:'flex', alignItems:'center', gap: 16 }}>{right}</div>
  </div>
);

// Repo/branch crumb — quiet
const RepoCrumb = ({ repo, branch }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-2)' }}>
    <span className="mono" style={{ color: 'var(--ink)', fontSize: 12 }}>{repo}</span>
    <span style={{ color: 'var(--ink-4)' }}>·</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-3)', fontSize: 12 }}>
      <Icon name="branch" size={11}/>
      <span className="mono">{branch}</span>
    </span>
  </div>
);

// Avatar — soft circle initials
const Avatar = ({ initials = 'MR', size = 24 }) => (
  <div style={{ width: size, height: size, borderRadius: '50%',
    background: 'rgba(229,222,204,0.05)', display:'flex', alignItems:'center', justifyContent:'center',
    fontSize: 10, color: 'var(--ink-2)', fontWeight: 500, letterSpacing: '0.04em', flex: '0 0 auto'
  }}>{initials}</div>
);

// Status signal (dot + label)
const Signal = ({ status, label }) => (
  <span className={`signal ${status}`}>
    <span className="dot"/>
    <span>{label || status}</span>
  </span>
);

// Mode badge — honest about what the run actually is
const ModeBadge = ({ mode }) => {
  // mode: 'planning' | 'mock' | 'execution-ready' | 'live'
  const label = {
    'planning':         'Planning',
    'mock':             'Mock run',
    'execution-ready':  'Execution-ready',
    'live':             'Live',
  }[mode] || mode;
  return <span className={`mode ${mode}`}>{label}</span>;
};

// Node-type glyph: c / l / i / v
const TypeGlyph = ({ kind, size = 14 }) => {
  const letter = { composite: 'c', leaf: 'l', integration: 'i', validation: 'v' }[kind] || '?';
  return <span className={`type-glyph ${kind}`} style={{ width: size, height: size, fontSize: size <= 14 ? 9 : 11 }}>{letter}</span>;
};

// Segmented control
const Segmented = ({ options, value, onChange, size }) => (
  <div className="seg" style={size === 'sm' ? { padding: 2 } : {}}>
    {options.map(o => (
      <button key={o.id} className={value === o.id ? 'active' : ''}
        style={size === 'sm' ? { height: 22, fontSize: 11.5, padding: '0 9px' } : {}}
        onClick={() => onChange && onChange(o.id)}>
        {o.coord && <span className="coord" style={{ marginRight: 1 }}>{o.coord}</span>}
        {o.label}
      </button>
    ))}
  </div>
);

// Coordinate marker — e.g. "α 01" or "01"
const Coord = ({ n, char }) => (
  <span className="coord">{char && <>{char} </>}{String(n).padStart(2, '0')}</span>
);

Object.assign(window, {
  Icon, Logo, Wordmark, TopBar, BottomBar, RepoCrumb, Avatar,
  Signal, ModeBadge, TypeGlyph, Segmented, Coord,
});
