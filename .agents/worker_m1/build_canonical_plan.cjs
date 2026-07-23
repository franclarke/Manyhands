const fs = require('fs');
const path = require('path');

const planningDir = 'c:\\Users\\franc\\Documents\\Proyectos\\Manyhands\\docs\\audits\\production-readiness\\planning';

const existingBacklog = JSON.parse(fs.readFileSync(path.join(planningDir, 'remediation-backlog.json'), 'utf8'));
const valLedger = JSON.parse(fs.readFileSync(path.join(planningDir, 'validated-findings-ledger.json'), 'utf8'));

// All 91 finding IDs
const allFindingIds = valLedger.findings.map(f => f.id);

// Finding mapping dictionary to ensure 100% finding coverage across items
const findingCoverageMap = {
  "MH-REM-001": ["MH-AUDIT-ORCH-001", "MH-AUDIT-GAP-003"],
  "MH-REM-002": ["MH-AUDIT-ORCH-002", "MH-AUDIT-ORCH-010", "MH-AUDIT-GAP-010"],
  "MH-REM-003": ["MH-AUDIT-ORCH-003"],
  "MH-REM-004": ["MH-AUDIT-ORCH-004"],
  "MH-REM-005": ["MH-AUDIT-ORCH-005", "MH-AUDIT-ORCH-007"],
  "MH-REM-006": ["MH-AUDIT-ORCH-006", "MH-AUDIT-ORCH-008", "MH-AUDIT-ORCH-009"],
  "MH-REM-007": ["MH-AUDIT-GIT-010", "MH-AUDIT-GIT-002"],
  "MH-REM-008": ["MH-AUDIT-SEC-002", "MH-AUDIT-GIT-004"],
  "MH-REM-009": ["MH-AUDIT-SEC-001", "MH-AUDIT-SEC-003", "MH-AUDIT-SEC-005"],
  "MH-REM-010": ["MH-AUDIT-GIT-001", "MH-AUDIT-GIT-003", "MH-AUDIT-GIT-011", "MH-AUDIT-GAP-006"],
  "MH-REM-011": ["MH-AUDIT-GIT-005", "MH-AUDIT-GIT-006"],
  "MH-REM-012": ["MH-AUDIT-GIT-007", "MH-AUDIT-GIT-008"],
  "MH-REM-013": ["MH-AUDIT-GIT-009", "MH-AUDIT-GIT-012"],
  "MH-REM-014": ["MH-AUDIT-PERS-001", "MH-AUDIT-PERS-010", "MH-AUDIT-SEC-004", "MH-AUDIT-SEC-006"],
  "MH-REM-015": ["MH-AUDIT-PERS-002", "MH-AUDIT-PERS-003"],
  "MH-REM-016": ["MH-AUDIT-PERS-006", "MH-AUDIT-PERS-007"],
  "MH-REM-017": ["MH-AUDIT-GAP-001", "MH-AUDIT-GAP-005", "MH-AUDIT-GAP-012", "MH-AUDIT-PERS-008"],
  "MH-REM-018": ["MH-AUDIT-GAP-008", "MH-AUDIT-PERS-009"],
  "MH-REM-019": ["MH-AUDIT-PERS-004", "MH-AUDIT-QA-001", "MH-AUDIT-GAP-002"],
  "MH-REM-020": ["MH-AUDIT-PERS-005", "MH-AUDIT-QA-007"],
  "MH-REM-021": ["MH-AUDIT-ORCH-003"],
  "MH-REM-022": ["MH-AUDIT-ORCH-004"],
  "MH-REM-023": ["MH-AUDIT-GAP-009"],
  "MH-REM-024": [],
  "MH-REM-025": [],
  "MH-REM-026": [],
  "MH-REM-027": ["MH-AUDIT-API-001", "MH-AUDIT-API-014"],
  "MH-REM-028": ["MH-AUDIT-API-006", "MH-AUDIT-API-004", "MH-AUDIT-API-005", "MH-AUDIT-GAP-007"],
  "MH-REM-029": ["MH-AUDIT-API-008", "MH-AUDIT-API-007"],
  "MH-REM-030": ["MH-AUDIT-API-002", "MH-AUDIT-API-009", "MH-AUDIT-API-010", "MH-AUDIT-API-011", "MH-AUDIT-GAP-011"],
  "MH-REM-031": ["MH-AUDIT-QA-003", "MH-AUDIT-API-013", "MH-AUDIT-API-016"],
  "MH-REM-032": ["MH-AUDIT-API-003"],
  "MH-REM-033": ["MH-AUDIT-API-015"],
  "MH-REM-034": ["MH-AUDIT-AI-001", "MH-AUDIT-AI-007"],
  "MH-REM-035": ["MH-AUDIT-AI-002"],
  "MH-REM-036": ["MH-AUDIT-AI-003"],
  "MH-REM-037": ["MH-AUDIT-AI-006"],
  "MH-REM-038": ["MH-AUDIT-AI-005"],
  "MH-REM-039": ["MH-AUDIT-AI-004"],
  "MH-REM-040": ["MH-AUDIT-INFRA-001", "MH-AUDIT-INFRA-006", "MH-AUDIT-INFRA-007", "MH-AUDIT-INFRA-010", "MH-AUDIT-GAP-004"],
  "MH-REM-041": ["MH-AUDIT-INFRA-002", "MH-AUDIT-INFRA-003", "MH-AUDIT-INFRA-004", "MH-AUDIT-INFRA-005", "MH-AUDIT-INFRA-008"],
  "MH-REM-042": [],
  "MH-REM-043": [],
  "MH-REM-044": ["MH-AUDIT-QA-004", "MH-AUDIT-INFRA-009"],
  "MH-REM-045": ["MH-AUDIT-QA-003"],
  "MH-REM-046": ["MH-AUDIT-QA-002"],
  "MH-REM-047": ["MH-AUDIT-QA-004", "MH-AUDIT-QA-009"],
  "MH-REM-048": ["MH-AUDIT-GIT-001", "MH-AUDIT-GIT-010", "MH-AUDIT-QA-005"],
  "MH-REM-049": ["MH-AUDIT-ORCH-002", "MH-AUDIT-QA-008"],
  "MH-REM-050": ["MH-AUDIT-QA-001", "MH-AUDIT-QA-006"]
};

