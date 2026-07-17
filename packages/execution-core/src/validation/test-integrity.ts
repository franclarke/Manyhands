export interface TestIntegrityFinding {
  code: "test_removed" | "test_script_weakened";
  path: string;
  message: string;
}

export function detectTestIntegrityFindings(input: {
  baselineTestFiles: string[];
  candidateTestFiles: string[];
  baselineScripts: Record<string, string>;
  candidateScripts: Record<string, string>;
}): TestIntegrityFinding[] {
  const candidateFiles = new Set(input.candidateTestFiles);
  const findings: TestIntegrityFinding[] = input.baselineTestFiles
    .filter((path) => !candidateFiles.has(path))
    .sort()
    .map((path) => ({ code: "test_removed", path, message: `Baseline test ${path} is missing from the candidate.` }));
  for (const [name, baseline] of Object.entries(input.baselineScripts).sort(([left], [right]) => left.localeCompare(right))) {
    const candidate = input.candidateScripts[name];
    if (candidate === undefined || isWeaker(candidate, baseline)) {
      findings.push({ code: "test_script_weakened", path: `package.json#scripts.${name}`, message: `Candidate script ${name} is missing or weaker than the baseline.` });
    }
  }
  return findings;
}

function isWeaker(candidate: string, baseline: string): boolean {
  if (candidate.trim() === baseline.trim()) return false;
  return /--passWithNoTests|--allowNoTests|\|\|\s*(?:true|exit\s+0)/u.test(candidate);
}
