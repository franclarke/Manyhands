const fs = require('fs');
const path = require('path');
const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';

const files = fs.readdirSync(planningDir).filter(f => f.endsWith('.md'));
files.forEach(file => {
  const content = fs.readFileSync(path.join(planningDir, file), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('MH-REM-XXX')) {
      console.log(`${file}:${idx + 1}: ${line}`);
    }
  });
});
