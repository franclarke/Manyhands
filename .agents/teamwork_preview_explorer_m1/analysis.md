# Planning Artifact Audit & Reconciliation Specification

**Author**: `teamwork_preview_explorer_m1` (Planning Reconciliation Explorer)  
**Date**: 2026-07-22  
**Target Repository**: `c:\Users\franc\Documents\Proyectos\Manyhands`  
**Status**: Completed Investigation & Design Specification  

---

## 1. Executive Summary

This report delivers a thorough audit of all planning artifacts located in `docs/audits/production-readiness/planning/` and `docs/audits/production-readiness/`. The investigation identified a **critical systemic discrepancy**: the planning artifacts are split across two conflicting ID numbering systems:

1. **System E (Epic-Ordered System)**: Used in `remediation-backlog.json` and `05-master-backlog.md`. Items are numbered sequentially by Epic (`MH-REM-001` .. `MH-REM-050`).
2. **System W (Wave-Ordered System)**: Used in `06-dependency-graph.md`, `07-implementation-waves.md`, `08-agent-execution-plan.md`, `09-test-strategy.md`, `10-release-gates.md`, `11-risk-register.md`, `12-open-questions.md`. Items are numbered sequentially by Implementation Wave (`MH-REM-001` .. `MH-REM-050`).

Because both systems reuse the identical ID format (`MH-REM-001` .. `MH-REM-050`) for different tasks, cross-document references are broken, wave assignments in `remediation-backlog.json` are unpopulated, and 62 validated findings lack explicit backlog item mapping.

To prepare for Fase A reconciliation, this document establishes:
- Complete analysis of all ID collisions, wave discrepancies, finding gaps, ADR statuses, DAG dependencies, and release gate mappings.
- Technical specification for canonicalized `remediation-backlog.json`.
- Migration ledger specification for `remediation-id-migration.json`.
- Comprehensive requirement specifications for the automated validation script `scripts/validate-remediation-plan.ts`.

---

## 2. Detailed Audit Findings & Discrepancies

### A. ID Collisions (`MH-REM-*`)
The audit revealed 50 direct pairwise collisions between System E (`remediation-backlog.json`) and System W (`07-implementation-waves.md` / `06-dependency-graph.md`).

| ID | System E Title (`remediation-backlog.json`) | System W Title (`07-implementation-waves.md`) | Discrepancy / Impact |
|:---:|---|---|---|
| `MH-REM-001` | DAG Cycle Validation for ArtifactRequirements | GroundingAgent Dirty Workspace Pre-check | Severe Collision. System E = Epic 1, System W = Wave 0. |
| `MH-REM-002` | Wave Selector ConflictConstraints Integration | Durable Lock Ownership Verification | Severe Collision. System E = Epic 1, System W = Wave 0. |
| `MH-REM-003` | V2ExecutionDriver Promise Mutation Race Fix | Refactor Fragile UI String Tests to DOM | Severe Collision. System E = Epic 1, System W = Wave 0. |
| `MH-REM-004` | Scope Isolation Critic Calibration | Standardize Monorepo Workspace Specifiers | Severe Collision. System E = Epic 1, System W = Wave 0. |
| `MH-REM-005` | Canonical Typed Relations & SeamBinding Schema | Validation Runner Child Process Leak Fix | Severe Collision. System E = Epic 1, System W = Wave 0. |
| `MH-REM-006` | Compare-and-Swap (CAS) GraphRevision Reducer | Task Graph Artifact Cycle Detection | Shifted ID (`MH-REM-001` in System E). |
| `MH-REM-007` | Dirty Workspace Check in GroundingAgent | SeamBinding Schema Versioning | Shifted ID (`MH-REM-001` in System W). |
| `MH-REM-014` | Lock Ownership Fencing in acquireDurableLock | True File Append Stream Event Logger | Shifted ID (`MH-REM-002` in System W). |
| `MH-REM-040` | Standardize Monorepo Workspace Specifiers | System Prompt Decoy Rule Boundary | Shifted ID (`MH-REM-004` in System W). |
| `MH-REM-XXX` | Placeholder ID in `08-agent-execution-plan.md:45` | N/A | Generic placeholder text in execution plan docs. |

