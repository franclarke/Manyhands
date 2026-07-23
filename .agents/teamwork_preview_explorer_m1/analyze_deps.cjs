const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';

console.log('=== ANALYSIS OF DEPENDENCY DAG & CYCLES ===\n');

// Let's parse 06-dependency-graph.md for declared dependencies
const depMd = fs.readFileSync(path.join(planningDir, '06-dependency-graph.md'), 'utf8');

// Parse mermaid or text table in 06-dependency-graph.md
const depLines = depMd.split('\n');
const mermaidEdges = [];

depLines.forEach(l => {
  // e.g. REM001 --> REM006 or REM001 --> REM007 or REM006 --> REM012
  const edgeMatch = l.match(/(REM\d+)\s*--+>\s*(REM\d+)/);
  if (edgeMatch) {
    const fromId = 'MH-REM-' + edgeMatch[1].replace('REM', '');
    const toId = 'MH-REM-' + edgeMatch[2].replace('REM', '');
    mermaidEdges.push({ from: fromId, to: toId });
  }
});

console.log(`Found ${mermaidEdges.length} Mermaid edges in 06-dependency-graph.md:`);
mermaidEdges.forEach(e => console.log(`  ${e.from} -> ${e.to}`));

// Parse technicalDependencies in remediation-backlog.json
const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));

console.log('\n--- Dependencies declared in remediation-backlog.json ---');
const jsonDeps = [];
backlog.items.forEach(item => {
  if (item.technicalDependencies && item.technicalDependencies.length > 0) {
    item.technicalDependencies.forEach(depId => {
      jsonDeps.push({ from: depId, to: item.id });
      console.log(`  ${depId} -> ${item.id}`);
    });
  }
});

