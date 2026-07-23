const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const backlog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));

console.log('Current technicalDependencies in backlog items:');
backlog.items.forEach(item => {
  console.log(`${item.id} -> [${(item.technicalDependencies || []).join(', ')}]`);
});
