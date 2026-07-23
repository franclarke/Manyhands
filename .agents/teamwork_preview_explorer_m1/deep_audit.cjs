const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const auditDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness';

const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));
const valFindings = JSON.parse(fs.readFileSync(path.join(planningDir, 'validated-findings-ledger.json'), 'utf8'));
const auditFindings = JSON.parse(fs.readFileSync(path.join(auditDir, 'findings-ledger.json'), 'utf8'));

console.log('=== DEEP AUDIT OF PLANNING ARTIFACTS ===\n');

// 1. Parse 05-master-backlog.md
const masterBacklogContent = fs.readFileSync(path.join(planningDir, '05-master-backlog.md'), 'utf8');
const mbLines = masterBacklogContent.split('\n');
const mbTasks = [];
let currentTask = null;

mbLines.forEach((line, idx) => {
  const h3Match = line.match(/^###\s+(MH-REM-\d+):\s+(.*)/);
  if (h3Match) {
    if (currentTask) mbTasks.push(currentTask);
    currentTask = { id: h3Match[1], title: h3Match[2].trim(), line: idx + 1, raw: [line] };
  } else if (currentTask) {
    currentTask.raw.push(line);
  }
});
if (currentTask) mbTasks.push(currentTask);

console.log(`05-master-backlog.md defined tasks count: ${mbTasks.length}`);

// 2. Parse 07-implementation-waves.md
const wavesContent = fs.readFileSync(path.join(planningDir, '07-implementation-waves.md'), 'utf8');
const wavesLines = wavesContent.split('\n');
const waveAssignmentsFromDoc = {}; // taskId -> waveNum / waveName

let currentWaveHeader = null;
wavesLines.forEach(line => {
  const waveHeaderMatch = line.match(/^##\s+Wave\s+(\d+|[0-8])\b/i) || line.match(/^#+\s+(Wave\s+\d+.*)/i);
  if (waveHeaderMatch) {
    currentWaveHeader = waveHeaderMatch[1];
  }
  const remMatch = line.match(/MH-REM-\d+/g);
  if (remMatch) {
    remMatch.forEach(id => {
      if (!waveAssignmentsFromDoc[id]) waveAssignmentsFromDoc[id] = [];
      waveAssignmentsFromDoc[id].push({ wave: currentWaveHeader, line: line.trim() });
    });
  }
});

// 3. Parse 03-architecture-decisions-required.md
const adrContent = fs.readFileSync(path.join(planningDir, '03-architecture-decisions-required.md'), 'utf8');

// 4. Parse 10-release-gates.md
const gatesContent = fs.readFileSync(path.join(planningDir, '10-release-gates.md'), 'utf8');

// 5. Parse 06-dependency-graph.md
const depContent = fs.readFileSync(path.join(planningDir, '06-dependency-graph.md'), 'utf8');

// 6. Compare backlog.json items with 05-master-backlog.md items
console.log('\n--- Task ID & Title Comparison (json vs 05-master-backlog.md) ---');
const jsonTaskIds = new Set(backlog.items.map(i => i.id));
const mbTaskIds = new Set(mbTasks.map(t => t.id));

console.log(`In JSON but not in 05-master-backlog.md:`, [...jsonTaskIds].filter(id => !mbTaskIds.has(id)));
console.log(`In 05-master-backlog.md but not in JSON:`, [...mbTaskIds].filter(id => !jsonTaskIds.has(id)));

// Check title mismatches
backlog.items.forEach(jItem => {
  const mbItem = mbTasks.find(t => t.id === jItem.id);
  if (mbItem && jItem.title.toLowerCase() !== mbItem.title.toLowerCase()) {
    console.log(`TITLE MISMATCH for ${jItem.id}:`);
    console.log(`  JSON: "${jItem.title}"`);
    console.log(`  MD:   "${mbItem.title}"`);
  }
});