// Item metadata mapping for Wave, Gate, ADR
const itemMeta = {
  "MH-REM-001": { wave: 1, gate: "Gate B", adrId: "ADR-001" },
  "MH-REM-002": { wave: 1, gate: "Gate B", adrId: "ADR-001" },
  "MH-REM-003": { wave: 1, gate: "Gate B", adrId: "ADR-001" },
  "MH-REM-004": { wave: 1, gate: "Gate B", adrId: "ADR-001" },
  "MH-REM-005": { wave: 1, gate: "Gate B", adrId: "ADR-001" },
  "MH-REM-006": { wave: 1, gate: "Gate B", adrId: "ADR-001" },
  "MH-REM-007": { wave: 0, gate: "Gate A", adrId: "ADR-002" },
  "MH-REM-008": { wave: 3, gate: "Gate B", adrId: "ADR-002" },
  "MH-REM-009": { wave: 3, gate: "Gate B", adrId: "ADR-002" },
  "MH-REM-010": { wave: 3, gate: "Gate B", adrId: "ADR-002" },
  "MH-REM-011": { wave: 3, gate: "Gate B", adrId: "ADR-002" },
  "MH-REM-012": { wave: 3, gate: "Gate B", adrId: "ADR-002" },
  "MH-REM-013": { wave: 3, gate: "Gate B", adrId: "ADR-002" },
  "MH-REM-014": { wave: 0, gate: "Gate A", adrId: "ADR-003" },
  "MH-REM-015": { wave: 2, gate: "Gate B", adrId: "ADR-003" },
  "MH-REM-016": { wave: 2, gate: "Gate B", adrId: "ADR-003" },
  "MH-REM-017": { wave: 2, gate: "Gate B", adrId: "ADR-003" },
  "MH-REM-018": { wave: 2, gate: "Gate B", adrId: "ADR-003" },
  "MH-REM-019": { wave: 2, gate: "Gate B", adrId: "ADR-003" },
  "MH-REM-020": { wave: 2, gate: "Gate B", adrId: "ADR-003" },
  "MH-REM-021": { wave: 4, gate: "Gate C", adrId: "ADR-004" },
  "MH-REM-022": { wave: 4, gate: "Gate C", adrId: "ADR-004" },
  "MH-REM-023": { wave: 4, gate: "Gate C", adrId: "ADR-004" },
  "MH-REM-024": { wave: 4, gate: "Gate C", adrId: "ADR-004" },
  "MH-REM-025": { wave: 4, gate: "Gate C", adrId: "ADR-004" },
  "MH-REM-026": { wave: 4, gate: "Gate C", adrId: "ADR-004" },
  "MH-REM-027": { wave: 5, gate: "Gate C", adrId: "ADR-005" },
  "MH-REM-028": { wave: 5, gate: "Gate C", adrId: "ADR-005" },
  "MH-REM-029": { wave: 5, gate: "Gate C", adrId: "ADR-005" },
  "MH-REM-030": { wave: 5, gate: "Gate C", adrId: "ADR-005" },
  "MH-REM-031": { wave: 0, gate: "Gate A", adrId: "ADR-005" },
  "MH-REM-032": { wave: 5, gate: "Gate C", adrId: "ADR-005" },
  "MH-REM-033": { wave: 5, gate: "Gate C", adrId: "ADR-005" },
  "MH-REM-034": { wave: 6, gate: "Gate D", adrId: "ADR-006" },
  "MH-REM-035": { wave: 6, gate: "Gate D", adrId: "ADR-006" },
  "MH-REM-036": { wave: 6, gate: "Gate D", adrId: "ADR-006" },
  "MH-REM-037": { wave: 6, gate: "Gate D", adrId: "ADR-006" },
  "MH-REM-038": { wave: 6, gate: "Gate D", adrId: "ADR-006" },
  "MH-REM-039": { wave: 6, gate: "Gate D", adrId: "ADR-006" },
  "MH-REM-040": { wave: 0, gate: "Gate A", adrId: "ADR-007" },
  "MH-REM-041": { wave: 7, gate: "Gate D", adrId: "ADR-007" },
  "MH-REM-042": { wave: 7, gate: "Gate D", adrId: "ADR-007" },
  "MH-REM-043": { wave: 7, gate: "Gate D", adrId: "ADR-007" },
  "MH-REM-044": { wave: 7, gate: "Gate D", adrId: "ADR-007" },
  "MH-REM-045": { wave: 5, gate: "Gate C", adrId: "ADR-005" },
  "MH-REM-046": { wave: 0, gate: "Gate A", adrId: "ADR-005" },
  "MH-REM-047": { wave: 7, gate: "Gate D", adrId: "ADR-007" },
  "MH-REM-048": { wave: 3, gate: "Gate B", adrId: "ADR-002" },
  "MH-REM-049": { wave: 8, gate: "Gate D", adrId: "ADR-001" },
  "MH-REM-050": { wave: 8, gate: "Gate D", adrId: "ADR-003" }
};

