# Final Thesis Experiment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace incomplete or non-diagnostic thesis experiment lines with one compact, reproducible final study whose frozen cells provide direct evidence for two bounded hypotheses.

**Architecture:** The study keeps the historical G5/G6/G7 and Warehouse artifacts immutable as adverse or exploratory records, but removes them from the central positive claim. A new final study uses the same ManyHands runtime, one small Node ESM target family, two pre-registered task shapes, an independent external oracle, and four adaptive-policy cells (two repetitions per shape). The first shape is a multi-layer domain → application → API change; the second is a cohesive one-module domain change. The study answers only bounded feasibility and task-shape selection claims; it does not claim superiority, scale, or statistical generalization.

**Tech Stack:** TypeScript/Node.js monorepo, pnpm, Next.js run API, Node ESM target fixtures, JSON journals, external Node oracle, LaTeX thesis.

---

### Task 1: Freeze the scientific scope before changing prose

**Files:**
- Create: `docs/tesis/evidence/final-experiment/preregistration.md`
- Create: `docs/tesis/evidence/final-experiment/protocol.md`
- Create: `docs/tesis/evidence/final-experiment/README.md`
- Modify: `docs/tesis/HANDOFF.md`
- Modify: `docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md`
- Modify: `docs/tesis/research-questions.md`

**Step 1: Write the failing scope audit**

Add a machine-readable claim table that marks the old broad H1/H2, G5, G6, G7 and Warehouse scale claims as `retired-from-central-argument`, and defines the only two final hypotheses:

- **H-F1 — bounded end-to-end feasibility:** both task shapes, in both adaptive repetitions, reach `completed`/`delivered`, publish a non-empty final SHA, and pass the independent oracle on that exact SHA.
- **H-F2 — task-shape granularity:** for the multi-layer task, both adaptive repetitions compile a root composite with at least three owned leaves covering domain/application/API; for the cohesive task, both repetitions compile a root leaf with depth zero.

Record that these are bounded engineering hypotheses, not a retroactive confirmation of the historical scale hypotheses.

**Step 2: Run the scope audit**

Run:

```powershell
rg -n "H1|H2|G5|G6|G7|Warehouse|1/8" docs/tesis/HANDOFF.md docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md docs/tesis/research-questions.md
```

Expected: every remaining central claim is either one of H-F1/H-F2 or explicitly labelled historical/adverse/retired.

**Step 3: Implement the scope documents**

Write the preregistration with the exact task prompts, acceptance criteria, model `gpt-5.4-mini`, effort `medium`, retry budget `0`, cell order, structural thresholds, oracle contract, stop rules, and adverse-result treatment. Do not use results or run SHAs in this document.

**Step 4: Verify the scope**

Run:

```powershell
git diff --check
```

Expected: exit code 0; no experiment result or candidate SHA appears in the preregistration.

**Step 5: Commit**

```powershell
git add docs/tesis/evidence/final-experiment docs/tesis/HANDOFF.md docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md docs/tesis/research-questions.md
git commit -m "docs: define final bounded thesis experiment"
```

### Task 2: Build and falsify the final target/oracle pair before freezing

**Files:**
- Create: `docs/tesis/evidence/final-experiment/target-template/`
- Create: `docs/tesis/evidence/final-experiment/oracle/evaluator.mjs`
- Create: `docs/tesis/evidence/final-experiment/oracle/README.md`
- Create: `docs/tesis/evidence/final-experiment/reference/`
- Create: `docs/tesis/evidence/final-experiment/preflight.mjs`

**Step 1: Add the target family**

Start from the successful SP2 template, but make the final target explicit and versioned. Keep the multi-layer task surface unchanged. Add only the baseline support needed for the cohesive task; do not add either task's requested behavior to the baseline.

**Step 2: Add independent checks**

The oracle must verify the exact external behavior for both task kinds without reading ManyHands journals or prompts. It must reject the untouched template, accept a disposable reference implementation, and check the final candidate SHA from a clean checkout.

**Step 3: Run the satisfiability preflight**

Run:

```powershell
node docs/tesis/evidence/final-experiment/preflight.mjs
```

Expected: `template: FAIL` and `reference: PASS`, with the same oracle and no network dependency.

**Step 4: Review the preflight against the observed case**

Verify that every criterion corresponds to a user-visible behavior and that no check can pass because of a hardcoded single fixture.

**Step 5: Commit**

```powershell
git add docs/tesis/evidence/final-experiment/target-template docs/tesis/evidence/final-experiment/oracle docs/tesis/evidence/final-experiment/reference docs/tesis/evidence/final-experiment/preflight.mjs
git commit -m "test: add final thesis target and external oracle"
```

### Task 3: Freeze runtime, target copies, prompts and cell ledger

**Files:**
- Create: `.scratch/final-thesis-experiment/freeze.json`
- Create: `.scratch/final-thesis-experiment/cells/*.json`
- Create: `.scratch/final-thesis-experiment/README.md`
- Modify: `docs/tesis/evidence/final-experiment/protocol.md` only before freeze if a preflight defect is found

**Step 1: Build the runtime**

Run:

```powershell
pnpm build
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
```

