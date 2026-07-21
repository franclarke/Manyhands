# ManyHands Interview Study PDF Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task and `@pdf` to render and visually verify every meaningful PDF revision.

**Goal:** Replace the current 79-page interview PDF with a 120-150 page digital-first technical study book that teaches ManyHands comprehensively before presenting a self-contained rehearsal section with all 14 slides and the optional fixture demo.

**Architecture:** Expand `manual-estudio-entrevista-tecnica.md` into the authoritative technical-book source, keep the presentation and fixture scripts as the self-contained practice sources, and compose them in that order with a production ReportLab generator. Generate diagram assets from declarative Python definitions, validate source structure and repository references before building, then validate PDF structure programmatically and visually inspect a complete rendered contact sheet.

**Tech Stack:** Markdown, Python 3, ReportLab, Pillow, pypdf, pdf2image/Poppler, PowerShell, current TypeScript source and Vitest tests as technical evidence.

---

## Execution constraints

- Work from `C:\Users\franc\Documents\Proyectos\Manyhands`.
- The worktree is already heavily modified. Never run `git reset`, `git clean`, a
  global stash, or a broad formatting command.
- Before every commit, stage only the exact files named in that task.
- Treat these files as authoritative inputs:
  - `docs/presentation/manual-estudio-entrevista-tecnica.md`;
  - `docs/presentation/guion-presentacion-entrevista.md`;
  - `docs/presentation/guion-demo-fixture.md`;
  - `C:\Users\franc\Desktop\presentacion.pdf`.
- Treat `docs/plans/2026-07-20-manyhands-interview-study-book-design.md` as the
  accepted design contract.
- Preserve the stable output name:
  `output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf`.
- Do not rerun the complete monorepo build for PDF-only changes. Use the focused
  evidence tests named below, source validation, PDF validation and visual
  rendering.
- Historical metrics such as 156 files and 915 passing tests must remain dated.
  Revalidate current metrics only if the book claims they describe the live tree.

## Definition of done

- The first substantive part is the 16-chapter technical book.
- The practice section appears after the theory and is self-contained.
- The PDF has 120-150 pages and all 14 slide thumbnails.
- At least 10 diagrams exist; target 12.
- Every chapter contains priority, definition, implementation, evidence,
  trade-off, interview connection and autoevaluation.
- Every referenced repository path exists.
- LangGraph is historical, `auto` granularity is exploratory, AWS/Python are
  hypothetical transfer, and the fixture is not described as real execution.
- Source validator, focused evidence tests and PDF validator pass.
- A render of every page has been inspected through contact sheets, plus detailed
  inspection of representative pages.

### Task 1: Freeze the baseline and document the safe execution scope

**Files:**
- Read: `docs/plans/2026-07-20-manyhands-interview-study-book-design.md`
- Read: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Read: `docs/presentation/guion-presentacion-entrevista.md`
- Read: `docs/presentation/guion-demo-fixture.md`
- Read: `output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf`

**Step 1: Confirm the real repository root**

Run:

```powershell
git rev-parse --show-toplevel
```

Expected: `C:/Users/franc/Documents/Proyectos/Manyhands`.

**Step 2: Capture the dirty baseline without modifying it**

Run:

```powershell
git status --short --branch
```

Expected: many pre-existing changes. Save the output in the execution notes; do
not clean or restore anything.

**Step 3: Confirm the four inputs exist**

Run:

```powershell
$inputs = @(
  'docs/presentation/manual-estudio-entrevista-tecnica.md',
  'docs/presentation/guion-presentacion-entrevista.md',
  'docs/presentation/guion-demo-fixture.md',
  'C:\Users\franc\Desktop\presentacion.pdf'
)
$inputs | ForEach-Object { "$_`t$(Test-Path -LiteralPath $_)" }
```

Expected: four `True` values.

**Step 4: Capture the current PDF baseline**

Run:

```powershell
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "from pypdf import PdfReader; r=PdfReader('output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf'); print(len(r.pages))"
```

Expected: `79` before the redesign.

**Step 5: Commit only the accepted design and plan if commits are authorized**

```powershell
git add docs/plans/2026-07-20-manyhands-interview-study-book-design.md docs/plans/2026-07-20-manyhands-interview-study-pdf.md
git commit -m "docs: design complete interview study book"
```

If commits are not authorized, leave both files untracked and continue without
staging them.

### Task 2: Add a source-level acceptance validator

**Files:**
- Create: `scripts/validate-interview-study-source.py`
- Test: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Test: `docs/presentation/guion-presentacion-entrevista.md`
- Test: `docs/presentation/guion-demo-fixture.md`

**Step 1: Write the validator with the approved chapter contract**

Create a script with these core checks:

```python
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANUAL = ROOT / "docs/presentation/manual-estudio-entrevista-tecnica.md"
SCRIPT = ROOT / "docs/presentation/guion-presentacion-entrevista.md"
DEMO = ROOT / "docs/presentation/guion-demo-fixture.md"

