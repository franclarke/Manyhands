const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const auditDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness';

console.log('--- Inspecting JSON files ---');

const backlogPath = path.join(planningDir, 'remediation-backlog.json');
const validatedFindingsPath = path.join(planningDir, 'validated-findings-ledger.json');
const auditFindingsPath = path.join(auditDir, 'findings-ledger.json');

const backlog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));
const validatedFindings = JSON.parse(fs.readFileSync(validatedFindingsPath, 'utf8'));
const auditFindings = JSON.parse(fs.readFileSync(auditFindingsPath, 'utf8'));

console.log(`Backlog total items reported: ${backlog.totalItems}, actual items length: ${backlog.items ? backlog.items.length : 0}`);
console.log(`Validated findings total: ${validatedFindings.totalFindings || (validatedFindings.findings ? validatedFindings.findings.length : 0)}`);
console.log(`Audit findings total: ${auditFindings.findings ? auditFindings.findings.length : 0}`);

// Check items in backlog
const backlogItemIds = backlog.items.map(i => i.id);
const uniqueBacklogItemIds = new Set(backlogItemIds);
console.log(`Backlog items count: ${backlogItemIds.length}, Unique IDs count: ${uniqueBacklogItemIds.size}`);

if (backlogItemIds.length !== uniqueBacklogItemIds.size) {
  const duplicates = backlogItemIds.filter((item, index) => backlogItemIds.indexOf(item) !== index);
  console.log(`Duplicate IDs in backlog.json:`, duplicates);
}

// Inspect markdown files in planningDir
const mdFiles = fs.readdirSync(planningDir).filter(f => f.endsWith('.md'));
console.log('\nMarkdown files in planning:');
mdFiles.forEach(f => console.log(' - ' + f));

