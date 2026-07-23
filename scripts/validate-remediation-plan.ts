import fs from 'node:fs';
import path from 'node:path';

interface BacklogItem {
  id: string;
  title: string;
  epic: string;
  classification: string;
  targetReadinessLevel: string;
  priority: string;
  wave: number;
  releaseGate: string;
  adrId?: string;
  adrStatus?: string;
  relatedAuditFindings?: string[];
  technicalDependencies?: string[];
  targetFilesPackages?: string[];
  estimateComplexity?: string;
  detailedAcceptanceCriteria?: string[];
}

interface RemediationBacklog {
  $schema?: string;
  generatedAt?: string;
  version?: string;
  author?: string;
  totalItems: number;
  summary?: Record<string, any>;
  items: BacklogItem[];
}

interface Finding {
  id: string;
  title: string;
  category?: string;
  status?: string;
  classification?: string;
}

interface ValidatedFindingsLedger {
  findings: Finding[];
}

const planningDir = path.resolve(process.cwd(), 'docs/audits/production-readiness/planning');
const backlogPath = path.join(planningDir, 'remediation-backlog.json');
const ledgerPath = path.join(planningDir, 'validated-findings-ledger.json');

function runValidation() {
  console.log('============================================================');
  console.log('       MANYHANDS FASE A PLANNING CONSISTENCY GATE          ');
  console.log('============================================================\n');

  if (!fs.existsSync(backlogPath)) {
    console.error(`ERROR: Backlog file not found at ${backlogPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(ledgerPath)) {
    console.error(`ERROR: Ledger file not found at ${ledgerPath}`);
    process.exit(1);
  }

  const backlog: RemediationBacklog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));
  const ledger: ValidatedFindingsLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

  const items = backlog.items || [];
  const findings = ledger.findings || [];

  let allPassed = true;
  const failureReasons: string[] = [];

  // -------------------------------------------------------------
  // Check 1: Unique IDs
  // -------------------------------------------------------------
  let check1Passed = true;
  const itemIds = new Set<string>();
  const duplicateIds: string[] = [];
  const invalidIdFormats: string[] = [];

  for (const item of items) {
    if (!item.id || !/^MH-REM-\d{3}$/.test(item.id)) {
      invalidIdFormats.push(item.id || 'EMPTY');
    }
    if (itemIds.has(item.id)) {
      duplicateIds.push(item.id);
    }
    itemIds.add(item.id);
  }

  if (duplicateIds.length > 0 || invalidIdFormats.length > 0 || items.length === 0) {
    check1Passed = false;
    if (duplicateIds.length > 0) failureReasons.push(`Duplicate IDs found: ${duplicateIds.join(', ')}`);
    if (invalidIdFormats.length > 0) failureReasons.push(`Invalid ID formats found: ${invalidIdFormats.join(', ')}`);
    if (items.length === 0) failureReasons.push('Backlog contains 0 items');
  }

  console.log(`[CHECK 1/7] Unique IDs: ${check1Passed ? 'PASS' : 'FAIL'}`);
  console.log(`            - Total Items Cataloged: ${items.length}`);
  console.log(`            - Unique Item IDs: ${itemIds.size}`);

  // -------------------------------------------------------------
  // Check 2: References Validation
  // -------------------------------------------------------------
  let check2Passed = true;
  const validatedFindingIds = new Set(findings.map(f => f.id));
  const missingTechDeps: string[] = [];
  const missingFindingRefs: string[] = [];

  for (const item of items) {
    const deps = item.technicalDependencies || [];
    for (const depId of deps) {
      if (!itemIds.has(depId)) {
        missingTechDeps.push(`${item.id} -> ${depId}`);
      }
    }

    const relFindings = item.relatedAuditFindings || [];
    for (const fId of relFindings) {
      if (!validatedFindingIds.has(fId)) {
        missingFindingRefs.push(`${item.id} -> ${fId}`);
      }
    }
  }

  if (missingTechDeps.length > 0 || missingFindingRefs.length > 0) {
    check2Passed = false;
    if (missingTechDeps.length > 0) failureReasons.push(`Missing technical dependencies: ${missingTechDeps.join(', ')}`);
    if (missingFindingRefs.length > 0) failureReasons.push(`Missing finding references: ${missingFindingRefs.join(', ')}`);
  }

  console.log(`[CHECK 2/7] References: ${check2Passed ? 'PASS' : 'FAIL'}`);
  console.log(`            - Tech Dependencies Verified: ${check2Passed}`);
  console.log(`            - Related Audit Findings Verified: ${check2Passed}`);

  // -------------------------------------------------------------
  // Check 3: Dependency DAG & Wave Ordering
  // -------------------------------------------------------------
  let check3Passed = true;
  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};
  const waveMap: Record<string, number> = {};

  for (const item of items) {
    inDegree[item.id] = 0;
    adjList[item.id] = [];
    waveMap[item.id] = item.wave;
  }

  const waveInconsistencies: string[] = [];

  for (const item of items) {
    const deps = item.technicalDependencies || [];
    for (const depId of deps) {
      if (adjList[depId]) {
        adjList[depId].push(item.id);
        inDegree[item.id] = (inDegree[item.id] || 0) + 1;
      }
      // Wave ordering condition: item.wave >= dep.wave
      if (waveMap[depId] !== undefined && item.wave < waveMap[depId]) {
        waveInconsistencies.push(`${item.id} (Wave ${item.wave}) depends on ${depId} (Wave ${waveMap[depId]})`);
      }
    }
  }

  // Kahn's Algorithm
  const queue: string[] = [];
  for (const id of Object.keys(inDegree)) {
    if (inDegree[id] === 0) {
      queue.push(id);
    }
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    processedCount++;

    for (const neighbor of (adjList[curr] || [])) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  const hasCycle = processedCount !== items.length;
  if (hasCycle || waveInconsistencies.length > 0) {
    check3Passed = false;
    if (hasCycle) failureReasons.push(`Dependency graph contains cycles (${processedCount}/${items.length} nodes processed)`);
    if (waveInconsistencies.length > 0) failureReasons.push(`Wave ordering violations: ${waveInconsistencies.join(', ')}`);
  }

  console.log(`[CHECK 3/7] Dependency DAG: ${check3Passed ? 'PASS' : 'FAIL'}`);
  console.log(`            - Topological Sort (Kahn's): ${hasCycle ? 'CYCLES DETECTED' : 'ACYCLIC (0 cycles)'}`);
  console.log(`            - Wave Ordering Consistency: ${waveInconsistencies.length === 0 ? 'PASS' : 'FAIL'}`);

  // -------------------------------------------------------------
  // Check 4: Findings Coverage Mapping
  // -------------------------------------------------------------
  let check4Passed = true;
  const coveredFindings = new Set<string>();

  for (const item of items) {
    const relFindings = item.relatedAuditFindings || [];
    for (const fId of relFindings) {
      coveredFindings.add(fId);
    }
  }

  const unmappedFindings = Array.from(validatedFindingIds).filter(fId => !coveredFindings.has(fId));
  if (unmappedFindings.length > 0) {
    check4Passed = false;
    failureReasons.push(`Unmapped audit findings (${unmappedFindings.length}): ${unmappedFindings.join(', ')}`);
  }

  console.log(`[CHECK 4/7] Findings Mapping: ${check4Passed ? 'PASS' : 'FAIL'}`);
  console.log(`            - Total Validated Findings: ${findings.length}`);
  console.log(`            - Mapped Audit Findings: ${coveredFindings.size}`);
  console.log(`            - Coverage Percentage: ${((coveredFindings.size / findings.length) * 100).toFixed(1)}%`);

  // -------------------------------------------------------------
  // Check 5: Wave Mapping (0-8)
  // -------------------------------------------------------------
  let check5Passed = true;
  const invalidWaveItems: string[] = [];

  for (const item of items) {
    if (typeof item.wave !== 'number' || !Number.isInteger(item.wave) || item.wave < 0 || item.wave > 8) {
      invalidWaveItems.push(`${item.id} (wave: ${item.wave})`);
    }
  }

  if (invalidWaveItems.length > 0) {
    check5Passed = false;
    failureReasons.push(`Items with invalid wave assignment: ${invalidWaveItems.join(', ')}`);
  }

  console.log(`[CHECK 5/7] Wave Mapping: ${check5Passed ? 'PASS' : 'FAIL'}`);
  console.log(`            - Valid Wave Range (0-8): ${check5Passed ? 'PASS' : 'FAIL'}`);

  // -------------------------------------------------------------
  // Check 6: Release Gate Mapping
  // -------------------------------------------------------------
  let check6Passed = true;
  const invalidGateItems: string[] = [];

  for (const item of items) {
    let expectedGate = '';
    if (item.wave === 0) expectedGate = 'Gate A';
    else if (item.wave >= 1 && item.wave <= 3) expectedGate = 'Gate B';
    else if (item.wave >= 4 && item.wave <= 5) expectedGate = 'Gate C';
    else if (item.wave >= 6 && item.wave <= 8) expectedGate = 'Gate D';

    if (item.releaseGate !== expectedGate) {
      invalidGateItems.push(`${item.id} (Wave ${item.wave} has Gate '${item.releaseGate}', expected '${expectedGate}')`);
    }
  }

  if (invalidGateItems.length > 0) {
    check6Passed = false;
    failureReasons.push(`Release Gate mismatch items: ${invalidGateItems.join(', ')}`);
  }

  console.log(`[CHECK 6/7] Gate Mapping: ${check6Passed ? 'PASS' : 'FAIL'}`);
  console.log(`            - Gate Threshold Rules (Gate A-D): ${check6Passed ? 'PASS' : 'FAIL'}`);

  // -------------------------------------------------------------
  // Check 7: ADR Status Validation
  // -------------------------------------------------------------
  let check7Passed = true;
  const validAdrStatuses = new Set(['APPROVED', 'PROPOSED', 'REJECTED', 'DEFERRED', 'SUPERSEDED']);
  const invalidAdrItems: string[] = [];

  for (const item of items) {
    if (!item.adrId || !/^ADR-\d{3}$/.test(item.adrId)) {
      invalidAdrItems.push(`${item.id} invalid adrId '${item.adrId}'`);
    }
    if (!item.adrStatus || !validAdrStatuses.has(item.adrStatus)) {
      invalidAdrItems.push(`${item.id} invalid adrStatus '${item.adrStatus}'`);
    }
  }

  if (invalidAdrItems.length > 0) {
    check7Passed = false;
    failureReasons.push(`ADR status / ID violations: ${invalidAdrItems.join(', ')}`);
  }

  console.log(`[CHECK 7/7] ADR Status: ${check7Passed ? 'PASS' : 'FAIL'}`);
  console.log(`            - Valid Upper-case ADR Enums: ${check7Passed ? 'PASS' : 'FAIL'}`);

  // -------------------------------------------------------------
  // Final Conclusion & Exit Code
  // -------------------------------------------------------------
  allPassed = check1Passed && check2Passed && check3Passed && check4Passed && check5Passed && check6Passed && check7Passed;

  console.log('\n------------------------------------------------------------');
  if (allPassed) {
    console.log('ALL 7 PLANNING CONSISTENCY CHECKS PASSED SUCCESSFULLY.');
    console.log('PLANNING CONSISTENCY GATE: PASS');
    console.log('------------------------------------------------------------\n');
    process.exit(0);
  } else {
    console.error('PLANNING CONSISTENCY GATE: FAIL');
    console.error('\nFailure Diagnostics:');
    failureReasons.forEach(reason => console.error(` - ${reason}`));
    console.error('------------------------------------------------------------\n');
    process.exit(1);
  }
}

runValidation();