CHAPTER_TITLES = [
    "Mapa mental y vocabulario",
    "Software agentic",
    "Problema de tesis e hipótesis",
    "Descomposición, grounding y granularidad",
    "DAG, Graph Compiler y contracts",
    "Readiness, waves y decisiones humanas",
    "ExecutionBase, attempts, AgentExecutor, Git y scope",
    "InputFingerprint, vigencia y adopción",
    "Journal, replay, CAS, leases y fencing",
    "Validación y EvidenceMatrix",
    "Integración bottom-up y delivery",
    "Recovery por causa",
    "UI como proyección y fixture",
    "Librerías, adapters y LangGraph histórico",
    "Evidencia, resultados y límites",
    "Transferencia a Python y AWS",
]

REQUIRED_LABELS = [
    "**Prioridad:**",
    "### Intuición",
    "### Problema de ingeniería",
    "### Estrategia",
    "### Implementación en ManyHands",
    "### Evidencia real",
    "### Trade-offs y límites",
    "### Cómo explicarlo en la entrevista",
    "### Autoevaluación",
    "### Respuestas razonadas",
]


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def validate_chapters(text: str) -> None:
    for index, title in enumerate(CHAPTER_TITLES, start=1):
        marker = f"## {index}. {title}"
        if marker not in text:
            fail(f"missing chapter: {marker}")
    sections = re.split(r"(?m)^## \d+\. ", text)[1:]
    if len(sections) != 16:
        fail(f"expected 16 chapters, found {len(sections)}")
    for index, section in enumerate(sections, start=1):
        for label in REQUIRED_LABELS:
            if label not in section:
                fail(f"chapter {index} missing {label}")


def validate_relative_links(path: Path, text: str) -> None:
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        if target.startswith(("#", "http:", "https:", "mailto:")):
            continue
        relative = target.split("#", 1)[0]
        if relative and not (path.parent / relative).resolve().exists():
            fail(f"broken link in {path}: {target}")


def main() -> None:
    manual = MANUAL.read_text(encoding="utf-8")
    validate_chapters(manual)
    for path in (MANUAL, SCRIPT, DEMO):
        validate_relative_links(path, path.read_text(encoding="utf-8"))
    combined = "\n".join(path.read_text(encoding="utf-8") for path in (MANUAL, SCRIPT, DEMO))
    for required in ("LangGraph", "histórico", "granularidad", "exploratoria", "fixture", "no demuestra"):
        if required.lower() not in combined.lower():
            fail(f"missing qualification: {required}")
    print("PASS: interview study sources satisfy the structural contract")


if __name__ == "__main__":
    main()
```

**Step 2: Run the validator and confirm the expected failure**

Run:

```powershell
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/validate-interview-study-source.py
```

Expected: failure at the first missing new chapter. This proves the validator is
checking the redesign rather than accepting the old manual.

**Step 3: Check the script itself**

Run:

```powershell
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m py_compile scripts/validate-interview-study-source.py
```

Expected: exit code 0.

**Step 4: Commit the validator only**

```powershell
git add scripts/validate-interview-study-source.py
git commit -m "test: define interview study book source contract"
```

### Task 3: Restructure the manual into the 16-chapter book shell

**Files:**
- Modify: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Reference: `docs/plans/2026-07-20-manyhands-interview-study-book-design.md`

**Step 1: Replace the opening with the new reading contract**

The first pages must state:

```markdown
# ManyHands - Libro técnico para la entrevista

> Este libro enseña primero el sistema y sus fundamentos. El material para
> practicar la exposición comienza después de la Parte I.

## Cómo leer este libro en 24 horas

### Primera pasada - Esencial
### Segunda pasada - Importante
### Tercera pasada - Profundización y evidencia
```

**Step 2: Add the 16 exact chapter headings**

Use the titles from `CHAPTER_TITLES` in the validator. Do not retain a second
parallel numbering scheme from the previous manual.

**Step 3: Add the fixed chapter template under every heading**

```markdown
**Prioridad:** Esencial | Importante | Profundización

