const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const auditDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness';

const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));
const valLedger = JSON.parse(fs.readFileSync(path.join(planningDir, 'validated-findings-ledger.json'), 'utf8'));

// 1. Build map of Epic-Ordered items (from remediation-backlog.json)
const epicItems = backlog.items;

// 2. Build map of Wave-Ordered items (from 07-implementation-waves.md)
const wavesMd = fs.readFileSync(path.join(planningDir, '07-implementation-waves.md'), 'utf8');
const waveLines = wavesMd.split('\n');
const waveItems = [];
let currentWave = null;

waveLines.forEach(line => {
  const wHeader = line.match(/^###\s+Wave\s+(\d+):/i);
  if (wHeader) currentWave = parseInt(wHeader[1], 10);
  
  // Example match: 1. `MH-REM-001`: GroundingAgent Dirty Workspace Pre-check (`packages/execution-core/src/run/grounding-agent.ts`, `MH-AUDIT-GIT-010`)
  const match = line.match(/^\s*\d+\.\s+`(MH-REM-\d+)`:\s*([^\(`]+)/);
  if (match && currentWave !== null) {
    const findingMatch = line.match(/`(MH-AUDIT-[^`]+)`/);
    waveItems.push({
      waveId: match[1],
      title: match[2].trim(),
      wave: currentWave,
      finding: findingMatch ? findingMatch[1] : null,
      line: line.trim()
    });
  }
});

console.log('=== CROSS-MATCHING EPIC-ORDERED (JSON) & WAVE-ORDERED (MD) ITEMS ===\n');

// We want to match every Epic item to its corresponding Wave item based on title / finding / scope
const matches = [];

epicItems.forEach(eItem => {
  // Find matching wave item
  let matchedWaveItem = waveItems.find(wItem => {
    // Exact finding match
    if (wItem.finding && eItem.relatedAuditFindings && eItem.relatedAuditFindings.includes(wItem.finding)) {
      return true;
    }
    // Title similarity match
    const eTitle = eItem.title.toLowerCase();
    const wTitle = wItem.title.toLowerCase();
    if (eTitle.includes(wTitle) || wTitle.includes(eTitle)) return true;
    return false;
  });
  
  matches.push({
    epicId: eItem.id,
    epicTitle: eItem.title,
    epicFindings: eItem.relatedAuditFindings || [],
    waveId: matchedWaveItem ? matchedWaveItem.waveId : 'UNMATCHED',
    waveNum: matchedWaveItem ? matchedWaveItem.wave : 'UNMATCHED',
    waveTitle: matchedWaveItem ? matchedWaveItem.title : 'UNMATCHED',
    waveFinding: matchedWaveItem ? matchedWaveItem.finding : null
  });
});

matches.forEach(m => {
  console.log(`[JSON: ${m.epicId}] "${m.epicTitle}" (Findings: ${m.epicFindings.join(',')})`);
  console.log(`  ---> [MD: ${m.waveId}] Wave ${m.waveNum}: "${m.waveTitle}" (Finding: ${m.waveFinding})`);
  console.log('---');
});

