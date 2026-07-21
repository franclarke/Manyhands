from __future__ import annotations

import hashlib
import html
import re
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, HRFlowable, Image, KeepTogether, LongTable,
    NextPageTemplate, PageBreak, PageTemplate, Paragraph, Spacer, Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "manyhands-guia-estudio-entrevista-tecnica.pdf"
SLIDES = ROOT / "tmp" / "pdfs" / "presentation-review-20260719" / "rotated"
SOURCES = [
    ("Parte I - Conocimiento técnico integral", ROOT / "docs/presentation/manual-estudio-entrevista-tecnica.md"),
    ("Parte II - Práctica de la presentación", ROOT / "docs/presentation/guion-presentacion-entrevista.md"),
    ("Parte III - Demo opcional", ROOT / "docs/presentation/guion-demo-fixture.md"),
]

PAGE_W, PAGE_H = A4
MX, MT, MB = 16 * mm, 17 * mm, 16 * mm
CONTENT_W = PAGE_W - 2 * MX
INK = colors.HexColor("#172337")
MUTED = colors.HexColor("#526174")
BLUE = colors.HexColor("#176B87")
PALE_BLUE = colors.HexColor("#E9F3F7")
GOLD = colors.HexColor("#C87F0A")
PALE_GOLD = colors.HexColor("#FFF3DA")
GREEN = colors.HexColor("#21857E")
PALE_GREEN = colors.HexColor("#E9F6F2")
RED = colors.HexColor("#A94141")
PALE_RED = colors.HexColor("#FBECEC")
LINE = colors.HexColor("#CBD5DF")
CODE_BG = colors.HexColor("#F4F6F8")