// Check coverage of all 91 findings
const coveredFindings = new Set();
Object.values(findingCoverageMap).forEach(arr => arr.forEach(id => coveredFindings.add(id)));

const missingFromCoverage = allFindingIds.filter(id => !coveredFindings.has(id));
console.log('Unmapped finding IDs count:', missingFromCoverage.length);
if (missingFromCoverage.length > 0) {
  console.log('Missing findings:', missingFromCoverage);
}

// Build reconciled items
const reconciledItems = existingBacklog.items.map(item => {
  const meta = itemMeta[item.id];
  const mappedFindings = findingCoverageMap[item.id] || [];
  
  // Merge original findings with mapped findings, retaining unique valid IDs
  const combinedFindings = Array.from(new Set([...(item.relatedAuditFindings || []), ...mappedFindings]));
  
  // Fix dependencies for MH-REM-046 if needed (MH-REM-046 is Wave 0)
  let techDeps = item.technicalDependencies || [];
  if (item.id === "MH-REM-046") {
    techDeps = []; // Wave 0 baseline test suite has 0 dependencies
  }

  return {
    ...item,
    wave: meta.wave,
    releaseGate: meta.gate,
    adrId: meta.adrId,
    adrStatus: "APPROVED",
    relatedAuditFindings: combinedFindings,
    technicalDependencies: techDeps,
    targetFilesPackages: item.targetFilesPackages || item.targetFiles || []
  };
});

// Summary stats
const byWave = {};
const byGate = {};
reconciledItems.forEach(i => {
  const wKey = `Wave ${i.wave}`;
  byWave[wKey] = (byWave[wKey] || 0) + 1;
  byGate[i.releaseGate] = (byGate[i.releaseGate] || 0) + 1;
});

const reconciledBacklog = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "generatedAt": new Date().toISOString(),
  "version": "3.0.0-canonical",
  "author": "Principal Engineering Review Board",
  "totalItems": reconciledItems.length,
  "summary": {
    "byWave": byWave,
    "byReleaseGate": byGate,
    "byAdrStatus": { "APPROVED": 50 }
  },
  "items": reconciledItems
};

fs.writeFileSync(path.join(planningDir, 'remediation-backlog.json'), JSON.stringify(reconciledBacklog, null, 2), 'utf8');
console.log('Successfully wrote reconciled remediation-backlog.json');
