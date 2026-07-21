from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANUAL = ROOT / "docs/presentation/manual-estudio-entrevista-tecnica.md"
SCRIPT = ROOT / "docs/presentation/guion-presentacion-entrevista.md"
DEMO = ROOT / "docs/presentation/guion-demo-fixture.md"
ASSETS = ROOT / "docs/presentation/assets/study-book"

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


def validate_diagrams() -> None:
    assets = sorted(ASSETS.glob("diagram-*.png")) if ASSETS.exists() else []
    if len(assets) != 12:
        fail(f"expected 12 diagrams, found {len(assets)}")


def main() -> None:
    manual = MANUAL.read_text(encoding="utf-8")
    validate_chapters(manual)
    for path in (MANUAL, SCRIPT, DEMO):
        validate_relative_links(path, path.read_text(encoding="utf-8"))
    combined = "\n".join(
        path.read_text(encoding="utf-8") for path in (MANUAL, SCRIPT, DEMO)
    )
    for required in (
        "LangGraph",
        "histórico",
        "granularidad",
        "exploratoria",
        "fixture",
        "no demuestra",
    ):
        if required.lower() not in combined.lower():
            fail(f"missing qualification: {required}")
    validate_diagrams()
    print("PASS: interview study sources satisfy the structural contract")


if __name__ == "__main__":
    main()
