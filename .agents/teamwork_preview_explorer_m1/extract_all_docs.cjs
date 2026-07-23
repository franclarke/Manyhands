const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';

console.log('=== EXTRACTING ALL TASK DEFINITIONS ACROSS DOCUMENTS ===\n');

// 1. Parse 07-implementation-waves.md
const waveContent = fs.readFileSync(path.join(planningDir, '07-implementation-waves.md'), 'utf8');
const waveLines = waveContent.split('\n');
const waveTasks = []; // { id, title, wave, file, finding }
let curWaveNum = null;

waveLines.forEach(line => {
  const wHeader = line.match(/^###\s+Wave\s+(\d+):/i);
  if (wHeader) {
    curWaveNum = parseInt(wHeader[1], 10);
  }
  const itemMatch = line.match(/^\s*\d+\.\s+`(MH-REM-\d+)`:\s*([^(`]+)(?:\(`([^`]+)`,\s*`?(MH-AUDIT-[^`\)]+)`?\))?/);
  if (itemMatch && curWaveNum !== null) {
    waveTasks.push({
      id: itemMatch[1],
      title: itemMatch[2].trim(),
      wave: curWaveNum,
      targetFile: itemMatch[3] ? itemMatch[3].trim() : '',
      finding: itemMatch[4] ? itemMatch[4].trim() : ''
    });
  }
});

console.log(`Parsed ${waveTasks.length} tasks from 07-implementation-waves.md:`);
waveTasks.slice(0, 15).forEach(t => console.log(`  Wave ${t.wave} | ${t.id} | ${t.title} | ${t.finding}`));

// 2. Parse 06-dependency-graph.md
const depContent = fs.readFileSync(path.join(planningDir, '06-dependency-graph.md'), 'utf8');
console.log('\n--- 06-dependency-graph.md snippet inspection ---');
const depLines = depContent.split('\n');
depLines.slice(0, 60).forEach((l, i) => console.log(`${i+1}: ${l}`));

