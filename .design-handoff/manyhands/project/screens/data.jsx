// Shared run data — kept small, honest, all mock-but-plausible.
// One example task that flows through the whole product surface.

// Phases of the orchestration plan
const PHASES = [
  { id: 'parse',     code: 'α', label: 'Parse',     x: 80,   tasks: 1 },
  { id: 'plan',      code: 'β', label: 'Plan',      x: 340,  tasks: 2 },
  { id: 'implement', code: 'γ', label: 'Implement', x: 620,  tasks: 5 },
  { id: 'validate',  code: 'δ', label: 'Validate',  x: 920,  tasks: 2 },
  { id: 'integrate', code: 'ε', label: 'Integrate', x: 1200, tasks: 1 },
];

const NODE_W = 232;

// kind: composite | leaf | integration | validation
// state: planned | ready | running | done | failed | blocked
const NODES = [
  // PARSE
  { id: 'N01', col: 'parse', y: 360, title: 'Parse intent',
    handle: 'parse_intent', kind: 'leaf', state: 'done',
    paths: 1, summary: 'natural-language → task spec' },

  // PLAN
  { id: 'N02', col: 'plan', y: 240, title: 'Schema audit',
    handle: 'schema_audit', kind: 'composite', state: 'done',
    paths: 3, summary: '3 sub-tasks · idempotency_keys', children: 3 },
  { id: 'N03', col: 'plan', y: 470, title: 'Dependency graph',
    handle: 'dep_graph', kind: 'leaf', state: 'done',
    paths: 2, summary: 'src/webhooks/**, src/billing/**' },

  // IMPLEMENT
  { id: 'N04', col: 'implement', y: 110, title: 'Migration',
    handle: 'db_migration', kind: 'leaf', state: 'done',
    paths: 2, summary: 'add idempotency_keys table' },
  { id: 'N05', col: 'implement', y: 260, title: 'Repository layer',
    handle: 'idempotency_repo', kind: 'composite', state: 'ready', selected: true,
    paths: 4, summary: 'CRUD + 24h expiry worker', children: 3 },
  { id: 'N06', col: 'implement', y: 410, title: 'Webhook middleware',
    handle: 'webhook_mw', kind: 'leaf', state: 'ready',
    paths: 2, summary: 'lookup → cached response' },
  { id: 'N07', col: 'implement', y: 560, title: 'Replay endpoint',
    handle: 'replay_endpoint', kind: 'leaf', state: 'ready',
    paths: 2, summary: 'GET /webhooks/replay/:id' },
  { id: 'N08', col: 'implement', y: 710, title: 'Type codegen',
    handle: 'types_codegen', kind: 'leaf', state: 'planned',
    paths: 1, summary: 'derive .d.ts from schema' },

  // VALIDATE
  { id: 'N09', col: 'validate', y: 290, title: 'Unit & integration',
    handle: 'vitest_run', kind: 'validation', state: 'planned',
    paths: 0, summary: 'pnpm vitest src/webhooks' },
  { id: 'N10', col: 'validate', y: 470, title: 'End-to-end',
    handle: 'e2e_run', kind: 'validation', state: 'blocked',
    paths: 0, summary: 'awaits N08' },

  // INTEGRATE
  { id: 'N11', col: 'integrate', y: 380, title: 'Merge branches',
    handle: 'merge_branches', kind: 'integration', state: 'planned',
    paths: 0, summary: 'rebase, reconcile, prepare PR' },
];

const EDGES = [
  ['N01','N02'], ['N01','N03'],
  ['N02','N04'], ['N02','N05'],
  ['N03','N05'], ['N03','N06'], ['N03','N07'], ['N03','N08'],
  ['N04','N05'],
  ['N05','N06'], ['N05','N07'],
  ['N05','N09'], ['N06','N09'], ['N07','N09'],
  ['N08','N10'], ['N09','N10'],
  ['N09','N11'], ['N10','N11'],
];

const nodeById  = Object.fromEntries(NODES.map(n => [n.id, n]));
const phaseById = Object.fromEntries(PHASES.map(p => [p.id, p]));

const RUN_META = {
  title: 'Add idempotency to webhook handlers',
  id: 'run_aF82',
  repo: 'acme/payments',
  branch: 'feat/webhook-idempotency',
  granularity: 'G6',
  mode: 'execution-ready',
  updated: 'updated 2 min ago',
  totals: { nodes: 11, leaves: 7, depth: 4, ready: 3 },
  counters: { planned: 4, ready: 3, running: 0, done: 4, failed: 0, blocked: 1 },
};

Object.assign(window, { PHASES, NODES, EDGES, nodeById, phaseById, NODE_W, RUN_META });