**Aparece en:** Diapositiva N

### Qué vas a aprender
### Intuición
### Definición técnica
### Problema de ingeniería
### Estrategia
### Implementación en ManyHands
### Evidencia real
### Trade-offs y límites
### Cómo explicarlo en la entrevista
### Autoevaluación
### Respuestas razonadas
```

**Step 4: Move existing correct material into the appropriate shells**

Use heading-aware edits. Do not delete deep material merely because it is absent
from the slides. Remove only literal duplication after both copies have been
compared.

**Step 5: Run a heading-only audit**

Run:

```powershell
rg -n '^## [0-9]+\.' docs/presentation/manual-estudio-entrevista-tecnica.md
```

Expected: exactly 16 numbered chapter headings in the approved order.

**Step 6: Run the source validator**

Expected: it may still fail for incomplete chapter sections, but it must no
longer fail for missing chapter headings.

**Step 7: Commit the book shell**

```powershell
git add docs/presentation/manual-estudio-entrevista-tecnica.md
git commit -m "docs: restructure interview manual as technical book"
```

### Task 4: Write chapters 1-4 - foundations, thesis problem and decomposition

**Files:**
- Modify: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Read: `PRODUCT.md`
- Read: `docs/system/README.md`
- Read: `docs/adr/0004-planner-graph-compiler.md`
- Read: `packages/decomposer/src/planner/work-breakdown.ts`
- Read: `packages/repository-index/src/snapshot.ts`
- Read: `packages/decomposer/src/llm/recursive/step-prompt.ts`
- Read: `packages/decomposer/src/llm/recursive/recursive-decomposer.ts`
- Test evidence: `tests/decomposer-work-breakdown.test.ts`
- Test evidence: `tests/repository-snapshot.test.ts`
- Test evidence: `tests/decomposer-recursive-prompt.test.ts`

**Step 1: Write chapter 1 from the run outward**

Define run, goal, node, leaf, composite, artifact, contract, attempt, candidate,
evidence, integration and delivery. Add one end-to-end mental map without
implementation detail.

**Step 2: Write chapter 2 from first principles**

Explain agent, tool, workflow, executor, orchestration, autonomy, non-determinism,
structured output and deterministic boundary. Include counterexamples: a chat is
not automatically an agent; a DAG is not LangGraph; an LLM response is not a
committed result.

**Step 3: Write chapter 3 around the real thesis question**

Use password recovery to cross API, domain, persistence, UI and tests. Separate
problem, main question, engineering hypothesis and what was not demonstrated.

**Step 4: Write chapter 4 around repository-grounded decomposition**

Explain `RepositorySnapshot`, `WorkBreakdown`, coarse/fine trade-offs and the
current limits of `auto`. State explicitly that the productive planner does not
demonstrate an optimal adaptive policy.

**Step 5: Add evidence boxes**

Each chapter must cite at least one real file and one relevant test. For general
agent concepts, evidence may show the ManyHands port or adapter implementing the
concept rather than claiming the repository proves the general definition.

**Step 6: Add autoevaluation and responses**

Minimum per chapter:

- 3 comprehension questions;
- 1 technical scenario;
- 1 oral explanation prompt;
- reasoned answers after a visual separator.

**Step 7: Run focused evidence tests**

Run:

```powershell
pnpm test -- tests/decomposer-work-breakdown.test.ts tests/repository-snapshot.test.ts tests/decomposer-recursive-prompt.test.ts
```

Expected: all selected tests pass. If the dirty tree has an unrelated failure,
record the exact failure and do not rewrite the book to hide it.

**Step 8: Commit chapters 1-4**

```powershell
git add docs/presentation/manual-estudio-entrevista-tecnica.md
git commit -m "docs: teach agentic foundations and decomposition"
```

### Task 5: Write chapters 5-8 - graph compilation, scheduling and execution

**Files:**
- Modify: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Read: `packages/decomposer/src/compiler/graph-compiler.ts`
- Read: `packages/contracts/src/contract-bundle.ts`
- Read: `packages/contracts/src/scope-contract.ts`
- Read: `packages/scheduler/src/readiness-v2.ts`
- Read: `packages/execution-core/src/base/execution-base-builder.ts`
- Read: `packages/execution-core/src/v2/node-executor.ts`
- Read: `packages/execution-core/src/executor/types.ts`
- Read: `packages/execution-core/src/scope/checker.ts`
- Read: `packages/run-coordinator/src/domain/fingerprint.ts`
- Read: `packages/run-coordinator/src/domain/artifacts.ts`
- Test evidence: `tests/graph-compiler.test.ts`
- Test evidence: `tests/scheduler-readiness-v2.test.ts`
- Test evidence: `tests/execution-base-builder.test.ts`
- Test evidence: `tests/execution-core-v2-node-executor.test.ts`
- Test evidence: `tests/execution-core-scope.test.ts`
- Test evidence: `tests/input-fingerprint.test.ts`
- Test evidence: `tests/artifact-registry.test.ts`

**Step 1: Write chapter 5**

Teach DAG, hierarchy, acyclicity, `GraphRevision`, deterministic compilation,
critics and the separate meanings of `parentId`, `ArtifactRequirement`,
`SeamBinding` and `ConflictConstraint`.

**Step 2: Write chapter 6**

Teach readiness as a derived explanation, not a mutable boolean. Explain human
decisions, dependencies, conflicts, wave selection and persisted dispatch intent.

**Step 3: Write chapter 7**

Teach `ExecutionBase`, attempt identity, Git worktrees, `AgentExecutor`, process
diagnostics, authoritative diff, scope deny-wins and candidate commits. Clarify
that forbidden paths are terminal while allow-list misses can follow configured
policy.

**Step 4: Write chapter 8**

Teach canonical input hashing, freshness, stale candidates, adoption and why a
successful executor exit is not enough.

**Step 5: Select one short code fragment and one test per mechanism**

Do not include whole modules. A fragment should normally fit in 8-24 lines and
must be followed by a plain-language reading.

**Step 6: Add the chapter self-checks and interview explanations**

The oral answers should fit 30-60 seconds before the optional deep answer.

**Step 7: Run focused evidence tests**

```powershell
pnpm test -- tests/graph-compiler.test.ts tests/scheduler-readiness-v2.test.ts tests/execution-base-builder.test.ts tests/execution-core-v2-node-executor.test.ts tests/execution-core-scope.test.ts tests/input-fingerprint.test.ts tests/artifact-registry.test.ts
```

Expected: all selected tests pass or exact unrelated dirty-tree failures are
reported.

**Step 8: Commit chapters 5-8**

```powershell
git add docs/presentation/manual-estudio-entrevista-tecnica.md
git commit -m "docs: teach graph scheduling and isolated execution"
```

### Task 6: Write chapters 9-12 - durable authority, evidence, integration and recovery

**Files:**
- Modify: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Read: `docs/adr/0006-event-sourced-run-coordinator.md`
- Read: `packages/run-coordinator/src/coordinator.ts`
- Read: `packages/run-coordinator/src/reducer.ts`
- Read: `packages/run-coordinator/src/recovery-policy.ts`
- Read: `packages/run-coordinator/src/domain/events.ts`
- Read: `packages/run-store/src/jsonl-event-store.ts`
- Read: `packages/run-store/src/snapshot-store.ts`
- Read: `apps/web/src/lib/server/runs/run-operation-lease.ts`
- Read: `packages/execution-core/src/validation/evidence-matrix.ts`
- Read: `packages/execution-core/src/integration/manifest.ts`
- Read: `packages/execution-core/src/delivery/publisher.ts`
- Test evidence: `tests/run-store-event-source.test.ts`
- Test evidence: `tests/run-store-snapshot-rebuild.test.ts`
- Test evidence: `tests/run-store-fencing.test.ts`
- Test evidence: `tests/run-operation-lease.test.ts`
- Test evidence: `tests/evidence-matrix.test.ts`
- Test evidence: `tests/integration-manifest.test.ts`
- Test evidence: `tests/delivery-state-machine.test.ts`
- Test evidence: `tests/run-v2-crash-recovery.test.ts`

**Step 1: Write chapter 9**

Introduce event sourcing gradually: fact, command, event, fold, projection,
snapshot and replay. Then explain expected sequence CAS, lease ownership, fencing
tokens, event idempotency and checksums. Include a table showing why none of CAS,
lease and fencing replaces the others.

**Step 2: Write chapter 10**

Explain exact-commit validation, criteria versus obligations, evidence refs,
eligibility and the `EvidenceMatrix`. State why “tests green” is insufficient.

**Step 3: Write chapter 11**

Explain adoption into the artifact registry, bottom-up integration,
`IntegrationManifest`, final validation, immutable delivery approval,
`DeliveryReceipt`, `result_ready` and `completed`.

**Step 4: Write chapter 12**

Explain failure classification and the recovery matrix. Cover transients, code,
contracts, stale outputs, scope, integration and crash after an external side
effect. Avoid presenting a universal retry count.

**Step 5: Add causal diagrams in text before final artwork exists**

Use explicit temporary markers:

```markdown
![DIAGRAM-09: journal authority](assets/study-book/diagram-09-journal-authority.png)
```

**Step 6: Run focused evidence tests**

```powershell
pnpm test -- tests/run-store-event-source.test.ts tests/run-store-snapshot-rebuild.test.ts tests/run-store-fencing.test.ts tests/run-operation-lease.test.ts tests/evidence-matrix.test.ts tests/integration-manifest.test.ts tests/delivery-state-machine.test.ts tests/run-v2-crash-recovery.test.ts
```

Expected: all selected tests pass or exact unrelated failures are documented.

**Step 7: Commit chapters 9-12**

```powershell
git add docs/presentation/manual-estudio-entrevista-tecnica.md
git commit -m "docs: teach durable coordination and delivery"
```

### Task 7: Write chapters 13-16 - UI, libraries, evidence and transfer

**Files:**
- Modify: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Read: `apps/web/src/lib/run-model/reducer.ts`
- Read: `apps/web/src/lib/run-model/fixture-playback.ts`
- Read: `apps/web/src/lib/run-model/fixtures/index.ts`
- Read: `apps/web/package.json`
- Read: `packages/execution-core/src/executor/profiles/claude-code.ts`
- Read: `packages/execution-core/src/executor/profiles/codex.ts`
- Read: `tests/run-coordinator-boundaries.test.ts`
- Read: `tests/run-model-v2-fixture.test.ts`
- Read: `tests/fixture-playback-navigation.test.ts`
- Read: `tests/run-v2-e2e.test.ts`
- Read: `docs/audits/v2-productive-run-audit-2026-07-18.md`
- Read: `.github/workflows/ci.yml`

**Step 1: Write chapter 13**

Explain reducer, projection, replay, React Flow, live event source versus fixture
event source, and why UI state cannot become a second lifecycle authority.

**Step 2: Write chapter 14**

Explain each technology by responsibility: TypeScript, Zod, Next.js, React,
React Flow, Git, `simple-git`, Claude Code CLI, Codex CLI, Vitest, JSON and JSONL.
Explain LangGraph as historical and verify `c5a4f99`, empty productive imports,
residual dependencies and the boundary test before final wording.

**Step 3: Write chapter 15**

Teach evidence levels, methodology, tests, smoke, fixture, current limits and
dated metrics. Keep automated domain E2E separate from a real CLI-to-delivery
smoke.

**Step 4: Write chapter 16**

Map concepts to Python/Pydantic/FastAPI and a hypothetical AWS deployment. Cover
DynamoDB versus PostgreSQL, S3 artifacts, SQS dispatch, ECS workers, IAM and CDK
without describing them as current implementation.

**Step 5: Add a focused job-context appendix**

Explain where LangChain, LangGraph, RAG, embeddings and vector stores would or
would not fit. Keep it concise and tied to likely interview questions; do not
turn the book into a separate RAG course.

**Step 6: Run the focused tests**

```powershell
pnpm test -- tests/run-coordinator-boundaries.test.ts tests/run-model-v2-fixture.test.ts tests/fixture-playback-navigation.test.ts tests/run-v2-e2e.test.ts
```

Expected: focused tests pass. Record the exact scope of the E2E.

**Step 7: Verify LangGraph claims**

```powershell
git show -s --format='%H %ad %s' --date=short c5a4f99
rg -n '@langchain|StateGraph|Annotation|interrupt\(' apps packages --glob '*.ts' --glob '*.tsx'
```

Expected: the commit resolves; no productive imports are found; manifest
dependencies may remain and must be described as residual.

**Step 8: Run the source validator**

Expected: PASS after all 16 chapter templates and links are complete.

**Step 9: Commit chapters 13-16**

```powershell
git add docs/presentation/manual-estudio-entrevista-tecnica.md
git commit -m "docs: complete interview technical study book"
```

### Task 8: Generate the 12 pedagogical diagrams

**Files:**
- Create: `scripts/generate-interview-study-diagrams.py`
- Create: `docs/presentation/assets/study-book/diagram-01-system-map.png`
- Create: `docs/presentation/assets/study-book/diagram-02-agent-workflow-boundary.png`
- Create: `docs/presentation/assets/study-book/diagram-03-cross-system-feature.png`
- Create: `docs/presentation/assets/study-book/diagram-04-hierarchical-dag.png`
- Create: `docs/presentation/assets/study-book/diagram-05-planner-compiler.png`
- Create: `docs/presentation/assets/study-book/diagram-06-readiness-waves.png`
- Create: `docs/presentation/assets/study-book/diagram-07-execution-attempt.png`
- Create: `docs/presentation/assets/study-book/diagram-08-fingerprint-adoption.png`
- Create: `docs/presentation/assets/study-book/diagram-09-journal-authority.png`
- Create: `docs/presentation/assets/study-book/diagram-10-validation-adoption.png`
- Create: `docs/presentation/assets/study-book/diagram-11-integration-delivery.png`
- Create: `docs/presentation/assets/study-book/diagram-12-python-aws-transfer.png`
- Modify: `docs/presentation/manual-estudio-entrevista-tecnica.md`

**Step 1: Define a declarative diagram model**

Use Pillow only; do not add a dependency. The generator should expose:

```python
@dataclass(frozen=True)
class Node:
    id: str
    label: str
    column: int
    row: int
    tone: Literal["domain", "adapter", "evidence", "future"]


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    label: str = ""
    dashed: bool = False
