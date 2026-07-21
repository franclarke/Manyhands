from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "presentation" / "assets" / "study-book"
WIDTH, HEIGHT = 2400, 1350
BG = "#F5F7FA"
INK = "#152238"
MUTED = "#526174"
BLUE = "#176B87"
CYAN = "#2AA7A1"
GOLD = "#D89216"
RED = "#B64242"
WHITE = "#FFFFFF"
PALE_BLUE = "#E7F2F7"
PALE_GOLD = "#FFF2D8"
PALE_GREEN = "#E8F5F1"
PALE_RED = "#FBEAEA"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(name, size)


def canvas(title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((70, 55, WIDTH - 70, HEIGHT - 55), 28, fill=WHITE, outline="#D8E0E8", width=3)
    draw.text((130, 105), title, font=font(54, True), fill=INK)
    draw.text((130, 180), subtitle, font=font(28), fill=MUTED)
    draw.line((130, 235, WIDTH - 130, 235), fill="#D8E0E8", width=3)
    return image, draw


def multiline(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, size: int, fill: str,
              bold: bool = False, width: int = 26, spacing: int = 10, anchor: str | None = None) -> None:
    lines = "\n".join(wrap(text, width=width, break_long_words=False))
    draw.multiline_text(xy, lines, font=font(size, bold), fill=fill, spacing=spacing, anchor=anchor, align="center" if anchor == "mm" else "left")


def card(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, body: str = "",
         fill: str = PALE_BLUE, accent: str = BLUE, title_size: int = 31, body_size: int = 24) -> None:
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, 22, fill=fill, outline=accent, width=3)
    draw.rectangle((x1, y1, x1 + 13, y2), fill=accent)
    multiline(draw, ((x1 + x2) // 2, y1 + 52), title, title_size, INK, True, width=max(12, int((x2 - x1) / 27)), anchor="mm")
    if body:
        multiline(draw, ((x1 + x2) // 2, y1 + 128), body, body_size, MUTED, width=max(16, int((x2 - x1) / 24)), anchor="mm")


def arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color: str = BLUE, width: int = 8) -> None:
    draw.line((start, end), fill=color, width=width)
    x, y = end
    sx, sy = start
    if abs(x - sx) >= abs(y - sy):
        sign = 1 if x > sx else -1
        points = [(x, y), (x - sign * 26, y - 17), (x - sign * 26, y + 17)]
    else:
        sign = 1 if y > sy else -1
        points = [(x, y), (x - 17, y - sign * 26), (x + 17, y - sign * 26)]
    draw.polygon(points, fill=color)


def save(image: Image.Image, name: str) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT / name, optimize=True)


def diagram_01() -> None:
    image, draw = canvas("Mapa del sistema", "Una funcionalidad grande se transforma en un resultado verificable y entregable")
    labels = [
        ("Goal", "intención del usuario"), ("Planning", "grounding + WorkBreakdown"),
        ("DAG", "contratos y dependencias"), ("Execution", "attempts aislados"),
        ("Validation", "evidencia sobre SHA"), ("Integration", "bottom-up"),
        ("Delivery", "árbol validado"),
    ]
    x, y, w, h, gap = 120, 480, 260, 250, 60
    for i, (title, body) in enumerate(labels):
        card(draw, (x + i * (w + gap), y, x + i * (w + gap) + w, y + h), title, body,
             fill=PALE_GREEN if i == len(labels) - 1 else PALE_BLUE, accent=CYAN if i == len(labels) - 1 else BLUE,
             title_size=29, body_size=22)
        if i < len(labels) - 1:
            arrow(draw, (x + i * (w + gap) + w + 6, y + h // 2), (x + (i + 1) * (w + gap) - 8, y + h // 2))
    multiline(draw, (WIDTH // 2, 920), "La unidad de producto es el run: conserva plan, decisiones, eventos, evidencia e integración.", 31, INK, True, width=96, anchor="mm")
    save(image, "diagram-01-system-map.png")


def diagram_02() -> None:
    image, draw = canvas("Frontera entre IA y mecanismos verificables", "La propuesta probabilística se acepta sólo después de atravesar contratos explícitos")
    card(draw, (150, 360, 890, 970), "Zona probabilística", "LLM / agente\nPropone descomposición\nGenera cambios\nExplica decisiones", PALE_GOLD, GOLD, 38, 29)
    card(draw, (1510, 360, 2250, 970), "Zona determinista", "Zod valida fronteras\nGraph Compiler construye\nGit identifica commits\nTests producen evidencia", PALE_BLUE, BLUE, 38, 29)
    card(draw, (990, 490, 1410, 840), "Contratos", "schemas\nIDs\nscopes\nSHAs\neventos", PALE_GREEN, CYAN, 35, 27)
    arrow(draw, (890, 665), (982, 665), GOLD)
    arrow(draw, (1410, 665), (1502, 665), CYAN)
    multiline(draw, (WIDTH // 2, 1080), "El agente propone; el sistema valida, registra y decide qué resultado puede avanzar.", 32, INK, True, width=90, anchor="mm")
    save(image, "diagram-02-agent-workflow-boundary.png")


def diagram_03() -> None:
    image, draw = canvas("Una funcionalidad grande cruza varios subsistemas", "Ejemplo: recuperación de contraseña")
    centers = [(1200, 420), (600, 650), (1800, 650), (730, 1020), (1670, 1020)]
    boxes = [
        ((880, 315, 1520, 525), "Recuperar contraseña", "objetivo de negocio", PALE_GOLD, GOLD),
        ((240, 560, 960, 770), "API y dominio", "token, expiración, reglas", PALE_BLUE, BLUE),
        ((1440, 560, 2160, 770), "Persistencia", "usuario, token, consumo", PALE_BLUE, BLUE),
        ((370, 920, 1090, 1130), "Interfaz y correo", "formulario, feedback, enlace", PALE_GREEN, CYAN),
        ((1310, 920, 2030, 1130), "Tests y observabilidad", "casos, errores, trazabilidad", PALE_GREEN, CYAN),
    ]
    for box, title, body, fill, accent in boxes:
        card(draw, box, title, body, fill, accent, 32, 24)
    for target in centers[1:]:
        arrow(draw, (1200, 525), (target[0], target[1] - 105), GOLD, 6)
    save(image, "diagram-03-cross-system-feature.png")


def diagram_04() -> None:
    image, draw = canvas("DAG jerárquico", "Ownership vertical + dependencias técnicas horizontales")
    card(draw, (830, 300, 1570, 470), "Goal root", "resultado final", PALE_GOLD, GOLD)
    card(draw, (280, 600, 1030, 790), "Boundary: backend", "integra API + dominio", PALE_BLUE, BLUE)
    card(draw, (1370, 600, 2120, 790), "Boundary: frontend", "integra UI + estados", PALE_BLUE, BLUE)
    card(draw, (160, 970, 650, 1170), "API leaf", "endpoint", PALE_GREEN, CYAN, 29, 23)
    card(draw, (690, 970, 1180, 1170), "Domain leaf", "reglas", PALE_GREEN, CYAN, 29, 23)
    card(draw, (1220, 970, 1710, 1170), "UI leaf", "formulario", PALE_GREEN, CYAN, 29, 23)
    card(draw, (1750, 970, 2240, 1170), "Tests leaf", "evidencia", PALE_GREEN, CYAN, 29, 23)
    for a, b in [((1200, 470), (655, 592)), ((1200, 470), (1745, 592)), ((655, 790), (405, 962)), ((655, 790), (935, 962)), ((1745, 790), (1465, 962)), ((1745, 790), (1995, 962))]:
        arrow(draw, a, b, BLUE, 5)
    draw.line((650, 1070, 690, 1070), fill=RED, width=7)
    draw.line((1180, 1070, 1220, 1070), fill=RED, width=7)
    multiline(draw, (1200, 860), "ArtifactRequirement / SeamBinding / ConflictConstraint", 25, RED, True, width=72, anchor="mm")
    save(image, "diagram-04-hierarchical-dag.png")


def diagram_05() -> None:
    image, draw = canvas("Planner y Graph Compiler", "Separar intención propuesta de estructura ejecutable")
    card(draw, (120, 430, 560, 800), "RepositorySnapshot", "archivos\npaquetes\ntests\nseñales", PALE_GREEN, CYAN)
    card(draw, (700, 350, 1160, 880), "Planner", "LLM propone\nWorkBreakdown\njerarquía\ncontratos", PALE_GOLD, GOLD)
    card(draw, (1300, 350, 1760, 880), "Graph Compiler", "reglas deterministas\nIDs\nrelaciones\nvalidaciones", PALE_BLUE, BLUE)
    card(draw, (1900, 430, 2280, 800), "GraphRevision", "plan ejecutable\nversionado", PALE_GREEN, CYAN)
    arrow(draw, (560, 615), (692, 615), CYAN)
    arrow(draw, (1160, 615), (1292, 615), GOLD)
    arrow(draw, (1760, 615), (1892, 615), BLUE)
    multiline(draw, (WIDTH // 2, 1050), "Zod valida cada frontera no confiable; los critics rechazan inconsistencias antes de ejecutar.", 31, INK, True, width=92, anchor="mm")
    save(image, "diagram-05-planner-compiler.png")


def diagram_06() -> None:
    image, draw = canvas("Readiness y waves", "El scheduler habilita sólo trabajo cuyas precondiciones ya están satisfechas")
    rows = [
        ("Wave 1", [("API", CYAN), ("UI shell", CYAN), ("DB schema", CYAN)]),
        ("Wave 2", [("Service", BLUE), ("Form", BLUE)]),
        ("Wave 3", [("Integration", GOLD), ("E2E", GOLD)]),
    ]
    ys = [380, 690, 1000]
    for (label, items), y in zip(rows, ys):
        multiline(draw, (165, y + 80), label, 31, INK, True, width=12, anchor="mm")
        start_x = 380 + (3 - len(items)) * 210
        for i, (name, accent) in enumerate(items):
            card(draw, (start_x + i * 560, y, start_x + i * 560 + 430, y + 170), name, "ready", PALE_GREEN if accent == CYAN else PALE_BLUE if accent == BLUE else PALE_GOLD, accent, 30, 22)
    arrow(draw, (1200, 550), (1200, 680), BLUE)
    arrow(draw, (1200, 860), (1200, 990), BLUE)
    multiline(draw, (2050, 530), "Una decisión humana\nbloquea sólo los nodos\nque dependen de ella.", 27, RED, True, width=22, anchor="mm")
    save(image, "diagram-06-readiness-waves.png")


def diagram_07() -> None:
    image, draw = canvas("Anatomía de un attempt", "Base declarada, workspace aislado y resultado candidato")
    boxes = [
        ("ExecutionBase", "artefactos declarados\ncommit base", PALE_GREEN, CYAN),
        ("Git worktree", "aislamiento por intento", PALE_BLUE, BLUE),
        ("AgentExecutor", "Claude Code o Codex CLI", PALE_GOLD, GOLD),
        ("Scope check", "deny-wins\ndiff inspeccionado", PALE_RED, RED),
        ("Candidate commit", "SHA inmutable\nresult_ready", PALE_GREEN, CYAN),
    ]
    x, y, w, h, gap = 120, 480, 385, 300, 65
    for i, (title, body, fill, accent) in enumerate(boxes):
        card(draw, (x + i * (w + gap), y, x + i * (w + gap) + w, y + h), title, body, fill, accent, 29, 23)
        if i < len(boxes) - 1:
            arrow(draw, (x + i * (w + gap) + w + 8, y + h // 2), (x + (i + 1) * (w + gap) - 8, y + h // 2), accent)
    multiline(draw, (WIDTH // 2, 995), "El candidato todavía no está completado: primero debe ser validado, adoptado e integrado.", 32, INK, True, width=91, anchor="mm")
    save(image, "diagram-07-execution-attempt.png")


def diagram_08() -> None:
    image, draw = canvas("Vigencia del resultado", "InputFingerprint evita adoptar trabajo construido sobre entradas obsoletas")
    card(draw, (160, 410, 730, 850), "Al iniciar", "GraphRevision\ncontracts\nExecutionBase\nartifact versions", PALE_BLUE, BLUE)
    card(draw, (915, 410, 1485, 850), "InputFingerprint", "hash estable de\nlas entradas efectivas", PALE_GOLD, GOLD)
    card(draw, (1670, 320, 2240, 650), "Coincide", "adoptar al\nArtifactRegistry", PALE_GREEN, CYAN)
    card(draw, (1670, 760, 2240, 1090), "Cambió", "stale result\ndescartar", PALE_RED, RED)
    arrow(draw, (730, 630), (907, 630), BLUE)
    arrow(draw, (1485, 600), (1662, 485), CYAN)
    arrow(draw, (1485, 660), (1662, 925), RED)
    multiline(draw, (1200, 1090), "La validez no depende sólo de que el proceso haya terminado, sino de que siga resolviendo el mismo problema.", 30, INK, True, width=93, anchor="mm")
    save(image, "diagram-08-fingerprint-adoption.png")


def diagram_09() -> None:
    image, draw = canvas("Una sola autoridad del lifecycle", "El journal canónico se pliega para reconstruir proyecciones")
    card(draw, (160, 410, 760, 930), "RunCoordinator", "decide transiciones\nCAS\nleases\nfencing", PALE_GOLD, GOLD)
    card(draw, (900, 410, 1500, 930), "Event journal", "historia canónica\nappend-only\nchecksums", PALE_BLUE, BLUE)
    card(draw, (1640, 300, 2240, 610), "RunRecord", "snapshot reconstruible", PALE_GREEN, CYAN)
    card(draw, (1640, 760, 2240, 1070), "UI projection", "reducer + replay", PALE_GREEN, CYAN)
    arrow(draw, (760, 670), (892, 670), GOLD)
    arrow(draw, (1500, 610), (1632, 470), BLUE)
    arrow(draw, (1500, 730), (1632, 915), BLUE)
    multiline(draw, (1200, 1120), "CAS evita escrituras sobre versiones viejas; lease y fencing contienen coordinadores obsoletos.", 29, INK, True, width=94, anchor="mm")
    save(image, "diagram-09-journal-authority.png")


def diagram_10() -> None:
    image, draw = canvas("Validación y adopción", "La evidencia se asocia al commit exacto que fue evaluado")
    cards = [
        ("Candidate SHA", "resultado del attempt", PALE_GOLD, GOLD),
        ("Validators", "tests, checks y políticas", PALE_BLUE, BLUE),
        ("EvidenceMatrix", "obligación → evidencia → estado", PALE_BLUE, BLUE),
        ("Adoption", "ArtifactRegistry", PALE_GREEN, CYAN),
    ]
    x, y, w, h, gap = 150, 430, 465, 380, 95
    for i, values in enumerate(cards):
        card(draw, (x + i * (w + gap), y, x + i * (w + gap) + w, y + h), *values, title_size=31, body_size=25)
        if i < len(cards) - 1:
            arrow(draw, (x + i * (w + gap) + w + 8, y + h // 2), (x + (i + 1) * (w + gap) - 8, y + h // 2))
    multiline(draw, (WIDTH // 2, 1000), "Validar otra copia, otro branch o un SHA posterior rompería la relación entre afirmación y evidencia.", 31, INK, True, width=90, anchor="mm")
    save(image, "diagram-10-validation-adoption.png")


def diagram_11() -> None:
    image, draw = canvas("Integración bottom-up y delivery", "Los resultados se recomponen en los mismos límites que guiaron la descomposición")
    card(draw, (150, 890, 610, 1110), "Leaf A", "adopted", PALE_GREEN, CYAN, 28, 22)
    card(draw, (680, 890, 1140, 1110), "Leaf B", "adopted", PALE_GREEN, CYAN, 28, 22)
    card(draw, (1260, 890, 1720, 1110), "Leaf C", "adopted", PALE_GREEN, CYAN, 28, 22)
    card(draw, (1790, 890, 2250, 1110), "Leaf D", "adopted", PALE_GREEN, CYAN, 28, 22)
    card(draw, (360, 560, 1040, 760), "Integration boundary 1", "IntegrationManifest", PALE_BLUE, BLUE)
    card(draw, (1360, 560, 2040, 760), "Integration boundary 2", "IntegrationManifest", PALE_BLUE, BLUE)
    card(draw, (760, 300, 1640, 480), "Root integration", "validación final", PALE_GOLD, GOLD)
    card(draw, (1790, 300, 2250, 480), "Delivery", "publicar árbol", PALE_GREEN, CYAN, 28, 22)
    for a, b in [((380, 890), (600, 760)), ((910, 890), (800, 760)), ((1490, 890), (1580, 760)), ((2020, 890), (1800, 760)), ((700, 560), (1040, 480)), ((1700, 560), (1360, 480))]:
        arrow(draw, a, b, BLUE, 5)
    arrow(draw, (1640, 390), (1782, 390), GOLD)
    save(image, "diagram-11-integration-delivery.png")


def diagram_12() -> None:
    image, draw = canvas("Transferencia conceptual a Python y AWS", "Mapeo defendible de responsabilidades; no describe tecnologías implementadas en ManyHands")
    mappings = [
        ("TypeScript + Zod", "Python + Pydantic", "tipos y validación runtime"),
        ("RunCoordinator", "ECS / Lambda + Step Functions*", "coordinación y workers"),
        ("JSON / JSONL", "S3 + DynamoDB / RDS", "eventos, snapshots y metadatos"),
        ("Git worktrees", "workspaces efímeros en ECS/EC2", "aislamiento de ejecución"),
    ]
    y = 330
    for left, right, body in mappings:
        card(draw, (140, y, 840, y + 190), left, body, PALE_BLUE, BLUE, 29, 22)
        card(draw, (1560, y, 2260, y + 190), right, body, PALE_GREEN, CYAN, 29, 22)
        arrow(draw, (850, y + 95), (1550, y + 95), GOLD, 7)
        y += 235
    multiline(draw, (1200, 1270), "* Selección hipotética según duración, volumen, costo, idempotencia y necesidad de estado.", 25, RED, True, width=95, anchor="mm")
    save(image, "diagram-12-python-aws-transfer.png")


def main() -> None:
    for function in [diagram_01, diagram_02, diagram_03, diagram_04, diagram_05, diagram_06,
                     diagram_07, diagram_08, diagram_09, diagram_10, diagram_11, diagram_12]:
        function()
    print(f"Generated 12 diagrams in {OUTPUT}")


if __name__ == "__main__":
    main()
