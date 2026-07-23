const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';
const auditDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness';

const mdFiles = fs.readdirSync(planningDir).filter(f => f.endsWith('.md'));
const auditMdFiles = fs.readdirSync(auditDir).filter(f => f.endsWith('.md'));

console.log('=== READING MARKDOWN FILES ===');

const allRemMentions = {}; // remId -> { sourceFile: [lines/contexts] }

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relPath = path.relative('c:\\Users\\franc\\Documents\\Proyectos\\Manyhands', filePath);
  
  lines.forEach((line, idx) => {
    const remMatches = line.match(/MH-REM-[A-Z0-9_-]+/g);
    if (remMatches) {
      remMatches.forEach(id => {
        if (!allRemMentions[id]) allRemMentions[id] = [];
        allRemMentions[id].push({ file: relPath, lineNum: idx + 1, content: line.trim() });
      });
    }
  });
}

mdFiles.forEach(f => scanFile(path.join(planningDir, f)));
auditMdFiles.forEach(f => scanFile(path.join(auditDir, f)));
scanFile(path.join(planningDir, 'remediation-backlog.json'));
scanFile(path.join(planningDir, 'validated-findings-ledger.json'));
scanFile(path.join(auditDir, 'findings-ledger.json'));

console.log(`Total distinct MH-REM-* strings found: ${Object.keys(allRemMentions).length}`);

// Sort IDs and print list of IDs found
const sortedIds = Object.keys(allRemMentions).sort();
console.log('IDs found:', sortedIds.join(', '));