def register_fonts() -> None:
    font_dir = Path("C:/Windows/Fonts")
    pdfmetrics.registerFont(TTFont("Study", str(font_dir / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("Study-Bold", str(font_dir / "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("Study-Italic", str(font_dir / "DejaVuSans-Oblique.ttf")))
    pdfmetrics.registerFont(TTFont("Study-Mono", str(font_dir / "consola.ttf")))


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "CoverKicker": ParagraphStyle("CoverKicker", parent=base["Normal"], fontName="Study-Bold", fontSize=10, leading=14, textColor=GOLD, spaceAfter=8),
        "CoverTitle": ParagraphStyle("CoverTitle", parent=base["Title"], fontName="Study-Bold", fontSize=31, leading=37, textColor=INK, spaceAfter=13),
        "CoverSub": ParagraphStyle("CoverSub", parent=base["Normal"], fontName="Study", fontSize=13, leading=19, textColor=MUTED, spaceAfter=12),
        "Part": ParagraphStyle("Part", parent=base["Title"], fontName="Study-Bold", fontSize=24, leading=30, textColor=INK, spaceAfter=13),
        "PartIntro": ParagraphStyle("PartIntro", parent=base["Normal"], fontName="Study", fontSize=11, leading=17, textColor=MUTED, spaceAfter=14),
        "H1": ParagraphStyle("H1", parent=base["Heading1"], fontName="Study-Bold", fontSize=19, leading=24, textColor=INK, spaceBefore=12, spaceAfter=9, keepWithNext=True),
        "H2": ParagraphStyle("H2", parent=base["Heading2"], fontName="Study-Bold", fontSize=15, leading=20, textColor=BLUE, spaceBefore=12, spaceAfter=7, keepWithNext=True),
        "H3": ParagraphStyle("H3", parent=base["Heading3"], fontName="Study-Bold", fontSize=12, leading=16, textColor=INK, spaceBefore=9, spaceAfter=5, keepWithNext=True),
        "H4": ParagraphStyle("H4", parent=base["Heading4"], fontName="Study-Bold", fontSize=10.4, leading=14, textColor=BLUE, spaceBefore=7, spaceAfter=4, keepWithNext=True),
        "Body": ParagraphStyle("Body", parent=base["BodyText"], fontName="Study", fontSize=9.75, leading=14.6, textColor=INK, spaceAfter=6.5, splitLongWords=False),
        "Small": ParagraphStyle("Small", parent=base["BodyText"], fontName="Study", fontSize=8.2, leading=11.5, textColor=MUTED, spaceAfter=4),
        "List": ParagraphStyle("List", parent=base["BodyText"], fontName="Study", fontSize=9.6, leading=14.2, leftIndent=15, firstLineIndent=-8, textColor=INK, spaceAfter=3.2),
        "Quote": ParagraphStyle("Quote", parent=base["BodyText"], fontName="Study-Italic", fontSize=9.6, leading=14.6, leftIndent=12, rightIndent=8, borderColor=GOLD, borderWidth=0, borderPadding=8, backColor=PALE_GOLD, textColor=INK, spaceBefore=3, spaceAfter=7),
        "Code": ParagraphStyle("Code", parent=base["Code"], fontName="Study-Mono", fontSize=7.2, leading=10, leftIndent=7, rightIndent=7, borderColor=LINE, borderWidth=.6, borderPadding=7, backColor=CODE_BG, textColor=INK, spaceBefore=4, spaceAfter=7),
        "Label": ParagraphStyle("Label", parent=base["BodyText"], fontName="Study-Bold", fontSize=9.2, leading=13, textColor=BLUE, backColor=PALE_BLUE, borderColor=BLUE, borderWidth=.5, borderPadding=5, spaceBefore=5, spaceAfter=4),
        "Caption": ParagraphStyle("Caption", parent=base["BodyText"], fontName="Study-Italic", fontSize=8, leading=11, alignment=TA_CENTER, textColor=MUTED, spaceBefore=4, spaceAfter=9),
        "SlideCaption": ParagraphStyle("SlideCaption", parent=base["BodyText"], fontName="Study-Bold", fontSize=8.6, leading=12, alignment=TA_CENTER, textColor=BLUE, spaceBefore=5, spaceAfter=8),
        "Table": ParagraphStyle("Table", parent=base["BodyText"], fontName="Study", fontSize=7.7, leading=10.5, textColor=INK),
        "TableHead": ParagraphStyle("TableHead", parent=base["BodyText"], fontName="Study-Bold", fontSize=7.7, leading=10.5, textColor=colors.white),
    }


class StudyDocument(BaseDocTemplate):
    def __init__(self, filename: str, style_map: dict[str, ParagraphStyle]):
        super().__init__(filename, pagesize=A4, leftMargin=MX, rightMargin=MX, topMargin=MT, bottomMargin=MB, title="ManyHands - Libro técnico para la entrevista", author="Francisco Clarke")
        self.style_map = style_map
        frame = Frame(MX, MB, CONTENT_W, PAGE_H - MT - MB, id="normal-frame")
        cover = Frame(MX, MB, CONTENT_W, PAGE_H - MT - MB, id="cover-frame")
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[cover], onPage=self._cover_page),
            PageTemplate(id="normal", frames=[frame], onPage=self._normal_page),
        ])
        self._bookmark_counts: dict[str, int] = {}

    def _cover_page(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setFillColor(INK)
        canvas.rect(0, 0, 10 * mm, PAGE_H, fill=1, stroke=0)
        canvas.restoreState()

    def _normal_page(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setFillColor(BLUE)
        canvas.rect(0, 0, 6 * mm, PAGE_H, fill=1, stroke=0)
        canvas.setFont("Study", 7.4)
        canvas.setFillColor(MUTED)
        canvas.drawString(MX, PAGE_H - 9 * mm, "ManyHands - Libro técnico para la entrevista")
        canvas.drawRightString(PAGE_W - MX, 8 * mm, f"Página {doc.page}")
        canvas.setStrokeColor(LINE)
        canvas.line(MX, PAGE_H - 11 * mm, PAGE_W - MX, PAGE_H - 11 * mm)
        canvas.restoreState()

    def afterFlowable(self, flowable) -> None:
        if not isinstance(flowable, Paragraph):
            return
        level = getattr(flowable, "_heading_level", None)
        if level is None:
            return
        text = flowable.getPlainText()
        key = getattr(flowable, "_bookmark_key", None)
        if key is None:
            base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"
            count = self._bookmark_counts.get(base, 0)
            self._bookmark_counts[base] = count + 1
            key = f"{base}-{count}"
            flowable._bookmark_key = key
        self.canv.bookmarkPage(key)
        outline_level = max(0, min(level, 1))
        self.canv.addOutlineEntry(text, key, level=outline_level, closed=outline_level > 0)
        self.notify("TOCEntry", (outline_level, text, self.page, key))


def inline(text: str) -> str:
    escaped = html.escape(text, quote=False)
    placeholders: list[str] = []

    def code(match: re.Match[str]) -> str:
        placeholders.append(f'<font name="Study-Mono" color="#176B87">{match.group(1)}</font>')
        return f"@@CODE{len(placeholders)-1}@@"

    escaped = re.sub(r"`([^`]+)`", code, escaped)
    def markdown_link(match: re.Match[str]) -> str:
        label, target = match.group(1), match.group(2)
        if target.startswith(("https://", "http://", "mailto:")):
            return f'<link href="{target}" color="#176B87"><u>{label}</u></link>'
        return f'<font color="#176B87"><u>{label}</u></font>'

    escaped = re.sub(r"\[([^]]+)]\(([^)]+)\)", markdown_link, escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    for index, value in enumerate(placeholders):
        escaped = escaped.replace(f"@@CODE{index}@@", value)
    return escaped


def heading(text: str, level: int, style_map: dict[str, ParagraphStyle]) -> Paragraph:
    flow = Paragraph(inline(text), style_map[f"H{min(level, 4)}"])
    flow._heading_level = max(0, level - 1)
    return flow


def markdown_table(lines: list[str], style_map: dict[str, ParagraphStyle]) -> LongTable:
    parsed = [[cell.strip() for cell in row.strip().strip("|").split("|")] for row in lines]
    if len(parsed) > 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in parsed[1]):
        parsed.pop(1)
    width = max(len(row) for row in parsed)
    parsed = [row + [""] * (width - len(row)) for row in parsed]
    data = []
    for row_index, row in enumerate(parsed):
        style = style_map["TableHead"] if row_index == 0 else style_map["Table"]
        data.append([Paragraph(inline(cell), style) for cell in row])
    # Calculate column widths proportionally based on max text length in each column
    col_max_lens = [0] * width
    for row in parsed:
        for col_idx, cell in enumerate(row):
            if col_idx < len(col_max_lens):
                col_max_lens[col_idx] = max(col_max_lens[col_idx], len(cell))
                
    total_len = sum(col_max_lens)
    if total_len > 0:
        raw_widths = []
        for l in col_max_lens:
            share = l / total_len
            raw_widths.append(max(0.08, share))
        sum_raw = sum(raw_widths)
        col_widths = [w / sum_raw * CONTENT_W for w in raw_widths]
    else:
        col_widths = [CONTENT_W / width] * width

    table = LongTable(data, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("GRID", (0, 0), (-1, -1), .35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FB")]),
    ]))
    return table


def slide_number(title: str) -> int | None:
    match = re.match(r"Diapositiva\s+(\d+)\s+-", title)
    if match:
        return int(match.group(1))
    match = re.match(r"Respaldo\s+R([123])\s+-", title)
    return 11 + int(match.group(1)) if match else None


def slide_block(number: int, style_map: dict[str, ParagraphStyle]) -> list:
    path = SLIDES / f"slide-{number:02d}.png"
    if not path.exists():
        raise FileNotFoundError(f"Missing slide image: {path}")
    image = Image(str(path), width=CONTENT_W, height=CONTENT_W * 9 / 16)
    return [Spacer(1, 5), image, Paragraph(f"Diapositiva {number} de la presentación", style_map["SlideCaption"])]


def image_block(source: Path, alt: str, target: str, style_map: dict[str, ParagraphStyle]) -> list:
    path = (source.parent / target).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Missing image referenced from {source}: {target}")
    from PIL import Image as PILImage
    with PILImage.open(path) as opened:
        ratio = opened.height / opened.width
    height = min(CONTENT_W * ratio, 112 * mm)
    width = height / ratio
    return [Spacer(1, 5), Image(str(path), width=width, height=height), Paragraph(alt, style_map["Caption"])]


def markdown_story(source: Path, style_map: dict[str, ParagraphStyle]) -> list:
    lines = source.read_text(encoding="utf-8").splitlines()
    story: list = []
    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.strip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            formatted_lines = []
            for val in code_lines:
                escaped = html.escape(val)
                # Preservar solo los espacios/tabs iniciales de indentacion
                leading_match = re.match(r"^([ \t]+)", escaped)
                if leading_match:
                    spaces = leading_match.group(1)
                    nb_spaces = spaces.replace(" ", "&#160;").replace("\t", "&#160;&#160;&#160;&#160;")
                    escaped = nb_spaces + escaped[len(spaces):]
                formatted_lines.append(escaped)
            code_text = "<br/>".join(formatted_lines) or "&#160;"
            story.append(Paragraph(code_text, style_map["Code"]))
            i += 1
            continue
        image_match = re.fullmatch(r"!\[([^]]*)]\(([^)]+)\)", line)
        if image_match:
            story.extend(image_block(source, image_match.group(1), image_match.group(2), style_map))
            i += 1
            continue
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading_match:
            level = len(heading_match.group(1))
            title = heading_match.group(2)
            if level == 2 and re.match(r"\d+\.\s", title):
                story.append(PageBreak())
            story.append(heading(title, level, style_map))
            number = slide_number(title)
            if number is not None:
                story.extend(slide_block(number, style_map))
            i += 1
            continue
        if line.startswith("|") and line.endswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|") and lines[i].strip().endswith("|"):
                table_lines.append(lines[i])
                i += 1
            story.append(markdown_table(table_lines, style_map))
            story.append(Spacer(1, 6))
            continue
        if line.startswith(">"):
            quote_lines = []
            while i < len(lines) and (not lines[i].strip() or lines[i].strip().startswith(">")):
                value = lines[i].strip()
                if value.startswith(">"):
                    quote_lines.append(value[1:].strip())
                i += 1
            story.append(Paragraph(inline(" ".join(quote_lines)), style_map["Quote"]))
            continue
        if line in ("---", "***"):
            story.append(HRFlowable(width="100%", thickness=.5, color=LINE, spaceBefore=5, spaceAfter=7))
            i += 1
            continue
        label_match = re.fullmatch(r"\*\*([^*]+)\*\*", line)
        if label_match:
            story.append(Paragraph(inline(label_match.group(1)), style_map["Label"]))
            i += 1
            continue
        list_match = re.match(r"^([-*]|\d+\.)\s+(.+)$", line)
        if list_match:
            marker = "•" if list_match.group(1) in ("-", "*") else list_match.group(1)
            story.append(Paragraph(f"{marker} {inline(list_match.group(2))}", style_map["List"]))
            i += 1
            continue
        paragraph_lines = [line]
        i += 1
        while i < len(lines):
            next_line = lines[i].strip()
            if not next_line:
                break
            if re.match(r"^(#{1,6})\s|^```|^!\[|^>|^\||^---$|^\*\*[^*]+\*\*$|^([-*]|\d+\.)\s", next_line):
                break
            paragraph_lines.append(next_line)
            i += 1
        story.append(Paragraph(inline(" ".join(paragraph_lines)), style_map["Body"]))
    return story


def cover(style_map: dict[str, ParagraphStyle]) -> list:
    slide = SLIDES / "slide-01.png"
    elements = [
        Spacer(1, 16 * mm),
        Paragraph("PROYECTO DE TESIS · PREPARACIÓN TÉCNICA", style_map["CoverKicker"]),
        Paragraph("ManyHands", style_map["CoverTitle"]),
        Paragraph("Libro integral de estudio para la entrevista técnica", style_map["CoverSub"]),
        Paragraph("Fundamentos, arquitectura, implementación, evidencia real, límites, guion de las 14 diapositivas y demo opcional.", style_map["CoverSub"]),
        Spacer(1, 7 * mm),
    ]
    if slide.exists():
        elements.append(Image(str(slide), width=CONTENT_W, height=CONTENT_W * 9 / 16))
    elements.extend([
        Spacer(1, 8 * mm),
        Paragraph(f"Francisco Clarke · edición de estudio · {date.today().strftime('%d/%m/%Y')}", style_map["Small"]),
        NextPageTemplate("normal"), PageBreak(),
    ])
    return elements


def study_plan(style_map: dict[str, ParagraphStyle]) -> list:
    rows = [
        ["Bloque", "Objetivo", "Tiempo sugerido"],
        ["Primera pasada", "Capítulos esenciales; construir el mapa integral", "6–7 h"],
        ["Segunda pasada", "Implementación, evidencia y respuestas razonadas", "5–6 h"],
        ["Práctica oral", "Rutas de 15, 12 y 8 minutos", "3–4 h"],
        ["Q&A técnico", "Respaldos, fixture y preguntas difíciles", "3–4 h"],
        ["Repaso final", "Anclas, límites y descanso", "2–3 h"],
    ]
    table = Table([[Paragraph(inline(cell), style_map["TableHead"] if r == 0 else style_map["Table"]) for cell in row] for r, row in enumerate(rows)], colWidths=[38*mm, 93*mm, 42*mm], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), BLUE), ("GRID", (0,0), (-1,-1), .4, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"), ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#F7F9FB")]), ("LEFTPADDING", (0,0), (-1,-1), 6), ("RIGHTPADDING", (0,0), (-1,-1), 6), ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6)]))
    return [Paragraph("Plan de estudio en 24 horas", style_map["Part"]), Paragraph("Leé primero para comprender el sistema. La práctica de diapositivas empieza después del libro técnico y es autosuficiente.", style_map["PartIntro"]), table, Spacer(1, 10), Paragraph("Regla de evidencia", style_map["H2"]), Paragraph("Tests automatizados, smoke productivo, fixture visual y trabajo futuro son niveles distintos. No conviertas una proyección o una transferencia hipotética a Python/AWS en una capacidad implementada.", style_map["Body"])]


