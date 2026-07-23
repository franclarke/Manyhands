const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const valLedger = JSON.parse(fs.readFileSync(path.join(planningDir, 'validated-findings-ledger.json'), 'utf8'));
const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));

const allFindings = valLedger.findings;
console.log('Total findings in ledger:', allFindings.length);

const items = backlog.items;
console.log('Total items in backlog:', items.length);

// Map findings to items
const findingToItems = {};
allFindings.forEach(f => {
  findingToItems[f.id] = [];
});

items.forEach(item => {
  if (item.relatedAuditFindings) {
    item.relatedAuditFindings.forEach(fId => {
      if (findingToItems[fId]) {
        findingToItems[fId].push(item.id);
      } else {
        console.log(`Warning: Item ${item.id} references unknown finding ${fId}`);
      }
    });
  }
});

const unmapped = Object.keys(findingToItems).filter(fId => findingToItems[fId].length === 0);
console.log(`Unmapped findings count: ${unmapped.length}`);

// Group unmapped findings by category
const unmappedByCategory = {};
unmapped.forEach(fId => {
  const f = allFindings.find(x => x.id === fId);
  const cat = f.category || f.id.split('-').slice(0, 3).join('-');
  if (!unmappedByCategory[cat]) unmappedByCategory[cat] = [];
  unmappedByCategory[cat].push({ id: f.id, title: f.title, targetFile: f.targetFile });
});

console.log('Unmapped findings by category:', JSON.stringify(unmappedByCategory, null, 2));