Expected: all pass before any cell is opened.

**Step 2: Create clean target copies**

Create four short-path repositories under `C:/mh-final-thesis/` from the frozen template, initialize Git, and record each base SHA and file manifest. Never use the active ManyHands checkout as a target.

**Step 3: Freeze**

Record the exact ManyHands commit, target template hash, oracle hash, prompts, cell order, model/effort, budgets, stop rules, and the fact that old SP2/G6/Warehouse runs are not cells of this study.

**Step 4: Verify the freeze**

Run a script that recomputes all hashes and rejects dirty target trees or missing prompts. Expected: `freeze: PASS`.

**Step 5: Commit**

```powershell
git add .scratch/final-thesis-experiment docs/tesis/evidence/final-experiment/protocol.md
git commit -m "chore: freeze final thesis experiment"
```

### Task 4: Execute the four cells exactly once

**Files:**
- Create: `.scratch/final-thesis-experiment/runs/<cell>/`
- Create: `docs/tesis/evidence/final-experiment/results.json`

**Step 1: Run the rehearsal**

Run one rehearsal against a disposable copy. It is excluded from the cell count and must not change the freeze.

**Step 2: Run multi-layer adaptive repetitions**

Run `M-C-r1` and `M-C-r2` sequentially with no automatic retry. Run `pnpm build` immediately before each run. Capture planning journal, snapshot, candidate diff, exact SHA, receipt and external oracle result.

**Step 3: Run cohesive adaptive repetitions**

Run `S-C-r1` and `S-C-r2` with the identical runtime configuration and no automatic retry. Run `pnpm build` immediately before each run and capture the same artifacts.

**Step 4: Derive results**

Derive H-F1 and H-F2 from raw artifacts only. PASS requires all four cells to satisfy their cell-level gates; any missing candidate, `not_run` oracle, or structural mismatch is an adverse result, not a partial PASS.

**Step 5: Stop execution**

After the fourth cell and oracle evaluation, stop the server and verify that no ManyHands listener remains. Do not launch another run while the thesis is being rewritten.

### Task 5: Reconcile evidence and remove non-serving central claims

**Files:**
- Create: `docs/tesis/evidence/final-experiment/FINAL-REPORT.md`
- Modify: `docs/tesis/evidence/THESIS-EVIDENCE-DOSSIER.md`
- Modify: `docs/tesis/evidence/FINAL-REPORT.md`
- Modify: `docs/tesis/claim-evidence-matrix.md`
- Modify: `docs/tesis/evidence/semantic-planning/sp2-conclusions.md`

**Step 1: Write the raw result table**

Include one row per final cell with base SHA, candidate SHA, lifecycle, oracle disposition, structural metrics, and failure attribution. Include rehearsal and every adverse artifact separately.

**Step 2: Apply the claim gate**

Only promote claims supported by the final four-cell chain. Keep SP2 as supporting end-to-end evidence only if the final freeze explicitly allows it; otherwise label it as a prior successful pilot. Keep G5/G6/G7/Warehouse in an archive section with no positive scale claim.

**Step 3: Write the conclusion**

Use one paragraph for H-F1, one for H-F2, and one for limits. Never state that the original scale hypotheses were confirmed.

**Step 4: Verify the matrix**

Run a script or manual audit that every positive sentence in the dossier links to a raw artifact and every retired claim is marked as such.

### Task 6: Rewrite the thesis around the final experiment

**Files:**
- Modify: `docs/tesis/main.tex`
- Modify: `docs/tesis/presentacion.tex`
- Modify: `docs/tesis/evidence/README.md` if navigation needs updating

**Step 1: Remove central Warehouse/G5/G6/G7 claims**

Delete or relegate the incomplete scale narrative, old percentages, and claims that imply the historical 1/8 chain is positive evidence. Keep a concise limitations/archival note so adverse evidence is not hidden.

**Step 2: Add the final experiment**

Describe the two tasks, four cells, frozen model/configuration, external oracle, exact candidate validation, and the two bounded hypotheses.

**Step 3: Align abstract, results, conclusions and future work**

The abstract and conclusion must contain the same verdicts and limits. Future work may mention a real scale study, but it must not be presented as completed evidence.

**Step 4: Compile and inspect**

Run the thesis and presentation build commands, inspect the generated PDFs, and scan for stale terms:

```powershell
rg -n "90 %|1/8|G5|G6|G7|H-G6|escala.*sostenida|superioridad" docs/tesis/main.tex docs/tesis/presentacion.tex
```

Expected: only explicitly labelled historical/adverse/limitation references remain.

### Task 7: Final reproducibility gate

**Files:**
- Modify: `docs/tesis/evidence/final-experiment/README.md`
- Modify: `docs/tesis/THESIS-EVIDENCE-DOSSIER.md` only if a link is missing

**Step 1: Run repository verification**

```powershell
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
git diff --check
```

**Step 2: Verify custody**

Recompute target/oracle/freeze hashes and verify every candidate SHA and oracle receipt still resolves.

**Step 3: Commit the thesis package**

```powershell
git add docs/tesis .scratch/final-thesis-experiment
git commit -m "docs: publish final thesis evidence and conclusions"
```

No push is permitted.
