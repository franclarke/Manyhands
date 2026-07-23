const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));

// System W mapping pair definition: index 0 to 49 (System W ID MH-REM-001 to MH-REM-050)
const waveMappings = [
  { waveNum: 1,  canonicalId: "MH-REM-007", waveTitle: "GroundingAgent Dirty Workspace Pre-check", primaryFinding: "MH-AUDIT-GIT-010" },
  { waveNum: 2,  canonicalId: "MH-REM-014", waveTitle: "Durable Lock Ownership Verification", primaryFinding: "MH-AUDIT-PERS-001" },
  { waveNum: 3,  canonicalId: "MH-REM-031", waveTitle: "Refactor Fragile UI String Tests to DOM Rendering", primaryFinding: "MH-AUDIT-QA-003" },
  { waveNum: 4,  canonicalId: "MH-REM-040", waveTitle: "Standardize Workspace Specifiers to workspace:*", primaryFinding: "MH-AUDIT-INFRA-001" },
  { waveNum: 5,  canonicalId: "MH-REM-046", waveTitle: "Validation Runner Child Process Leak Fix", primaryFinding: "MH-AUDIT-QA-002" },
  { waveNum: 6,  canonicalId: "MH-REM-001", waveTitle: "Task Graph Artifact Cycle Detection", primaryFinding: "MH-AUDIT-ORCH-001" },
  { waveNum: 7,  canonicalId: "MH-REM-005", waveTitle: "SeamBinding Schema Versioning", primaryFinding: "MH-AUDIT-ORCH-005" },
  { waveNum: 8,  canonicalId: "MH-REM-002", waveTitle: "ConflictConstraint Scheduler Integration", primaryFinding: "MH-AUDIT-ORCH-002" },
  { waveNum: 9,  canonicalId: "MH-REM-006", waveTitle: "Goal & Scope Revision Immutability", primaryFinding: "MH-AUDIT-ORCH-006" },
  { waveNum: 10, canonicalId: "MH-REM-004", waveTitle: "Validation Obligation Contract Guard", primaryFinding: "MH-AUDIT-ORCH-004" },
  { waveNum: 11, canonicalId: "MH-REM-003", waveTitle: "Composite Node Expansion Compiler", primaryFinding: "MH-AUDIT-ORCH-003" },
  { waveNum: 12, canonicalId: "MH-REM-015", waveTitle: "Event Store Atomic Write Retry Backoff", primaryFinding: "MH-AUDIT-PERS-002" },
  { waveNum: 13, canonicalId: "MH-REM-018", waveTitle: "True File Append Stream Event Store", primaryFinding: "MH-AUDIT-GAP-008" },
  { waveNum: 14, canonicalId: "MH-REM-016", waveTitle: "Attempt Store Status Transition Guard", primaryFinding: "MH-AUDIT-PERS-006" },
  { waveNum: 15, canonicalId: "MH-REM-017", waveTitle: "Event Log Compaction & Snapshots", primaryFinding: "MH-AUDIT-GAP-001" },
  { waveNum: 16, canonicalId: "MH-REM-020", waveTitle: "Local Event Replay Crash Recovery", primaryFinding: "MH-AUDIT-PERS-005" },
  { waveNum: 17, canonicalId: "MH-REM-019", waveTitle: "File System Storage Space Safety Monitor", primaryFinding: "MH-AUDIT-PERS-004" },
  { waveNum: 18, canonicalId: "MH-REM-009", waveTitle: "Process Environment Sanitization", primaryFinding: "MH-AUDIT-SEC-001" },
  { waveNum: 19, canonicalId: "MH-REM-008", waveTitle: "Scope Checker Path Traversal Resolution", primaryFinding: "MH-AUDIT-SEC-002" },
  { waveNum: 20, canonicalId: "MH-REM-010", waveTitle: "Worktree Lifecycle Auto-GC", primaryFinding: "MH-AUDIT-GIT-001" },
  { waveNum: 21, canonicalId: "MH-REM-011", waveTitle: "Git Index Lock Contention Retry Loop", primaryFinding: "MH-AUDIT-GIT-005" },
  { waveNum: 22, canonicalId: "MH-REM-012", waveTitle: "Local Command Injection Shield", primaryFinding: "MH-AUDIT-GIT-007" },
  { waveNum: 23, canonicalId: "MH-REM-013", waveTitle: "Symlink & Git Hook Execution Guard", primaryFinding: "MH-AUDIT-GIT-009" },
  { waveNum: 24, canonicalId: "MH-REM-048", waveTitle: "Local Process Resource Supervision", primaryFinding: "MH-AUDIT-QA-005" },
  { waveNum: 25, canonicalId: "MH-REM-022", waveTitle: "InputFingerprint Hash Engine", primaryFinding: "MH-AUDIT-ORCH-004" },
  { waveNum: 26, canonicalId: "MH-REM-021", waveTitle: "Execution Base Directory Materializer", primaryFinding: "MH-AUDIT-ORCH-003" },
  { waveNum: 27, canonicalId: "MH-REM-025", waveTitle: "Candidate Commit Verification Pipeline", primaryFinding: "MH-AUDIT-EXEC-003" },
  { waveNum: 28, canonicalId: "MH-REM-024", waveTitle: "Grounding Agent Incremental Re-grounding", primaryFinding: "MH-AUDIT-EXEC-004" },
  { waveNum: 29, canonicalId: "MH-REM-026", waveTitle: "Failure Recovery Classifier & Policy Engine", primaryFinding: "MH-AUDIT-EXEC-005" },
  { waveNum: 30, canonicalId: "MH-REM-023", waveTitle: "Local Validation Evidence Matrix Builder", primaryFinding: "MH-AUDIT-GAP-009" },
  { waveNum: 31, canonicalId: "MH-REM-028", waveTitle: "Next.js API Localhost Binding & CSRF Guard", primaryFinding: "MH-AUDIT-API-006" },
  { waveNum: 32, canonicalId: "MH-REM-027", waveTitle: "SSE Stream Request Abort Signal Listener", primaryFinding: "MH-AUDIT-API-001" },
  { waveNum: 33, canonicalId: "MH-REM-030", waveTitle: "Frontend Client Incremental SSE Model Sync", primaryFinding: "MH-AUDIT-API-002" },
  { waveNum: 34, canonicalId: "MH-REM-032", waveTitle: "React Flow Canvas Viewport Stays Fixed", primaryFinding: "MH-AUDIT-API-003" },
  { waveNum: 35, canonicalId: "MH-REM-029", waveTitle: "Decision Queue Modal & Unblocked Execution", primaryFinding: "MH-AUDIT-API-008" },
  { waveNum: 36, canonicalId: "MH-REM-033", waveTitle: "State Indicator Badge Contract Compliance", primaryFinding: "MH-AUDIT-API-015" },
  { waveNum: 37, canonicalId: "MH-REM-045", waveTitle: "Local Action Confirmation & Execution Guard", primaryFinding: "MH-AUDIT-QA-003" },
  { waveNum: 38, canonicalId: "MH-REM-034", waveTitle: "User Code Snippet XML Envelope Escaping", primaryFinding: "MH-AUDIT-AI-001" },
  { waveNum: 39, canonicalId: "MH-REM-035", waveTitle: "LLM Token Budget Cap & Cost Guardrail", primaryFinding: "MH-AUDIT-AI-002" },
  { waveNum: 40, canonicalId: "MH-REM-037", waveTitle: "System Prompt Boundary Decoy Rules", primaryFinding: "MH-AUDIT-AI-006" },
  { waveNum: 41, canonicalId: "MH-REM-036", waveTitle: "Decomposer Structural Schema Validator", primaryFinding: "MH-AUDIT-AI-003" },
  { waveNum: 42, canonicalId: "MH-REM-038", waveTitle: "Local API Key Storage & Encryption", primaryFinding: "MH-AUDIT-AI-005" },
  { waveNum: 43, canonicalId: "MH-REM-039", waveTitle: "Untrusted LLM Command Execution Approver", primaryFinding: "MH-AUDIT-AI-004" },
  { waveNum: 44, canonicalId: "MH-REM-041", waveTitle: "Durable JsonlTraceStore Persistence Engine", primaryFinding: "MH-AUDIT-INFRA-002" },
  { waveNum: 45, canonicalId: "MH-REM-042", waveTitle: "pnpm Workspace Dependency Version Lock", primaryFinding: "MH-AUDIT-INFRA-001" },
  { waveNum: 46, canonicalId: "MH-REM-043", waveTitle: "Optional Local Docker Sandbox Adapter", primaryFinding: "MH-AUDIT-INFRA-003" },
  { waveNum: 47, canonicalId: "MH-REM-044", waveTitle: "Local Diagnostic Telemetry & Log Rotation", primaryFinding: "MH-AUDIT-INFRA-009" },
  { waveNum: 48, canonicalId: "MH-REM-047", waveTitle: "Single-Command Local Setup & Self-Test CLI", primaryFinding: "MH-AUDIT-QA-004" },
  { waveNum: 49, canonicalId: "MH-REM-049", waveTitle: "WCAG 2.2 AA Accessibility & Keyboard Nav", primaryFinding: "MH-AUDIT-ORCH-002" },
  { waveNum: 50, canonicalId: "MH-REM-050", waveTitle: "End-to-End Local Execution Integration Suite", primaryFinding: "MH-AUDIT-QA-001" }
];