```

Render at least 2400 pixels wide so diagrams remain sharp when scaled in the PDF.

**Step 2: Write a failing asset-count check**

Add to `validate-interview-study-source.py`:

```python
assets = sorted((ROOT / "docs/presentation/assets/study-book").glob("diagram-*.png"))
if len(assets) != 12:
    fail(f"expected 12 diagrams, found {len(assets)}")
```

Run the validator. Expected: FAIL before generation.

**Step 3: Implement diagrams 1-4**

Verify graph direction, labels and legend. These explain system, agent boundary,
cross-system feature and typed DAG.

**Step 4: Implement diagrams 5-8**

These explain planner/compiler, readiness, execution attempt and freshness.

**Step 5: Implement diagrams 9-12**

These explain durable authority, evidence/adoption, integration/delivery and the
hypothetical AWS transfer.

**Step 6: Generate and inspect all assets**

Run:

```powershell
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/generate-interview-study-diagrams.py
```

Expected: 12 PNG files, each at least 2400 pixels wide.

**Step 7: Replace all temporary diagram markers with final captions**

Each figure must have a question-based caption and a paragraph titled “Cómo
dibujarlo en la entrevista”.

**Step 8: Run the source validator**

Expected: PASS.

**Step 9: Commit diagrams and references**

```powershell
git add scripts/generate-interview-study-diagrams.py docs/presentation/assets/study-book docs/presentation/manual-estudio-entrevista-tecnica.md scripts/validate-interview-study-source.py
git commit -m "docs: add pedagogical ManyHands diagrams"
```

### Task 9: Make the rehearsal section fully self-contained

**Files:**
- Modify: `docs/presentation/guion-presentacion-entrevista.md`
- Modify: `docs/presentation/guion-demo-fixture.md`
- Reference: `docs/presentation/manual-estudio-entrevista-tecnica.md`

**Step 1: Add practice metadata to slides 1-11**

Every slide must contain:

```markdown
**Función narrativa**
**Qué debe comprender la audiencia**
**Mensaje imprescindible**
**Guion oral completo**
**Ancla de emergencia**
**Transición**
**Tiempo objetivo**
**Versión abreviada**
**Repreguntas probables**
**Respuesta técnica corta**
**Evitar**
```

**Step 2: Add explicit timing checkpoints**

Checkpoints belong after slides 3, 6, 8 and 11. Preserve the `9:30` contingency
for slides 9-11.

**Step 3: Make backup slides operational**

For R1-R3 add trigger question, entry sentence, element to point at, maximum time
and return-to-close sentence.

**Step 4: Add three rehearsal routes**

Include 15-minute, 12-minute and 8-minute routes without changing the main thesis
question or exaggerating evidence.

**Step 5: Preserve the demo as optional**

Keep the four Q&A variants and make the 2-minute version the default if asked.
The slide 6 screenshot remains the normal presentation path.

**Step 6: Revalidate fixture facts**

Run the focused fixture tests and directly verify the current event collection:

```powershell
pnpm test -- tests/run-model-v2-fixture.test.ts tests/fixture-playback-navigation.test.ts
```

Expected: current fixture assertions pass. Update all counts consistently if the
fixture changed.

**Step 7: Run the source validator**

Expected: PASS, including all relative links.

**Step 8: Commit the practice sources**

```powershell
git add docs/presentation/guion-presentacion-entrevista.md docs/presentation/guion-demo-fixture.md
git commit -m "docs: make interview rehearsal section self-contained"
```

### Task 10: Promote and redesign the PDF generator

**Files:**
- Create: `scripts/generate-interview-study-pdf.py`
- Read: `tmp/pdfs/generate_interview_study_pdf.py`
- Modify output: `output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf`

**Step 1: Copy the audited behavior into a production script**

Use `apply_patch` to create the production script. Do not move or delete the temp
script until the final PDF is accepted.

**Step 2: Invert the source order**

The build order must be:

```python
SOURCES = [
    ("Parte I - Conocimiento técnico integral", MANUAL),
    ("Parte II - Práctica de la presentación", PRESENTATION_SCRIPT),
    ("Parte III - Demo opcional", DEMO_SCRIPT),
]
```

**Step 3: Add semantic callout rendering**

Map the recurring labels to consistent colors and icons/text labels. Do not rely
on color alone; every callout must retain its textual category.

**Step 4: Add diagram rendering**

Recognize Markdown image references under `assets/study-book/`, scale them to
content width and keep caption plus first explanation paragraph together.

**Step 5: Add real internal navigation**

Create stable bookmarks from normalized heading IDs. Resolve internal Markdown
anchors to PDF destinations. Add backlinks from slide sections to the associated
book chapters and from chapters to the slide practice pages.

**Step 6: Preserve all 14 slide thumbnails**

Render from `presentacion.pdf` or use the verified upright slide images. Fail the
build if any slide 1-14 is missing.

**Step 7: Add code-block metadata**

Support a caption line containing file path and test path. Keep code fragments
splittable only between blocks, never through a line.

**Step 8: Build the first redesigned PDF**

Run:

```powershell
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/generate-interview-study-pdf.py
```

Expected: PDF builds successfully. Page count may initially fall outside 120-150;
that is addressed through content completeness and layout, not artificial blank
pages.

**Step 9: Commit the generator**

```powershell
git add scripts/generate-interview-study-pdf.py
git commit -m "feat: generate integral interview study PDF"
```

### Task 11: Add programmatic PDF acceptance checks

**Files:**
- Create: `scripts/validate-interview-study-pdf.py`
- Test: `output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf`

**Step 1: Write the validator**

The core should be:

```python
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf"

