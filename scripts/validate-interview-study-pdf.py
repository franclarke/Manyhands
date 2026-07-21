from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "output/pdf/manyhands-guia-estudio-entrevista-tecnica.pdf"


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    return re.sub(r"\s+", " ", value).strip()


def outline_count(items: list) -> int:
    total = 0
    for item in items:
        if isinstance(item, list):
            total += outline_count(item)
        else:
            total += 1
    return total


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    require(PDF.exists(), f"missing PDF: {PDF}")
    reader = PdfReader(str(PDF))
    pages = len(reader.pages)
    require(120 <= pages <= 150, f"expected 120-150 pages, found {pages}")

    text = normalized("\n".join(page.extract_text() or "" for page in reader.pages))
    parts = [
        "Parte I - Conocimiento técnico integral",
        "Parte II - Práctica de la presentación",
        "Parte III - Demo opcional",
    ]
    positions = [text.find(part) for part in parts]
    require(all(position >= 0 for position in positions), f"missing part title: {positions}")
    require(positions == sorted(positions), f"incorrect part order: {positions}")

    for slide in range(1, 15):
        require(f"Diapositiva {slide} de la presentación" in text, f"missing slide thumbnail caption {slide}")

    terms = (
        "RepositorySnapshot", "WorkBreakdown", "GraphRevision", "ArtifactRequirement",
        "SeamBinding", "ConflictConstraint", "ExecutionBase", "InputFingerprint",
        "EvidenceMatrix", "ArtifactRegistry", "IntegrationManifest", "DeliveryReceipt",
        "CAS", "fencing",
    )
    for term in terms:
        require(term in text, f"missing technical term: {term}")

    qualifications = (
        "LangGraph tuvo uso histórico",
        "granularidad adaptativa completa es exploratoria",
        "no demuestra efectos externos reales",
        "transferencia hipotética",
    )
    for sentence in qualifications:
        require(normalized(sentence).lower() in text.lower(), f"missing qualification: {sentence}")

    sentinels = (
        "La unidad de producto es un run",
        "La pregunta principal fue",
        "El planner recibe el goal y un RepositorySnapshot",
        "La fixture queda fuera de los 15 minutos",
        "La captura es la demostración visual principal",
        "Esto demuestra replay y proyección de UI",
    )
    for sentence in sentinels:
        require(normalized(sentence).lower() in text.lower(), f"missing source sentinel: {sentence}")

    require("\ufffd" not in text, "replacement character found in extracted PDF text")
    bookmarks = outline_count(reader.outline)
    require(bookmarks >= 30, f"too few bookmarks: {bookmarks}")
    annotations = sum(len(page.get("/Annots") or []) for page in reader.pages)
    require(annotations >= 20, f"too few link annotations: {annotations}")
    print(f"PASS: {pages} pages, 14 slides, {bookmarks} bookmarks and {annotations} annotations")


if __name__ == "__main__":
    main()