const mappings = waveMappings.map(wm => {
  const wIdNum = wm.waveNum.toString().padStart(3, '0');
  const legacyWaveId = `MH-REM-${wIdNum}`;
  const markdownAlias = `REM${wIdNum}`;
  
  const cItem = backlog.items.find(i => i.id === wm.canonicalId);
  
  return {
    canonicalId: wm.canonicalId,
    canonicalTitle: cItem ? cItem.title : "Title TBD",
    legacyWaveId: legacyWaveId,
    legacyWaveTitle: wm.waveTitle,
    markdownAlias: markdownAlias,
    wave: cItem ? cItem.wave : 0,
    releaseGate: cItem ? cItem.releaseGate : "Gate A",
    primaryFinding: wm.primaryFinding,
    documentReferences: [
      `06-dependency-graph.md:${markdownAlias}`,
      `07-implementation-waves.md:${legacyWaveId}`,
      `10-release-gates.md:${legacyWaveId}`
    ]
  };
});

const migrationLedger = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "generatedAt": new Date().toISOString(),
  "version": "1.0.0",
  "description": "Migration ledger mapping legacy System W (Wave-Ordered) IDs and markdown references to Canonical System E (Epic-Ordered) IDs",
  "totalMappings": mappings.length,
  "mappings": mappings
};

fs.writeFileSync(path.join(planningDir, 'remediation-id-migration.json'), JSON.stringify(migrationLedger, null, 2), 'utf8');
console.log('Successfully wrote remediation-id-migration.json with', mappings.length, 'mappings');
