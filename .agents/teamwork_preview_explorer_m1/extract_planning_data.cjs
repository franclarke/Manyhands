const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const auditDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness';

// Helper to load JSON
function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const backlog = loadJson(path.join(planningDir, 'remediation-backlog.json'));
const valFindingsLedger = loadJson(path.join(planningDir, 'validated-findings-ledger.json'));
const auditFindingsLedger = loadJson(path.join(auditDir, 'findings-ledger.json'));

console.log('--- 1. BACKLOG JSON OVERVIEW ---');
console.log(`Backlog Items count: ${backlog.items.length}`);

// Map of items in backlog.json
const backlogMap = {};
backlog.items.forEach(item => {
  backlogMap[item.id] = item;
});

// Scan all markdown files in planning and production-readiness
const filesToScan = [
  '00-audit-integrity-review.md',
  '01-validated-findings.md',
  '02-product-readiness-levels.md',
  '03-architecture-decisions-required.md',
  '04-remediation-epics.md',
  '05-master-backlog.md',
  '06-dependency-graph.md',
  '07-implementation-waves.md',
  '08-agent-execution-plan.md',
  '09-test-strategy.md',
  '10-release-gates.md',
  '11-risk-register.md',
  '12-open-questions.md',
  'planning-command-results.md'
];

console.log('\n--- 2. SCANNING FOR MH-REM-* IN MARKDOWN FILES ---');

const remReferencesInDocs = {}; // docName -> array of { lineNum, id, titleSnippet, wave, adr, gate }

filesToScan.forEach(fileName => {
  const filePath = path.join(planningDir, fileName);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  lines.forEach((line, idx) => {
    const matches = line.match(/MH-REM-[A-Z0-9_-]+/g);
    if (matches) {
      matches.forEach(id => {
        if (!remReferencesInDocs[id]) remReferencesInDocs[id] = [];
        remReferencesInDocs[id].push({
          doc: fileName,
          lineNum: idx + 1,
          line: line.trim()
        });
      });
    }
  });
});

console.log(`Total distinct MH-REM-* IDs referenced across markdown files: ${Object.keys(remReferencesInDocs).length}`);
console.log('List of distinct IDs:', Object.keys(remReferencesInDocs).sort());

// Check if any referenced ID is NOT in backlog.json
const missingInBacklog = Object.keys(remReferencesInDocs).filter(id => !backlogMap[id]);
console.log('IDs referenced in Markdown but missing in remediation-backlog.json:', missingInBacklog);