### B. Wave Assignment Discrepancies (Wave 0 to Wave 8)
- `remediation-backlog.json` **currently lacks `wave` assignment fields** for all 50 items.
- Documents `07-implementation-waves.md` and `06-dependency-graph.md` define 9 sequential waves (Wave 0 to Wave 8).
- Mapping System W wave groupings back to canonical System E items yields:
  - **Wave 0 (Level A Baseline)**: `MH-REM-007`, `MH-REM-014`, `MH-REM-031`, `MH-REM-040`, `MH-REM-046`.
  - **Wave 1 (Epic 1 Task Graph)**: `MH-REM-001`, `MH-REM-002`, `MH-REM-003`, `MH-REM-004`, `MH-REM-005`, `MH-REM-006`.
  - **Wave 2 (Epic 3 Persistence Engine)**: `MH-REM-014` (cont.), `MH-REM-015`, `MH-REM-016`, `MH-REM-017`, `MH-REM-018`, `MH-REM-019`, `MH-REM-020`.
  - **Wave 3 (Epic 2 Worktree Security)**: `MH-REM-008`, `MH-REM-009`, `MH-REM-010`, `MH-REM-011`, `MH-REM-012`, `MH-REM-013`, `MH-REM-048`.
  - **Wave 4 (Epic 4 Execution Core)**: `MH-REM-021`, `MH-REM-022`, `MH-REM-023`, `MH-REM-024`, `MH-REM-025`, `MH-REM-026`.
  - **Wave 5 (Epic 5 API & Web UI)**: `MH-REM-027`, `MH-REM-028`, `MH-REM-029`, `MH-REM-030`, `MH-REM-032`, `MH-REM-033`, `MH-REM-045`.
  - **Wave 6 (Epic 6 AI Security)**: `MH-REM-034`, `MH-REM-035`, `MH-REM-036`, `MH-REM-037`, `MH-REM-038`, `MH-REM-039`.
  - **Wave 7 (Epic 7 Infrastructure & Build)**: `MH-REM-041`, `MH-REM-042`, `MH-REM-043`, `MH-REM-044`, `MH-REM-047`.
  - **Wave 8 (Level D Polish & E2E)**: `MH-REM-049`, `MH-REM-050`.

### C. Finding Mapping Coverage & Duplicate Tasks
- `validated-findings-ledger.json` contains **91 validated findings**.
- `remediation-backlog.json` explicitly references only **29 distinct finding IDs** across its items.
- **62 findings** are unmapped in `remediation-backlog.json` items (though they are sub-issues of the 8 Epics detailed in `01-validated-findings.md`).
- **Duplicate/Overlapping Tasks**:
  - `MH-REM-031` (Tailwind spacing) vs `MH-REM-045` (RTL DOM component tests) both address UI string test fragility.
  - `MH-REM-044` vs `MH-REM-047` both address Vitest test script standardization.

### D. ADR Statuses
- `03-architecture-decisions-required.md` defines 7 ADRs (`ADR-001` through `ADR-007`).
- Statuses in `03-architecture-decisions-required.md` are formatted as "Approved" (title-case).
- The canonicalized schema requires upper-case enum values strictly matching: `APPROVED`, `PROPOSED`, `REJECTED`, `DEFERRED`, `SUPERSEDED`.
- Backlog items in `remediation-backlog.json` do not currently populate `adrId` or `adrStatus`.

### E. Dependency DAG Structure
- Dependencies in `06-dependency-graph.md` are written using System W IDs.
- Dependencies in `remediation-backlog.json` are written using System E IDs.
- Both graphs are verified to be **acyclic** (0 cycles).
- Topological order is valid across waves when converted to canonical System E IDs.

### F. Release Gate Mappings
- **Gate A (Level A Exit)**: Maps to Wave 0 items (`MH-REM-007`, `MH-REM-014`, `MH-REM-031`, `MH-REM-040`, `MH-REM-046`).
- **Gate B (Level B Exit)**: Maps to Wave 1, Wave 2, Wave 3 items (`MH-REM-001` .. `MH-REM-020`, `MH-REM-048`).
- **Gate C (Level C Exit)**: Maps to Wave 4, Wave 5 items (`MH-REM-021` .. `MH-REM-033`, `MH-REM-045`).
- **Gate D (Level D Exit - Final Product)**: Maps to Wave 6, Wave 7, Wave 8 items (`MH-REM-034` .. `MH-REM-050`).

---

## 3. Precise Technical Specifications for Reconciliation

