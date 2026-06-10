const fs = require('fs');
const planning = fs.readFileSync('apps/web/src/lib/server/runs/planning-pipeline.ts', 'utf8').split('\n');
fs.writeFileSync('apps/web/src/lib/server/runs/planning-pipeline.ts', planning.slice(0, 643).join('\n'));

const execution = fs.readFileSync('apps/web/src/lib/server/runs/execution-pipeline.ts', 'utf8').split('\n');
fs.writeFileSync('apps/web/src/lib/server/runs/execution-pipeline.ts', execution.slice(0, 173).concat(execution.slice(643)).join('\n'));
