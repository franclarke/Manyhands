const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';

const adrPath = path.join(planningDir, '03-architecture-decisions-required.md');
const content = fs.readFileSync(adrPath, 'utf8');

console.log('=== FULL ANALYSIS OF 03-architecture-decisions-required.md ===\n');

// Extract all ADR sections
const sections = content.split(/^###?\s+/m);

sections.forEach((sec, idx) => {
  if (idx === 0) return; // intro
  const lines = sec.trim().split('\n');
  const titleLine = lines[0];
  console.log(`--- ADR Section: ${titleLine} ---`);
  
  // extract Status, Driver, Options, Tasks, Epic
  lines.forEach(l => {
    if (l.includes('Status') || l.includes('ADR') || l.includes('Wave') || l.includes('MH-REM-') || l.includes('State') || l.includes('Decision')) {
      console.log('  ', l.trim());
    }
  });
  console.log('');
});

