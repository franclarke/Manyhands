const fs = require('fs');
const runner = fs.readFileSync('apps/web/src/lib/server/runs/runner.ts', 'utf8').split('\n');
let newRunner = runner.slice(0, 173);
newRunner.push('export * from "./planning-pipeline";');
newRunner.push('export * from "./execution-pipeline";');
fs.writeFileSync('apps/web/src/lib/server/runs/runner.ts', newRunner.join('\n'));