### Deliverable 1: Canonical `remediation-backlog.json` Specification
The canonical backlog JSON file must standardize on System E IDs (`MH-REM-001` .. `MH-REM-050`) and populate wave, release gate, ADR, and finding attributes for every item.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "generatedAt": "2026-07-22T17:00:00Z",
  "version": "3.0.0-canonical",
  "author": "Principal Engineering Review Board",
  "totalItems": 50,
  "summary": {
    "byWave": { "Wave 0": 5, "Wave 1": 6, "Wave 2": 7, "Wave 3": 7, "Wave 4": 6, "Wave 5": 7, "Wave 6": 6, "Wave 7": 5, "Wave 8": 1 },
    "byReleaseGate": { "Gate A": 5, "Gate B": 20, "Gate C": 13, "Gate D": 12 },
    "byAdrStatus": { "APPROVED": 50 }
  },
  "items": [
    {
      "id": "MH-REM-001",
      "title": "DAG Cycle Validation for ArtifactRequirements",
      "epic": "Epic 1: Task Graph & Canonical Relations Contract Engine",
      "classification": "BLOCKER_LOCAL_PRODUCT",
      "targetReadinessLevel": "Level B",
      "priority": "P1",
      "wave": 1,
      "releaseGate": "Gate B",
      "adrId": "ADR-001",
      "adrStatus": "APPROVED",
      "relatedAuditFindings": ["MH-AUDIT-ORCH-001"],
      "technicalDependencies": [],
      "targetFilesPackages": ["packages/task-graph/src/validate-v2.ts", "packages/task-graph/src/types-v2.ts"],
      "estimateComplexity": "5 Story Points (High)",
      "detailedAcceptanceCriteria": [
        "Construct combined parentage and ArtifactRequirement edge adjacency matrix in validateGraphRevision.",
        "Execute Kahn's topological sort algorithm over the graph matrix.",
        "Return valid: false with CyclicDependencyError if unvisited nodes remain.",
        "Pass tests/task-graph-artifact-cycles.test.ts verifying circular artifact dependencies are rejected."
      ]
    }
  ]
}
```

### Deliverable 2: Migration Ledger `remediation-id-migration.json` Specification
The migration ledger creates an unambiguous bidirectional mapping between legacy Wave-ordered IDs / markdown aliases and the single canonical Epic-ordered IDs.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "version": "1.0.0",
  "description": "Migration ledger mapping legacy System W (Wave-Ordered) IDs to Canonical System E (Epic-Ordered) IDs",
  "mappings": [
    {
      "canonicalId": "MH-REM-007",
      "canonicalTitle": "Dirty Workspace Check in GroundingAgent",
      "legacyWaveId": "MH-REM-001",
      "legacyWaveTitle": "GroundingAgent Dirty Workspace Pre-check",
      "wave": 0,
      "releaseGate": "Gate A",
      "primaryFinding": "MH-AUDIT-GIT-010",
      "documentReferences": [
        "06-dependency-graph.md:REM001",
        "07-implementation-waves.md:MH-REM-001",
        "10-release-gates.md:MH-REM-001"
      ]
    },
    {
      "canonicalId": "MH-REM-014",
      "canonicalTitle": "Lock Ownership Fencing in acquireDurableLock",
      "legacyWaveId": "MH-REM-002",
      "legacyWaveTitle": "Durable Lock Ownership Verification",
      "wave": 0,
      "releaseGate": "Gate A",
      "primaryFinding": "MH-AUDIT-PERS-001",
      "documentReferences": [
        "06-dependency-graph.md:REM002",
        "07-implementation-waves.md:MH-REM-002",
        "10-release-gates.md:MH-REM-002"
      ]
    }
  ]
}
```

### Deliverable 3: Validation Script `scripts/validate-remediation-plan.ts` Requirements
The validation script must enforce strict architectural consistency across all planning artifacts.

**Validation Checks Required**:
1. **Unique IDs Check**:
   - Asserts all items in `remediation-backlog.json` have unique IDs strictly matching `MH-REM-001` .. `MH-REM-050`.
2. **References Check**:
   - Asserts every item in `technicalDependencies` exists in `remediation-backlog.json`.
   - Asserts every ID in `relatedAuditFindings` exists in `validated-findings-ledger.json`.
3. **Dependency DAG Check**:
   - Constructs directed graph from `technicalDependencies`.
   - Executes Kahn's algorithm; asserts 0 cycles exist.
   - Asserts topological ordering condition: $Wave(Item) \ge Wave(Dependency)$ for all dependencies.
4. **Findings Mapping Check**:
   - Asserts every validated finding in `validated-findings-ledger.json` (all 91 IDs) is mapped to at least one remediation item or epic.
5. **Wave Mapping Check**:
   - Asserts every item has an integer `wave` in range `0` to `8`.
6. **Release Gate Check**:
   - Asserts `releaseGate` is strictly one of `"Gate A"`, `"Gate B"`, `"Gate C"`, `"Gate D"`.
   - Asserts Gate A items belong to Wave 0, Gate B items to Waves 1-3, Gate C items to Waves 4-5, and Gate D items to Waves 6-8.
7. **ADR Status Check**:
   - Asserts `adrStatus` is strictly one of `"APPROVED"`, `"PROPOSED"`, `"REJECTED"`, `"DEFERRED"`, `"SUPERSEDED"`.
8. **Console Output & Exit Code**:
   - Must output `PLANNING CONSISTENCY GATE: PASS` on success and exit with code `0`.
   - If any check fails, must output detailed error diagnostic table and exit with code `1`.

---

## 4. Verification & Validation Protocol

To verify this specification independently:
1. Compare `remediation-backlog.json` against `05-master-backlog.md` and `07-implementation-waves.md`.
2. Verify that all 91 finding IDs in `validated-findings-ledger.json` are accounted for in the epic mapping.
3. Validate that Kahn's topological sort over canonical dependencies produces zero cycles.
