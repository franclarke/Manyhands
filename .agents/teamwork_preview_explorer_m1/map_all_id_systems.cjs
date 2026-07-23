const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';

const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));

// 1. Extract Epic-Ordered Tasks from remediation-backlog.json
const epicOrderedTasks = backlog.items.map(item => ({
  id: item.id,
  title: item.title,
  epic: item.epic,
  findings: item.relatedAuditFindings || [],
  dependencies: item.technicalDependencies || []
}));

// 2. Extract Wave-Ordered Tasks from 07-implementation-waves.md
const waveMd = fs.readFileSync(path.join(planningDir, '07-implementation-waves.md'), 'utf8');
const waveLines = waveMd.split('\n');

const waveOrderedTasks = [];
let currentWave = null;

for (let i = 0; i < waveLines.length; i++) {
  const line = waveLines[i];
  const waveHeader = line.match(/^###\s+Wave\s+(\d+):/i);
  if (waveHeader) {
    currentWave = parseInt(waveHeader[1], 10);
  }
  
  // Look for items: 1. `MH-REM-001`: GroundingAgent Dirty Workspace Pre-check (`packages/execution-core/src/run/grounding-agent.ts`, `MH-AUDIT-GIT-010`)
  // or list items under Included Backlog Items
  const match = line.match(/^\s*\d+\.\s+`(MH-REM-\d+)`:\s*([^\(`]+)/);
  if (match && currentWave !== null) {
    const taskId = match[1];
    const title = match[2].trim();
    // find finding in parenthesis if any
    const findingMatch = line.match(/`(MH-AUDIT-[^`]+)`/);
    waveOrderedTasks.push({
      id: taskId,
      title: title,
      wave: currentWave,
      finding: findingMatch ? findingMatch[1] : null,
      fullLine: line.trim()
    });
  }
}

console.log('--- EPIC-ORDERED TASKS (remediation-backlog.json) count:', epicOrderedTasks.length);
console.log('--- WAVE-ORDERED TASKS (07-implementation-waves.md) count:', waveOrderedTasks.length);

console.log('\n--- COMPARING ITEM BY ITEM ---');
console.log('Epic-ID | Epic Title | Wave-ID | Wave-Title | Wave Num');
console.log('----------------------------------------------------------------------');

for (let i = 0; i < Math.max(epicOrderedTasks.length, waveOrderedTasks.length); i++) {
  const epicItem = epicOrderedTasks[i] || { id: 'N/A', title: 'N/A' };
  const waveItem = waveOrderedTasks[i] || { id: 'N/A', title: 'N/A', wave: 'N/A' };
  console.log(`${epicItem.id.padEnd(10)} | ${epicItem.title.padEnd(45)} || ${waveItem.id.padEnd(10)} | ${waveItem.title.padEnd(45)} | Wave ${waveItem.wave}`);
}

