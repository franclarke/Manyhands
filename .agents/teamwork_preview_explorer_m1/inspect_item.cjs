const fs = require('fs');
const path = require('path');

const backlogPath = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning\\remediation-backlog.json';
const backlog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));

console.log('Sample Item 1:', JSON.stringify(backlog.items[0], null, 2));
