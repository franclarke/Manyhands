const fs = require('fs');
const file = 'packages/decomposer/src/index.ts';
let content = fs.readFileSync(file, 'utf8');
content += '\nexport * from "./mocks/mock-decomposer";\n';
fs.writeFileSync(file, content, 'utf8');