def add_part(story: list, title: str, source: Path, style_map: dict[str, ParagraphStyle]) -> None:
    intro = {
        SOURCES[0][0]: "Primero construí un conocimiento integral del sistema: problema, hipótesis, diseño, implementación, evidencia y límites.",
        SOURCES[1][0]: "Después practicá la exposición principal de 11 diapositivas. Las 3 de respaldo se abren sólo ante una pregunta concreta.",
        SOURCES[2][0]: "La fixture queda fuera de los 15 minutos. Es un recurso opcional de Q&A y no demuestra efectos externos reales.",
    }[title]
    story.extend([PageBreak(), Paragraph(title, style_map["Part"]), Paragraph(intro, style_map["PartIntro"]), HRFlowable(width="100%", thickness=.8, color=BLUE), Spacer(1, 8)])
    part_heading = Paragraph(title, style_map["H1"])
    part_heading._heading_level = 0
    story.append(part_heading)
    story.extend(markdown_story(source, style_map))


def build() -> Path:
    register_fonts()
    style_map = styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    for number in range(1, 15):
        if not (SLIDES / f"slide-{number:02d}.png").exists():
            raise FileNotFoundError(f"Missing slide {number}")
    story: list = []
    story.extend(cover(style_map))
    story.append(Paragraph("Índice", style_map["Part"]))
    story.append(Paragraph("Los marcadores permiten volver a cualquier capítulo, diapositiva o recurso de Q&A.", style_map["PartIntro"]))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC0", fontName="Study-Bold", fontSize=9.2, leading=13, textColor=INK, spaceBefore=3),
        ParagraphStyle("TOC1", fontName="Study", fontSize=8.2, leading=11, leftIndent=12, textColor=MUTED),
        ParagraphStyle("TOC2", fontName="Study", fontSize=7.5, leading=10, leftIndent=24, textColor=MUTED),
    ]
    story.extend([toc, PageBreak()])
    story.extend(study_plan(style_map))
    for title, source in SOURCES:
        add_part(story, title, source, style_map)
    document = StudyDocument(str(OUTPUT), style_map)
    document.multiBuild(story)
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()[:12]
    print(f"Generated {OUTPUT} (sha256 {digest})")
    return OUTPUT


if __name__ == "__main__":
    build()