reader = PdfReader(str(PDF))
pages = len(reader.pages)
assert 120 <= pages <= 150, f"expected 120-150 pages, found {pages}"

text = "\n".join(page.extract_text() or "" for page in reader.pages)
assert text.index("Parte I - Conocimiento técnico integral") < text.index(
    "Parte II - Práctica de la presentación"
)
assert text.index("Parte II - Práctica de la presentación") < text.index(
    "Parte III - Demo opcional"
)

for slide in range(1, 15):
    assert f"Diapositiva {slide} de la presentación" in text

for term in (
    "RepositorySnapshot",
    "WorkBreakdown",
    "GraphRevision",
    "ArtifactRequirement",
    "SeamBinding",
    "ConflictConstraint",
    "ExecutionBase",
    "InputFingerprint",
    "EvidenceMatrix",
    "ArtifactRegistry",
    "IntegrationManifest",
    "DeliveryReceipt",
    "CAS",
    "fencing",
):
    assert term in text, f"missing technical term: {term}"

assert "LangGraph" in text and "histórico" in text
assert "fixture" in text and "no demuestra" in text
assert "\ufffd" not in text
print(f"PASS: {pages} pages and all required content present")
```

**Step 2: Run the validator and observe the first result**

```powershell
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/validate-interview-study-pdf.py
```

Expected: PASS only when content and page range are genuinely complete. Do not
weaken the page constraint to make an incomplete book pass.

**Step 3: Add outline and annotation checks**

Verify the PDF has bookmarks and internal link annotations. Use recursive outline
counting rather than `len(reader.outline)`, because pypdf nests child entries.

**Step 4: Add source-to-PDF sentinel checks**

Select at least two distinctive sentences from each of the three source files and
assert that normalized text appears in the PDF.

**Step 5: Commit the validator**

```powershell
git add scripts/validate-interview-study-pdf.py
git commit -m "test: validate interview study PDF structure"
```

### Task 12: Render every page and perform visual QA

**Files:**
- Create temporary renders: `tmp/pdfs/interview-study-final-render/`
- Create temporary contact sheets: `tmp/pdfs/interview-study-final-contact/`
- Modify as needed: `scripts/generate-interview-study-pdf.py`
- Modify as needed: the three `docs/presentation/*.md` sources
- Regenerate: `output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf`

**Step 1: Render all pages at inspection resolution**

Use `pdf2image` with the bundled Poppler path and render every page at 90-110 DPI.

**Step 2: Generate contact sheets**

Place 16-20 page thumbnails per sheet. Confirm page continuity, section breaks,
headers, footers and absence of unexpected blank pages.

**Step 3: Inspect representative pages at high detail**

At minimum inspect:

- cover;
- every index page;
- one page from each of the 16 chapters;
- all 12 diagrams;
- a dense table;
- a code fragment;
- an evidence box;
- an autoevaluation and its answers;
- slides 1, 6, 11, 12, 13 and 14;
- demo cursors table;
- final checklist.

**Step 4: Fix each visual defect at its source**

Do not patch the PDF binary. Fix Markdown, diagram generator or ReportLab layout,
regenerate, rerender and reinspect.

**Step 5: Check print fallback**

Render one representative page in grayscale and confirm categories remain
distinguishable through labels, borders and typography.

**Step 6: Run both validators again**

```powershell
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/validate-interview-study-source.py
& 'C:\Users\franc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/validate-interview-study-pdf.py
```

Expected: both PASS.

**Step 7: Commit only source and generator fixes**

```powershell
git add docs/presentation/manual-estudio-entrevista-tecnica.md docs/presentation/guion-presentacion-entrevista.md docs/presentation/guion-demo-fixture.md docs/presentation/assets/study-book scripts/generate-interview-study-diagrams.py scripts/generate-interview-study-pdf.py scripts/validate-interview-study-source.py scripts/validate-interview-study-pdf.py output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf
git commit -m "docs: deliver complete ManyHands interview study book"
```

Never use `git add .` in this worktree.

### Task 13: Final evidence and handoff

**Files:**
- Verify: `docs/presentation/manual-estudio-entrevista-tecnica.md`
- Verify: `docs/presentation/guion-presentacion-entrevista.md`
- Verify: `docs/presentation/guion-demo-fixture.md`
- Verify: `output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf`

**Step 1: Run source and PDF validators**

Expected: PASS / PASS.

**Step 2: Run the complete focused evidence set once**

```powershell
pnpm test -- tests/decomposer-work-breakdown.test.ts tests/repository-snapshot.test.ts tests/decomposer-recursive-prompt.test.ts tests/graph-compiler.test.ts tests/scheduler-readiness-v2.test.ts tests/execution-base-builder.test.ts tests/execution-core-v2-node-executor.test.ts tests/execution-core-scope.test.ts tests/input-fingerprint.test.ts tests/artifact-registry.test.ts tests/run-store-event-source.test.ts tests/run-store-snapshot-rebuild.test.ts tests/run-store-fencing.test.ts tests/run-operation-lease.test.ts tests/evidence-matrix.test.ts tests/integration-manifest.test.ts tests/delivery-state-machine.test.ts tests/run-v2-crash-recovery.test.ts tests/run-coordinator-boundaries.test.ts tests/run-model-v2-fixture.test.ts tests/fixture-playback-navigation.test.ts tests/run-v2-e2e.test.ts
```

Expected: all focused evidence tests pass. Report any dirty-tree failure exactly.

**Step 3: Verify links and whitespace**

Run the source validator plus:

```powershell
git diff --check -- docs/presentation scripts output/pdf
```

Expected: no whitespace errors in tracked diffs. Remember that untracked files
require the dedicated validators because `git diff --check` does not inspect them.

**Step 4: Verify the scoped status**

```powershell
git status --short -- docs/plans/2026-07-20-manyhands-interview-study-book-design.md docs/plans/2026-07-20-manyhands-interview-study-pdf.md docs/presentation/manual-estudio-entrevista-tecnica.md docs/presentation/guion-presentacion-entrevista.md docs/presentation/guion-demo-fixture.md docs/presentation/assets/study-book scripts/generate-interview-study-diagrams.py scripts/generate-interview-study-pdf.py scripts/validate-interview-study-source.py scripts/validate-interview-study-pdf.py output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf
```

Expected: only intended study-book files appear in the scoped report.

**Step 5: Deliver the final report**

Report:

- final PDF link, page count and size;
- chapter and diagram counts;
- source validation result;
- focused test result;
- visual QA coverage;
- corrections made to prior claims;
- known limits;
- whether files remain untracked or were committed.
