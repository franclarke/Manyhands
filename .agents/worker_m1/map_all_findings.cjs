const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const valLedger = JSON.parse(fs.readFileSync(path.join(planningDir, 'validated-findings-ledger.json'), 'utf8'));
const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));

const findings = valLedger.findings;
const items = backlog.items;

console.log('All 91 Findings:');
findings.forEach(f => {
  console.log(`${f.id} | ${f.category} | ${f.title} | ${f.targetFile}`);
});
