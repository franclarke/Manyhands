const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const auditDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness';

const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));
const valLedger = JSON.parse(fs.readFileSync(path.join(planningDir, 'validated-findings-ledger.json'), 'utf8'));
const auditLedger = JSON.parse(fs.readFileSync(path.join(auditDir, 'findings-ledger.json'), 'utf8'));

console.log('=== DETAILED AUDIT SCRIPT ===');

// --- A. AUDIT FINDINGS MAPPING CHECK ---
console.log('\n--- A. AUDIT FINDINGS MAPPING CHECK ---');
const valFindingsList = valLedger.findings || valLedger.validatedFindings || valLedger;
const valFindingIds = new Set();
if (Array.isArray(valFindingsList)) {
  valFindingsList.forEach(f => valFindingIds.add(f.id));
} else if (typeof valFindingsList === 'object') {
  Object.keys(valFindingsList).forEach(k => {
    if (Array.isArray(valFindingsList[k])) {
      valFindingsList[k].forEach(f => valFindingIds.add(f.id));
    }
  });
}

console.log(`Validated Findings in validated-findings-ledger.json: ${valFindingIds.size}`);
console.log(`Finding IDs:`, [...valFindingIds].sort());

// Check findings mapped in remediation-backlog.json items
const mappedFindingsInBacklog = new Set();
backlog.items.forEach(item => {
  if (item.relatedAuditFindings) {
    item.relatedAuditFindings.forEach(fId => mappedFindingsInBacklog.add(fId));
  }
});

console.log(`Distinct Finding IDs referenced in backlog.json items: ${mappedFindingsInBacklog.size}`);
console.log(`Finding IDs in backlog.json:`, [...mappedFindingsInBacklog].sort());

// Findings in validated-findings-ledger that are NOT mapped in backlog.json items
const unmappedValidatedFindings = [...valFindingIds].filter(fId => !mappedFindingsInBacklog.has(fId));
console.log(`UNMAPPED Validated Findings (in ledger but not in backlog items):`, unmappedValidatedFindings);

// Finding IDs in backlog.json items that are NOT in validated-findings-ledger.json
const unknownFindingsInBacklog = [...mappedFindingsInBacklog].filter(fId => !valFindingIds.has(fId));
console.log(`UNKNOWN Finding IDs in backlog items (not in validated findings ledger):`, unknownFindingsInBacklog);

// --- B. PARSING 07-implementation-waves.md FOR WAVE ASSIGNMENTS ---
console.log('\n--- B. PARSING 07-implementation-waves.md FOR WAVE ASSIGNMENTS ---');
const wavesMd = fs.readFileSync(path.join(planningDir, '07-implementation-waves.md'), 'utf8');

const waveTaskMap = {}; // waveNum -> array of task IDs
let currentWave = null;

wavesMd.split('\n').forEach(line => {
  const waveHeader = line.match(/^##\s+Wave\s+(\d+):?\s*(.*)/i);
  if (waveHeader) {
    currentWave = parseInt(waveHeader[1], 10);
    if (!waveTaskMap[currentWave]) waveTaskMap[currentWave] = [];
  }
  
  // Look for MH-REM-XXX in tables or list items
  const remMatches = line.match(/`?(MH-REM-\d+)`?/g);
  if (remMatches && currentWave !== null) {
    remMatches.forEach(m => {
      const cleanId = m.replace(/`/g, '');
      if (!waveTaskMap[currentWave].includes(cleanId)) {
        waveTaskMap[currentWave].push(cleanId);
      }
    });
  }
});

console.log('Wave assignments found in 07-implementation-waves.md:');
Object.keys(waveTaskMap).sort((a,b)=>a-b).forEach(w => {
  console.log(`  Wave ${w}: count=${waveTaskMap[w].length} -> ${waveTaskMap[w].join(', ')}`);
});

// Check if all 50 items are assigned to a Wave in 07-implementation-waves.md
const assignedInWaves = new Set();
Object.values(waveTaskMap).forEach(list => list.forEach(id => assignedInWaves.add(id)));
const unassignedInWaves = backlog.items.map(i => i.id).filter(id => !assignedInWaves.has(id));
console.log(`Tasks missing from 07-implementation-waves.md:`, unassignedInWaves);

// Check if any task is assigned to MULTIPLE waves in 07-implementation-waves.md
const taskWaveCounts = {};
Object.entries(waveTaskMap).forEach(([w, list]) => {
  list.forEach(id => {
    if (!taskWaveCounts[id]) taskWaveCounts[id] = [];
    taskWaveCounts[id].push(w);
  });
});
const multiWaveTasks = Object.entries(taskWaveCounts).filter(([id, waves]) => waves.length > 1);
if (multiWaveTasks.length > 0) {
  console.log(`Tasks assigned to MULTIPLE waves in 07-implementation-waves.md:`, multiWaveTasks);
}

// --- C. PARSING 03-architecture-decisions-required.md FOR ADRS ---
console.log('\n--- C. PARSING 03-architecture-decisions-required.md FOR ADRS ---');
const adrMd = fs.readFileSync(path.join(planningDir, '03-architecture-decisions-required.md'), 'utf8');
const adrLines = adrMd.split('\n');

const adrs = []; // { id, title, status, mappedTasks }
let curAdr = null;

adrLines.forEach(line => {
  const adrHeader = line.match(/^###?\s+(ADR-\d+|MH-ADR-\d+):?\s*(.*)/i);
  if (adrHeader) {
    if (curAdr) adrs.push(curAdr);
    curAdr = { id: adrHeader[1], title: adrHeader[2], status: 'UNKNOWN', tasks: [], raw: [line] };
  } else if (curAdr) {
    curAdr.raw.push(line);
    const statusMatch = line.match(/\*\*Status\*\*:\s*`?([A-Z_]+)`?/i) || line.match(/Status:\s*`?([A-Z_]+)`?/i);
    if (statusMatch) curAdr.status = statusMatch[1].toUpperCase();
    const remMatch = line.match(/MH-REM-\d+/g);
    if (remMatch) {
      remMatch.forEach(id => {
        if (!curAdr.tasks.includes(id)) curAdr.tasks.push(id);
      });
    }
  }
});
if (curAdr) adrs.push(curAdr);

console.log(`ADRs found in 03-architecture-decisions-required.md: ${adrs.length}`);
adrs.forEach(a => {
  console.log(`  ${a.id} | Status: ${a.status} | Title: ${a.title} | Tasks: ${a.tasks.join(', ')}`);
});

