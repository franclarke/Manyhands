import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRESENTATION_DIR = path.resolve(MODULE_DIR, "..");
const TMP_DIR = path.resolve(
  process.env.TMP_DIR || path.join(MODULE_DIR, ".generated"),
);
const FINAL_PPTX = path.resolve(
  process.env.FINAL_PPTX || path.join(PRESENTATION_DIR, "ManyHands-presentacion-oral.pptx"),
);
const PROJECT_ROOT = path.resolve(
  process.env.PROJECT_ROOT || path.join(MODULE_DIR, "..", "..", "..", ".."),
);

const W = 1280;
const H = 720;
const M = 72;

const C = {
  ivory: "#F7F2E8",
  ivory2: "#FCF9F2",
  graphite: "#20252B",
  muted: "#697178",
  faint: "#A9AFB3",
  line: "#CCD2D4",
  blue: "#173F5F",
  blue2: "#2C648B",
  paleBlue: "#DCE9F0",
  yellow: "#E7B84B",
  paleYellow: "#F7EAC2",
  green: "#2F7D5D",
  paleGreen: "#DCECE5",
  red: "#B64A4A",
  white: "#FFFFFF",
};

const FONT_DISPLAY = "Aptos Display";
const FONT_BODY = "Aptos";

const titles = [
  "ManyHands",
  "La IA ya puede escribir código",
  "El problema aparece cuando el trabajo crece",
  "Dividir ayuda, pero también crea nuevos problemas",
  "Mi proyecto nació de esta pregunta",
  "ManyHands convierte agentes aislados en un equipo",
  "Un Run transforma una idea en un resultado verificable",
  "El trabajo se divide con criterios, no al azar",
  "El agente no recibe sólo una consigna",
  "Trabajar en paralelo requiere acuerdos previos",
  "Decir «terminé» no alcanza",
  "Las partes se integran de abajo hacia arriba",
  "Viaje en Familia puso a prueba el sistema completo",
  "El resultado no fue sólo un grafo",
  "La IA aporta capacidad; la arquitectura aporta confianza",
];

const defaultNotes = [
  "Abrir con una pregunta sencilla: si una inteligencia artificial ya puede programar, ¿qué falta para confiarle un proyecto completo? Presentar ManyHands como la respuesta arquitectónica a ese problema.",
  "Explicar leer, modificar y probar con un ejemplo cotidiano. La capacidad individual ya existe; el desafío del proyecto no fue inventar otra IA, sino organizar su trabajo.",
  "Mostrar cómo aumentan archivos, requisitos, pruebas, decisiones y dependencias. Subrayar que más capacidad no equivale automáticamente a más control.",
  "Contrastar los dos extremos: una tarea enorme que nadie puede manejar y una fragmentación tan fina que coordinar cuesta más que construir. La división correcta es una decisión de ingeniería.",
  "Formular la pregunta central del proyecto y hacer una pausa. Presentar ManyHands como una arquitectura que organiza, integra y verifica, no como una colección de agentes sueltos.",
  "Describir la transición visual: el sistema asigna responsabilidades, supervisa el avance y vuelve a reunir los resultados. La coordinación es parte del producto.",
  "Recorrer el Run de izquierda a derecha. Enfatizar que cada etapa deja un artefacto observable y que el resultado final puede rastrearse hasta el objetivo inicial.",
  "Explicar las tres preguntas con lenguaje cotidiano. El sistema divide sólo cuando la separación permite avanzar o comprobar mejor, y vuelve a unir cuando la separación deja de aportar.",
  "Presentar el contrato de trabajo como un sobre de responsabilidad: objetivo, archivos permitidos, acuerdos con otras partes y prueba requerida. Eso reduce interferencias y ambigüedad.",
  "Señalar primero las dos ramas amarillas: pueden trabajar a la vez porque conocen su interfaz. Luego señalar la rama gris: espera un artefacto real, no una estimación informal.",
  "Contrastar una declaración del agente con la cadena de evidencia. La confianza aparece al inspeccionar cambios, materializar un candidato exacto, ejecutar pruebas y registrar el resultado.",
  "Seguir la integración desde las hojas hasta los tres módulos y finalmente hasta la raíz. Cada nivel comprueba que sus partes funcionan juntas antes de continuar.",
  "Presentar el caso Viaje en Familia: un objetivo visible dividido en trece nodos, con tres módulos compuestos y nueve tareas concretas. Usar la captura real si está disponible.",
  "Mostrar la aplicación o el fotograma del video y luego leer las tres pruebas concretas: 32 de 32 tests, candidato exacto y reproducción en un clon limpio. No extenderse en detalles internos.",
  "Cerrar resolviendo la tensión inicial. La IA aportó velocidad y capacidad; el proyecto aportó la estructura necesaria para transformar ese trabajo en un resultado confiable.",
];

const defaultSources = [
  ["docs/tesis/main.tex", "docs/tesis/chapters/00-resumen.tex"],
  ["docs/tesis/chapters/01-introduccion.tex", "docs/tesis/chapters/02-conceptos-preliminares.tex"],
  ["docs/tesis/chapters/02-conceptos-preliminares.tex", "docs/tesis/chapters/03-estado-del-arte.tex"],
  ["docs/tesis/chapters/04-granularidad-adaptativa.tex"],
  ["docs/tesis/chapters/01-introduccion.tex", "docs/tesis/chapters/05-arquitectura.tex"],
  ["docs/tesis/chapters/05-arquitectura.tex"],
  ["docs/tesis/chapters/05-arquitectura.tex", "docs/tesis/chapters/06-implementacion.tex"],
  ["docs/tesis/chapters/04-granularidad-adaptativa.tex"],
  ["docs/tesis/chapters/05-arquitectura.tex", "docs/tesis/chapters/06-implementacion.tex"],
  ["docs/tesis/chapters/05-arquitectura.tex", "docs/tesis/chapters/06-implementacion.tex"],
  ["docs/tesis/chapters/06-implementacion.tex", "docs/tesis/chapters/07-evaluacion.tex"],
  ["docs/tesis/chapters/05-arquitectura.tex", "docs/tesis/chapters/06-implementacion.tex"],
  ["docs/tesis/chapters/07-evaluacion.tex"],
  ["docs/tesis/chapters/07-evaluacion.tex", "docs/tesis/chapters/08-discusion.tex"],
  ["docs/tesis/chapters/09-conclusiones.tex"],
];

function noneLine() {
  return { style: "solid", fill: "none", width: 0 };
}

function solidLine(fill = C.line, width = 1) {
  return { style: "solid", fill, width };
}

function addText(slide, name, text, position, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name,
    position,
    fill: "none",
    line: noneLine(),
  });
  shape.text = String(text);
  shape.text.style = {
    typeface: options.typeface || (options.display ? FONT_DISPLAY : FONT_BODY),
    fontSize: options.fontSize || 20,
    bold: options.bold || false,
    italic: options.italic || false,
    color: options.color || C.graphite,
    alignment: options.alignment || "left",
    verticalAlignment: options.verticalAlignment || "top",
    autoFit: options.autoFit || "shrinkText",
    wrap: options.wrap || "square",
    lineSpacing: options.lineSpacing,
    insets: options.insets || { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function addShape(slide, name, geometry, position, options = {}) {
  const shape = slide.shapes.add({
    geometry,
    name,
    position,
    fill: options.fill ?? "none",
    line: options.line || noneLine(),
    borderRadius: options.borderRadius,
    shadow: options.shadow,
    adjustmentList: options.adjustmentList,
  });
  if (options.text !== undefined) {
    shape.text = String(options.text);
    shape.text.style = {
      typeface: options.typeface || FONT_BODY,
      fontSize: options.fontSize || 18,
      bold: options.bold || false,
      color: options.color || C.graphite,
      alignment: options.alignment || "center",
      verticalAlignment: options.verticalAlignment || "middle",
      autoFit: options.autoFit || "shrinkText",
      wrap: options.wrap || "square",
      insets: options.insets || { top: 6, right: 8, bottom: 6, left: 8 },
    };
  }
  return shape;
}

function addRule(slide, name, left, top, width, color = C.line, thickness = 1, dashed = false) {
  return slide.shapes.add({
    geometry: "line",
    name,
    position: { left, top, width, height: 0 },
    fill: "none",
    line: { style: dashed ? "dashed" : "solid", fill: color, width: thickness },
  });
}

function addVerticalRule(slide, name, left, top, height, color = C.line, thickness = 1, dashed = false) {
  return slide.shapes.add({
    geometry: "line",
    name,
    position: { left, top, width: 0, height },
    fill: "none",
    line: { style: dashed ? "dashed" : "solid", fill: color, width: thickness },
  });
}

function connect(slide, from, to, options = {}) {
  const arrow = { type: "arrow", width: "sm", length: "sm" };
  return slide.shapes.connect(from, to, {
    kind: options.kind || "straight",
    fromSide: options.fromSide,
    toSide: options.toSide,
    line: {
      style: options.dashed ? "dashed" : "solid",
      fill: options.color || C.line,
      width: options.width || 2,
    },
    head: options.tailArrow ? arrow : undefined,
    tail: options.arrow === false ? undefined : arrow,
  });
}

function setBase(slide) {
  slide.background.fill = C.ivory;
}

function addHeader(slide, index, title, options = {}) {
  addText(
    slide,
    `s${index}-title`,
    title,
    { left: M, top: 44, width: options.width || 1120, height: options.height || 50 },
    {
      fontSize: options.fontSize || 38,
      bold: true,
      display: true,
      color: options.color || C.graphite,
      verticalAlignment: "middle",
    },
  );
  addRule(slide, `s${index}-title-rule`, M, 105, 72, options.ruleColor || C.yellow, 5);
}

function addFooter(slide, index) {
  addText(
    slide,
    `s${index}-footer-label`,
    "MANYHANDS · PROYECTO FINAL",
    { left: M, top: 682, width: 360, height: 20 },
    { fontSize: 16, bold: true, color: C.muted, verticalAlignment: "middle" },
  );
  addText(
    slide,
    `s${index}-footer-number`,
    String(index).padStart(2, "0"),
    { left: 1160, top: 682, width: 48, height: 20 },
    { fontSize: 16, bold: true, color: C.muted, alignment: "right", verticalAlignment: "middle" },
  );
}

function sourceBlock(sources) {
  return `[Sources]\n${sources.map((source) => `- ${source}`).join("\n")}`;
}

async function readJsonOptional(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function noteEntryFor(notesManifest, index) {
  const number = index + 1;
  const candidates = Array.isArray(notesManifest)
    ? notesManifest
    : Array.isArray(notesManifest?.slides)
      ? notesManifest.slides
      : null;
  if (candidates) {
    const direct = candidates[index];
    if (typeof direct === "string") return direct;
    if (direct && typeof direct === "object") {
      return direct.notes || direct.script || direct.body || direct.text || null;
    }
    const matched = candidates.find((entry) =>
      entry && typeof entry === "object" &&
      (entry.index === number || entry.number === number || entry.slide === number || entry.title === titles[index])
    );
    if (matched) return matched.notes || matched.script || matched.body || matched.text || null;
  }
  if (notesManifest && typeof notesManifest === "object") {
    const raw = notesManifest[number] || notesManifest[String(number)] || notesManifest[`slide-${number}`] || notesManifest[`slide-${String(number).padStart(2, "0")}`] || notesManifest[titles[index]];
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") return raw.notes || raw.script || raw.body || raw.text || null;
  }
  return null;
}

async function loadMarkdownNotes(filePath) {
  try {
    const markdown = await fs.readFile(filePath, "utf8");
    const headings = [...markdown.matchAll(/^## (\d+)\. .*$/gm)];
    const notes = {};
    for (let i = 0; i < headings.length; i += 1) {
      const number = Number(headings[i][1]);
      const start = headings[i].index + headings[i][0].length;
      const end = i + 1 < headings.length ? headings[i + 1].index : markdown.length;
      const section = markdown.slice(start, end).trim();
      if (section) notes[number] = section;
    }
    return notes;
  } catch {
    return {};
  }
}

function attachNotes(slide, index, notesManifest) {
  let notes = noteEntryFor(notesManifest, index) || defaultNotes[index];
  if (!notes.includes("[Sources]")) {
    notes = `${notes.trim()}\n\n${sourceBlock(defaultSources[index])}`;
  }
  slide.speakerNotes.textFrame.setText(notes);
  slide.speakerNotes.setVisible(true);
}

function normalizeAssetPath(value) {
  if (!value || typeof value !== "string") return null;
  return path.isAbsolute(value) ? value : path.resolve(PROJECT_ROOT, value);
}

function findAsset(manifest, keys) {
  const wanted = keys.map((key) => key.toLowerCase());
  const flatKeys = Object.keys(manifest || {});
  for (const key of flatKeys) {
    if (wanted.includes(key.toLowerCase())) {
      const value = manifest[key];
      if (typeof value === "string") return normalizeAssetPath(value);
      if (value && typeof value === "object") return normalizeAssetPath(value.path || value.file || value.src);
    }
  }
  const arrays = [manifest?.assets, manifest?.screenshots, manifest?.images].filter(Array.isArray);
  for (const list of arrays) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const descriptor = [entry.key, entry.id, entry.name, entry.role, entry.kind, entry.label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (wanted.some((key) => descriptor.includes(key))) {
        return normalizeAssetPath(entry.path || entry.file || entry.src || entry.absolutePath);
      }
    }
  }
  return null;
}

async function exists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function addImage(slide, name, filePath, position, options = {}) {
  if (!(await exists(filePath))) return null;
  const bytes = await fs.readFile(filePath);
  return slide.images.add({
    name,
    blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    contentType: contentTypeFor(filePath),
    alt: options.alt || name,
    fit: options.fit || "contain",
    position,
    geometry: options.geometry || "rect",
    borderRadius: options.borderRadius,
  });
}

async function addFramedImage(slide, name, filePath, position, options = {}) {
  addShape(
    slide,
    `${name}-frame`,
    "roundRect",
    position,
    {
      fill: options.frameFill || C.white,
      line: solidLine(options.lineColor || C.line, options.lineWidth || 1),
      borderRadius: 18,
      shadow: options.shadow === false ? undefined : "shadow-sm",
    },
  );
  const inset = options.inset ?? 12;
  const image = await addImage(
    slide,
    name,
    filePath,
    {
      left: position.left + inset,
      top: position.top + inset,
      width: position.width - inset * 2,
      height: position.height - inset * 2,
    },
    { alt: options.alt, fit: options.fit || "contain", geometry: "roundRect", borderRadius: 12 },
  );
  return Boolean(image);
}

function addMetric(slide, prefix, value, label, left, top, color = C.blue) {
  addText(slide, `${prefix}-value`, value, { left, top, width: 220, height: 76 }, {
    fontSize: 62,
    bold: true,
    display: true,
    color,
    verticalAlignment: "bottom",
  });
  addText(slide, `${prefix}-label`, label, { left, top: top + 78, width: 240, height: 50 }, {
    fontSize: 20,
    color: C.graphite,
    verticalAlignment: "top",
  });
}

function addCheck(slide, name, left, top, size = 54) {
  return addShape(slide, name, "ellipse", { left, top, width: size, height: size }, {
    fill: C.green,
    line: noneLine(),
    text: "✓",
    fontSize: Math.round(size * 0.55),
    bold: true,
    color: C.white,
  });
}

function addAgent(slide, name, left, top, size = 58, fill = C.yellow, label = "IA") {
  return addShape(slide, name, "ellipse", { left, top, width: size, height: size }, {
    fill,
    line: solidLine(C.graphite, 1.5),
    text: label,
    fontSize: Math.max(16, Math.round(size * 0.27)),
    bold: true,
    color: C.graphite,
  });
}

function drawMiniNetwork(slide, prefix, originX, originY, scale = 1) {
  const center = addShape(slide, `${prefix}-center`, "ellipse", {
    left: originX + 155 * scale,
    top: originY + 132 * scale,
    width: 120 * scale,
    height: 120 * scale,
  }, {
    fill: C.blue,
    line: noneLine(),
    text: "MH",
    fontSize: 30 * scale,
    bold: true,
    color: C.white,
  });
  const positions = [
    [0, 24], [60, 190], [170, 0], [324, 30], [328, 190], [182, 278],
  ];
  const nodes = positions.map(([x, y], i) => addAgent(
    slide,
    `${prefix}-agent-${i + 1}`,
    originX + x * scale,
    originY + y * scale,
    50 * scale,
    i === 4 ? C.paleYellow : C.ivory2,
    "IA",
  ));
  nodes.forEach((node, i) => connect(slide, node, center, {
    fromSide: i < 3 ? "right" : "left",
    toSide: i < 3 ? "left" : "right",
    color: i === 4 ? C.yellow : C.blue2,
    width: i === 4 ? 3 : 2,
  }));
  return { center, nodes };
}

function addSlide1(presentation, emblemPath) {
  const slide = presentation.slides.add();
  setBase(slide);
  addShape(slide, "s1-accent-block", "rect", { left: 0, top: 0, width: 20, height: H }, { fill: C.blue, line: noneLine() });
  addText(slide, "s1-kicker", "PROYECTO FINAL · INGENIERÍA DE SISTEMAS", { left: M, top: 72, width: 520, height: 30 }, {
    fontSize: 17,
    bold: true,
    color: C.blue2,
    verticalAlignment: "middle",
  });
  addText(slide, "s1-title", "ManyHands", { left: M, top: 154, width: 560, height: 92 }, {
    fontSize: 70,
    bold: true,
    display: true,
    color: C.graphite,
    verticalAlignment: "middle",
  });
  addText(slide, "s1-subtitle", "Cómo organizar un equipo\nde agentes de inteligencia artificial", { left: M, top: 264, width: 590, height: 110 }, {
    fontSize: 31,
    display: true,
    color: C.blue,
    lineSpacing: 1.08,
  });
  addRule(slide, "s1-rule", M, 418, 104, C.yellow, 6);
  addText(slide, "s1-author", "Francisco · Universidad Nacional del Sur", { left: M, top: 456, width: 540, height: 32 }, {
    fontSize: 20,
    color: C.muted,
    verticalAlignment: "middle",
  });
  drawMiniNetwork(slide, "s1-network", 760, 150, 0.95);
  addCheck(slide, "s1-network-check", 1090, 500, 64);
  addText(slide, "s1-opening-question", "¿Qué falta para poder confiar?", { left: 736, top: 590, width: 438, height: 36 }, {
    fontSize: 24,
    bold: true,
    color: C.graphite,
    alignment: "center",
  });
  return { slide, emblemPath };
}

function addSlide2(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 2, titles[1], { fontSize: 37 });
  const verbs = [
    ["LEER", 92, C.blue],
    ["MODIFICAR", 430, C.graphite],
    ["PROBAR", 878, C.green],
  ];
  verbs.forEach(([verb, left, color]) => addText(slide, `s2-verb-${verb.toLowerCase()}`, verb, { left, top: 148, width: verb === "MODIFICAR" ? 380 : 270, height: 88 }, {
    fontSize: 62,
    bold: true,
    display: true,
    color,
    alignment: "center",
    verticalAlignment: "middle",
  }));
  const prompt = addShape(slide, "s2-prompt", "roundRect", { left: 112, top: 316, width: 242, height: 116 }, {
    fill: C.ivory2,
    line: solidLine(C.blue2, 2),
    borderRadius: 18,
    text: "Una consigna\nclara",
    fontSize: 23,
    bold: true,
    color: C.graphite,
  });
  const filesBack = addShape(slide, "s2-files-back", "roundRect", { left: 522, top: 332, width: 220, height: 116 }, {
    fill: C.paleBlue,
    line: solidLine(C.blue2, 1.5),
    borderRadius: 14,
  });
  const files = addShape(slide, "s2-files-front", "roundRect", { left: 500, top: 308, width: 220, height: 116 }, {
    fill: C.white,
    line: solidLine(C.blue, 2),
    borderRadius: 14,
    text: "Archivos\nmodificados",
    fontSize: 23,
    bold: true,
    color: C.graphite,
  });
  const tests = addShape(slide, "s2-tests", "roundRect", { left: 908, top: 316, width: 242, height: 116 }, {
    fill: C.paleGreen,
    line: solidLine(C.green, 2),
    borderRadius: 18,
    text: "Pruebas\nque pasan",
    fontSize: 23,
    bold: true,
    color: C.green,
  });
  filesBack.sendToBack();
  connect(slide, prompt, files, { fromSide: "right", toSide: "left", color: C.blue, width: 3 });
  connect(slide, files, tests, { fromSide: "right", toSide: "left", color: C.green, width: 3 });
  addText(slide, "s2-conclusion", "Una IA puede completar el ciclo de una tarea individual.", { left: 190, top: 545, width: 900, height: 52 }, {
    fontSize: 28,
    bold: true,
    display: true,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 2);
  return slide;
}

function addSlide3(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 3, titles[2]);
  addText(slide, "s3-left-lead", "En un proyecto real aparecen…", { left: M, top: 160, width: 370, height: 48 }, {
    fontSize: 26,
    bold: true,
    color: C.blue,
  });
  const items = ["más archivos", "más requisitos", "más pruebas", "más decisiones", "más dependencias"];
  items.forEach((item, i) => {
    addText(slide, `s3-item-${i + 1}`, item, { left: M + 26, top: 228 + i * 56, width: 310, height: 36 }, {
      fontSize: 23,
      color: i === 4 ? C.red : C.graphite,
      bold: i === 4,
      verticalAlignment: "middle",
    });
    addShape(slide, `s3-item-dot-${i + 1}`, "ellipse", { left: M, top: 240 + i * 56, width: 11, height: 11 }, {
      fill: i === 4 ? C.red : C.yellow,
      line: noneLine(),
    });
  });
  const agent = addAgent(slide, "s3-agent", 818, 300, 104, C.yellow, "1 IA");
  const satelliteData = [
    [584, 170, 156, 54, "archivos"],
    [874, 148, 174, 54, "requisitos"],
    [1040, 300, 146, 54, "pruebas"],
    [930, 492, 170, 54, "decisiones"],
    [632, 492, 190, 54, "dependencias"],
    [548, 330, 140, 54, "interfaces"],
  ];
  const satellites = satelliteData.map(([left, top, width, height, label], i) => addShape(slide, `s3-satellite-${i + 1}`, "roundRect", { left, top, width, height }, {
    fill: i === 4 ? C.ivory2 : C.white,
    line: solidLine(i === 4 ? C.red : C.line, i === 4 ? 2 : 1),
    borderRadius: 16,
    text: label,
    fontSize: 19,
    bold: i === 4,
    color: i === 4 ? C.red : C.graphite,
  }));
  satellites.forEach((node, i) => connect(slide, node, agent, {
    color: i === 4 ? C.red : i % 2 ? C.yellow : C.blue2,
    width: i === 4 ? 3 : 2,
  }));
  connect(slide, satellites[0], satellites[3], { color: C.line, width: 1.5, dashed: true, tailArrow: true });
  connect(slide, satellites[1], satellites[4], { color: C.line, width: 1.5, dashed: true, tailArrow: true });
  addText(slide, "s3-conclusion", "Más capacidad no significa más control.", { left: M, top: 570, width: 550, height: 52 }, {
    fontSize: 34,
    bold: true,
    display: true,
    color: C.graphite,
  });
  addFooter(slide, 3);
  return slide;
}

function addSlide4(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 4, titles[3], { fontSize: 36 });
  addRule(slide, "s4-balance-beam", 220, 360, 840, C.graphite, 8);
  addShape(slide, "s4-balance-pivot", "triangle", { left: 570, top: 360, width: 140, height: 135 }, {
    fill: C.paleBlue,
    line: solidLine(C.blue, 2),
  });
  addShape(slide, "s4-monolith", "roundRect", { left: 200, top: 208, width: 270, height: 128 }, {
    fill: C.graphite,
    line: noneLine(),
    borderRadius: 18,
    text: "UNA SOLA\nTAREA",
    fontSize: 31,
    bold: true,
    color: C.white,
  });
  addText(slide, "s4-monolith-label", "Una tarea imposible de abarcar", { left: 172, top: 505, width: 330, height: 52 }, {
    fontSize: 21,
    color: C.muted,
    alignment: "center",
  });
  const fragments = [
    [812, 220], [900, 202], [992, 226], [846, 290], [944, 286], [1034, 306], [780, 298],
  ];
  fragments.forEach(([left, top], i) => addShape(slide, `s4-fragment-${i + 1}`, "roundRect", { left, top, width: 72, height: 56 }, {
    fill: i % 2 ? C.paleYellow : C.white,
    line: solidLine(i % 2 ? C.yellow : C.line, 1.5),
    borderRadius: 12,
    text: String(i + 1),
    fontSize: 18,
    bold: true,
    color: C.graphite,
  }));
  addText(slide, "s4-fragments-label", "Demasiados fragmentos por coordinar", { left: 752, top: 505, width: 390, height: 52 }, {
    fontSize: 21,
    color: C.muted,
    alignment: "center",
  });
  addText(slide, "s4-question", "¿Dónde conviene dividir?", { left: 390, top: 574, width: 500, height: 58 }, {
    fontSize: 34,
    bold: true,
    display: true,
    color: C.blue,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 4);
  return slide;
}

function addSlide5(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addText(slide, "s5-question", "¿Cómo coordinar varios agentes\nsin perder el control?", { left: 180, top: 108, width: 920, height: 146 }, {
    fontSize: 48,
    bold: true,
    display: true,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
    lineSpacing: 1.02,
  });
  addRule(slide, "s5-rule", 510, 298, 260, C.yellow, 6);
  addText(slide, "s5-answer", "ManyHands", { left: 280, top: 348, width: 720, height: 92 }, {
    fontSize: 70,
    bold: true,
    display: true,
    color: C.blue,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addText(slide, "s5-answer-description", "Una arquitectura para organizar, integrar y verificar su trabajo.", { left: 214, top: 464, width: 852, height: 68 }, {
    fontSize: 28,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
  });
  const mini = [470, 550, 630, 710, 790];
  mini.forEach((left, i) => addAgent(slide, `s5-agent-${i + 1}`, left, 582, 42, i === 2 ? C.yellow : C.ivory2, "IA"));
  addFooter(slide, 5);
  return slide;
}

function addSlide6(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 6, titles[5], { fontSize: 36 });
  addText(slide, "s6-before-label", "AGENTES AISLADOS", { left: 90, top: 138, width: 360, height: 32 }, {
    fontSize: 18,
    bold: true,
    color: C.muted,
    alignment: "center",
  });
  const leftAgents = [
    addAgent(slide, "s6-before-agent-1", 128, 235, 58, C.white, "IA"),
    addAgent(slide, "s6-before-agent-2", 318, 210, 58, C.white, "IA"),
    addAgent(slide, "s6-before-agent-3", 202, 380, 58, C.white, "IA"),
    addAgent(slide, "s6-before-agent-4", 384, 404, 58, C.white, "IA"),
    addAgent(slide, "s6-before-agent-5", 88, 458, 58, C.white, "IA"),
  ];
  connect(slide, leftAgents[0], leftAgents[3], { color: C.red, width: 2, dashed: true, tailArrow: true });
  connect(slide, leftAgents[1], leftAgents[2], { color: C.red, width: 2, dashed: true, tailArrow: true });
  connect(slide, leftAgents[4], leftAgents[1], { color: C.line, width: 1.5, dashed: true, tailArrow: true });
  addShape(slide, "s6-transform-arrow", "rightArrow", { left: 500, top: 314, width: 140, height: 76 }, {
    fill: C.yellow,
    line: noneLine(),
  });
  addText(slide, "s6-after-label", "UN EQUIPO COORDINADO", { left: 730, top: 138, width: 420, height: 32 }, {
    fontSize: 18,
    bold: true,
    color: C.blue,
    alignment: "center",
  });
  const hub = addShape(slide, "s6-hub", "ellipse", { left: 846, top: 300, width: 150, height: 150 }, {
    fill: C.blue,
    line: noneLine(),
    text: "Many\nHands",
    fontSize: 26,
    bold: true,
    color: C.white,
  });
  const rightAgents = [
    addAgent(slide, "s6-after-agent-1", 716, 210, 58, C.paleYellow, "IA"),
    addAgent(slide, "s6-after-agent-2", 1020, 202, 58, C.paleYellow, "IA"),
    addAgent(slide, "s6-after-agent-3", 1090, 396, 58, C.paleYellow, "IA"),
    addAgent(slide, "s6-after-agent-4", 734, 480, 58, C.paleYellow, "IA"),
  ];
  rightAgents.forEach((agent, i) => connect(slide, hub, agent, {
    color: i < 2 ? C.blue2 : C.green,
    width: 2.5,
    fromSide: i === 0 || i === 3 ? "left" : "right",
    toSide: i === 0 || i === 3 ? "right" : "left",
  }));
  addCheck(slide, "s6-check", 1028, 506, 56);
  addText(slide, "s6-actions", "ORGANIZAR   ·   SUPERVISAR   ·   INTEGRAR", { left: 694, top: 590, width: 510, height: 38 }, {
    fontSize: 20,
    bold: true,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 6);
  return slide;
}

function addSlide7(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 7, titles[6], { fontSize: 35 });
  const steps = [
    ["Objetivo", "intención", C.blue],
    ["Plan", "grafo", C.blue2],
    ["Ejecución", "cambios", C.yellow],
    ["Integración", "candidato", C.blue2],
    ["Validación", "evidencia", C.green],
    ["Entrega", "commit", C.green],
  ];
  const xs = [104, 306, 508, 710, 912, 1114];
  const nodes = steps.map(([step, artifact, color], i) => {
    addText(slide, `s7-step-label-${i + 1}`, step, { left: xs[i] - 44, top: 190, width: 146, height: 38 }, {
      fontSize: 21,
      bold: true,
      color: C.graphite,
      alignment: "center",
      verticalAlignment: "middle",
    });
    const node = addShape(slide, `s7-step-node-${i + 1}`, "ellipse", { left: xs[i], top: 260, width: 58, height: 58 }, {
      fill: color,
      line: noneLine(),
      text: String(i + 1),
      fontSize: 22,
      bold: true,
      color: i === 2 ? C.graphite : C.white,
    });
    addText(slide, `s7-artifact-${i + 1}`, artifact, { left: xs[i] - 46, top: 378, width: 150, height: 34 }, {
      fontSize: 18,
      color: C.muted,
      alignment: "center",
      verticalAlignment: "middle",
    });
    addVerticalRule(slide, `s7-drop-${i + 1}`, xs[i] + 29, 320, 54, C.line, 1);
    return node;
  });
  for (let i = 0; i < nodes.length - 1; i += 1) {
    connect(slide, nodes[i], nodes[i + 1], { fromSide: "right", toSide: "left", color: i >= 3 ? C.green : C.blue2, width: 3 });
  }
  addShape(slide, "s7-run-band", "roundRect", { left: 114, top: 472, width: 1052, height: 96 }, {
    fill: C.ivory2,
    line: solidLine(C.line, 1),
    borderRadius: 18,
  });
  addText(slide, "s7-run-band-copy", "Cada etapa deja algo observable: el resultado puede rastrearse hasta la idea inicial.", { left: 166, top: 496, width: 948, height: 48 }, {
    fontSize: 25,
    bold: true,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 7);
  return slide;
}

function addSlide8(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 8, titles[7]);
  const questions = [
    "¿Cabe razonablemente\nen una tarea?",
    "¿Las partes pueden avanzar\nen paralelo?",
    "¿Tiene sentido verificarlas\npor separado?",
  ];
  questions.forEach((question, i) => {
    addShape(slide, `s8-question-number-${i + 1}`, "ellipse", { left: M, top: 166 + i * 136, width: 46, height: 46 }, {
      fill: i === 1 ? C.yellow : C.blue,
      line: noneLine(),
      text: String(i + 1),
      fontSize: 20,
      bold: true,
      color: i === 1 ? C.graphite : C.white,
    });
    addText(slide, `s8-question-${i + 1}`, question, { left: 138, top: 158 + i * 136, width: 364, height: 74 }, {
      fontSize: 23,
      bold: i === 1,
      color: C.graphite,
      verticalAlignment: "middle",
    });
  });
  addVerticalRule(slide, "s8-divider", 540, 146, 468, C.line, 1);
  const root = addShape(slide, "s8-root", "roundRect", { left: 824, top: 150, width: 220, height: 64 }, {
    fill: C.blue,
    line: noneLine(),
    borderRadius: 16,
    text: "Objetivo",
    fontSize: 23,
    bold: true,
    color: C.white,
  });
  const branchA = addShape(slide, "s8-branch-a", "roundRect", { left: 638, top: 306, width: 180, height: 62 }, {
    fill: C.paleBlue,
    line: solidLine(C.blue2, 2),
    borderRadius: 15,
    text: "módulo A",
    fontSize: 20,
    bold: true,
    color: C.blue,
  });
  const branchB = addShape(slide, "s8-branch-b", "roundRect", { left: 850, top: 306, width: 180, height: 62 }, {
    fill: C.paleYellow,
    line: solidLine(C.yellow, 2),
    borderRadius: 15,
    text: "módulo B",
    fontSize: 20,
    bold: true,
    color: C.graphite,
  });
  const branchC = addShape(slide, "s8-branch-c", "roundRect", { left: 1062, top: 306, width: 144, height: 62 }, {
    fill: C.ivory2,
    line: solidLine(C.line, 2),
    borderRadius: 15,
    text: "queda unido",
    fontSize: 17,
    bold: true,
    color: C.muted,
  });
  [branchA, branchB, branchC].forEach((branch) => connect(slide, root, branch, { fromSide: "bottom", toSide: "top", color: C.blue2, width: 2 }));
  const leaves = [
    [610, 494, "A1"], [716, 494, "A2"], [848, 494, "B1"], [954, 494, "B2"],
  ].map(([left, top, label], i) => addShape(slide, `s8-leaf-${i + 1}`, "ellipse", { left, top, width: 68, height: 68 }, {
    fill: i < 2 ? C.white : C.paleYellow,
    line: solidLine(i < 2 ? C.blue2 : C.yellow, 2),
    text: label,
    fontSize: 18,
    bold: true,
    color: C.graphite,
  }));
  connect(slide, branchA, leaves[0], { fromSide: "bottom", toSide: "top", color: C.blue2, width: 2 });
  connect(slide, branchA, leaves[1], { fromSide: "bottom", toSide: "top", color: C.blue2, width: 2 });
  connect(slide, branchB, leaves[2], { fromSide: "bottom", toSide: "top", color: C.yellow, width: 2 });
  connect(slide, branchB, leaves[3], { fromSide: "bottom", toSide: "top", color: C.yellow, width: 2 });
  addText(slide, "s8-tree-caption", "El grafo se expande sólo cuando la separación aporta valor.", { left: 614, top: 594, width: 582, height: 34 }, {
    fontSize: 20,
    bold: true,
    color: C.blue,
    alignment: "center",
  });
  addFooter(slide, 8);
  return slide;
}

function addSlide9(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 9, titles[8]);
  const agent = addAgent(slide, "s9-agent", 110, 292, 112, C.yellow, "IA");
  addText(slide, "s9-agent-caption", "recibe una responsabilidad\nacotada", { left: 74, top: 430, width: 184, height: 64 }, {
    fontSize: 20,
    color: C.muted,
    alignment: "center",
  });
  const envelope = addShape(slide, "s9-envelope", "roundRect", { left: 374, top: 154, width: 760, height: 448 }, {
    fill: C.ivory2,
    line: solidLine(C.blue, 2.5),
    borderRadius: 22,
  });
  connect(slide, agent, envelope, { fromSide: "right", toSide: "left", color: C.blue, width: 3 });
  addShape(slide, "s9-envelope-tab", "roundRect", { left: 418, top: 130, width: 250, height: 54 }, {
    fill: C.blue,
    line: noneLine(),
    borderRadius: 14,
    text: "CONTRATO DE TRABAJO",
    fontSize: 18,
    bold: true,
    color: C.white,
  });
  const rows = [
    ["01", "Objetivo", "qué resultado debe producir"],
    ["02", "Límites", "qué archivos puede modificar"],
    ["03", "Acuerdos", "cómo debe conectarse con otras partes"],
    ["04", "Evidencia", "qué prueba demuestra que terminó"],
  ];
  rows.forEach(([number, title, description], i) => {
    const top = 212 + i * 88;
    addText(slide, `s9-row-number-${i + 1}`, number, { left: 428, top, width: 54, height: 46 }, {
      fontSize: 24,
      bold: true,
      color: i === 1 ? C.yellow : C.blue2,
      verticalAlignment: "middle",
    });
    addText(slide, `s9-row-title-${i + 1}`, title, { left: 500, top, width: 178, height: 46 }, {
      fontSize: 24,
      bold: true,
      color: C.graphite,
      verticalAlignment: "middle",
    });
    addText(slide, `s9-row-description-${i + 1}`, description, { left: 696, top, width: 374, height: 46 }, {
      fontSize: 20,
      color: C.muted,
      verticalAlignment: "middle",
    });
    if (i < rows.length - 1) addRule(slide, `s9-row-rule-${i + 1}`, 426, top + 61, 646, C.line, 1);
  });
  addFooter(slide, 9);
  return slide;
}

function addSlide10(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 10, titles[9], { fontSize: 36 });
  const root = addShape(slide, "s10-root", "roundRect", { left: 86, top: 306, width: 170, height: 72 }, {
    fill: C.blue,
    line: noneLine(),
    borderRadius: 18,
    text: "Objetivo",
    fontSize: 23,
    bold: true,
    color: C.white,
  });
  const a1Ring = addShape(slide, "s10-a1-ring", "ellipse", { left: 404, top: 166, width: 86, height: 86 }, { fill: "none", line: solidLine(C.yellow, 5) });
  const a2Ring = addShape(slide, "s10-a2-ring", "ellipse", { left: 404, top: 326, width: 86, height: 86 }, { fill: "none", line: solidLine(C.yellow, 5) });
  const a1 = addAgent(slide, "s10-active-a", 416, 178, 62, C.paleYellow, "A");
  const a2 = addAgent(slide, "s10-active-b", 416, 338, 62, C.paleYellow, "B");
  const wait = addAgent(slide, "s10-waiting-c", 416, 506, 62, C.ivory2, "C");
  a1Ring.sendToBack();
  a2Ring.sendToBack();
  connect(slide, root, a1, { fromSide: "right", toSide: "left", color: C.yellow, width: 3 });
  connect(slide, root, a2, { fromSide: "right", toSide: "left", color: C.yellow, width: 3 });
  connect(slide, root, wait, { fromSide: "right", toSide: "left", color: C.line, width: 2, dashed: true });
  addText(slide, "s10-running-label-a", "RUNNING", { left: 510, top: 190, width: 118, height: 28 }, { fontSize: 17, bold: true, color: C.yellow });
  addText(slide, "s10-running-label-b", "RUNNING", { left: 510, top: 350, width: 118, height: 28 }, { fontSize: 17, bold: true, color: C.yellow });
  addText(slide, "s10-waiting-label-c", "ESPERA UN ARTEFACTO", { left: 510, top: 520, width: 228, height: 28 }, { fontSize: 17, bold: true, color: C.muted });
  addVerticalRule(slide, "s10-interface-line", 686, 215, 170, C.blue2, 3, true);
  addText(slide, "s10-interface-label", "INTERFAZ ACORDADA", { left: 610, top: 274, width: 210, height: 32 }, {
    fontSize: 17,
    bold: true,
    color: C.blue,
    alignment: "center",
  });
  const outA = addShape(slide, "s10-output-a", "roundRect", { left: 828, top: 170, width: 208, height: 72 }, {
    fill: C.white,
    line: solidLine(C.blue2, 2),
    borderRadius: 16,
    text: "artefacto A",
    fontSize: 20,
    bold: true,
    color: C.blue,
  });
  const outB = addShape(slide, "s10-output-b", "roundRect", { left: 828, top: 332, width: 208, height: 72 }, {
    fill: C.white,
    line: solidLine(C.blue2, 2),
    borderRadius: 16,
    text: "artefacto B",
    fontSize: 20,
    bold: true,
    color: C.blue,
  });
  connect(slide, a1, outA, { fromSide: "right", toSide: "left", color: C.yellow, width: 3 });
  connect(slide, a2, outB, { fromSide: "right", toSide: "left", color: C.yellow, width: 3 });
  const merged = addShape(slide, "s10-merged", "roundRect", { left: 1082, top: 250, width: 132, height: 86 }, {
    fill: C.paleGreen,
    line: solidLine(C.green, 2),
    borderRadius: 18,
    text: "se\nintegran",
    fontSize: 20,
    bold: true,
    color: C.green,
  });
  connect(slide, outA, merged, { fromSide: "right", toSide: "left", color: C.green, width: 2.5 });
  connect(slide, outB, merged, { fromSide: "right", toSide: "left", color: C.green, width: 2.5 });
  addText(slide, "s10-caption", "El paralelismo es seguro cuando cada parte conoce sus límites y sus acuerdos.", { left: 692, top: 534, width: 502, height: 70 }, {
    fontSize: 24,
    bold: true,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 10);
  return slide;
}

function addSlide11(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 11, titles[10]);
  addText(slide, "s11-quote", "«Terminé\nla tarea»", { left: 74, top: 182, width: 356, height: 184 }, {
    fontSize: 55,
    bold: true,
    display: true,
    color: C.faint,
    verticalAlignment: "middle",
  });
  addText(slide, "s11-quote-caption", "Es una afirmación.", { left: 80, top: 388, width: 330, height: 38 }, {
    fontSize: 23,
    italic: true,
    color: C.muted,
  });
  const stages = [
    ["Cambio", "diff", C.paleYellow, C.yellow],
    ["Candidato", "Git", C.paleBlue, C.blue2],
    ["Pruebas", "tests", C.paleBlue, C.blue2],
    ["Evidencia", "matriz", C.paleGreen, C.green],
  ];
  const xs = [476, 666, 856, 1046];
  const nodes = stages.map(([title, small, fill, lineColor], i) => {
    const node = addShape(slide, `s11-stage-${i + 1}`, "roundRect", { left: xs[i], top: 252, width: 148, height: 112 }, {
      fill,
      line: solidLine(lineColor, 2),
      borderRadius: 18,
      text: title,
      fontSize: 22,
      bold: true,
      color: i === 3 ? C.green : C.graphite,
    });
    addText(slide, `s11-stage-small-${i + 1}`, small, { left: xs[i], top: 382, width: 148, height: 30 }, {
      fontSize: 17,
      bold: true,
      color: C.muted,
      alignment: "center",
    });
    return node;
  });
  for (let i = 0; i < nodes.length - 1; i += 1) connect(slide, nodes[i], nodes[i + 1], { fromSide: "right", toSide: "left", color: i === 2 ? C.green : C.blue2, width: 2.5 });
  addText(slide, "s11-proposed", "PROPUESTO", { left: 490, top: 462, width: 122, height: 30 }, { fontSize: 17, bold: true, color: C.yellow, alignment: "center" });
  addShape(slide, "s11-progress-arrow", "rightArrow", { left: 614, top: 464, width: 376, height: 24 }, { fill: C.line, line: noneLine() });
  addText(slide, "s11-verified", "VERIFICADO", { left: 1045, top: 462, width: 150, height: 30 }, { fontSize: 17, bold: true, color: C.green, alignment: "center" });
  addText(slide, "s11-conclusion", "La confianza nace de comprobar lo que ocurrió realmente.", { left: 394, top: 544, width: 820, height: 62 }, {
    fontSize: 29,
    bold: true,
    display: true,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 11);
  return slide;
}

function addSlide12(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 12, titles[11], { fontSize: 36 });
  addShape(slide, "s12-up-arrow", "upArrow", { left: 78, top: 258, width: 54, height: 268 }, {
    fill: C.paleGreen,
    line: solidLine(C.green, 2),
  });
  addText(slide, "s12-up-label", "INTEGRACIÓN", { left: 32, top: 544, width: 150, height: 26, rotation: 0 }, {
    fontSize: 15,
    bold: true,
    color: C.green,
    alignment: "center",
  });
  const root = addShape(slide, "s12-root", "roundRect", { left: 500, top: 126, width: 280, height: 70 }, {
    fill: C.blue,
    line: solidLine(C.green, 4),
    borderRadius: 17,
    text: "Viaje en Familia\nintegración raíz",
    fontSize: 22,
    bold: true,
    color: C.white,
  });
  const rootLeaves = [
    addShape(slide, "s12-root-leaf-storage", "roundRect", { left: 250, top: 144, width: 176, height: 52 }, {
      fill: C.white,
      line: solidLine(C.line, 1.5),
      borderRadius: 14,
      text: "Almacenamiento",
      fontSize: 16,
      bold: true,
      color: C.graphite,
    }),
    addShape(slide, "s12-root-leaf-dashboard", "roundRect", { left: 854, top: 144, width: 176, height: 52 }, {
      fill: C.white,
      line: solidLine(C.line, 1.5),
      borderRadius: 14,
      text: "Dashboard",
      fontSize: 16,
      bold: true,
      color: C.graphite,
    }),
  ];
  rootLeaves.forEach((node) => connect(slide, node, root, { color: C.green, width: 2 }));
  const compositeData = [
    [190, 300, "Ruta e itinerario"],
    [520, 220, "Organización"],
    [770, 300, "Recuerdos"],
  ];
  const composites = compositeData.map(([left, width, label], i) => addShape(slide, `s12-composite-${i + 1}`, "roundRect", { left, top: 292, width, height: 62 }, {
    fill: C.paleBlue,
    line: solidLine(C.blue2, 2),
    borderRadius: 16,
    text: label,
    fontSize: 21,
    bold: true,
    color: C.blue,
  }));
  composites.forEach((node) => connect(slide, node, root, { fromSide: "top", toSide: "bottom", color: C.green, width: 2.5 }));
  const leafLabels = ["Paradas", "Agenda", "Búsqueda", "Presupuesto", "Equipaje", "Notas", "Favoritos"];
  const leafXs = [190, 302, 414, 520, 632, 798, 910];
  const leaves = leafLabels.map((label, i) => addShape(slide, `s12-leaf-${i + 1}`, "roundRect", { left: leafXs[i], top: 490, width: 106, height: 54 }, {
    fill: C.white,
    line: solidLine(C.line, 1.5),
    borderRadius: 14,
    text: label,
    fontSize: 15,
    bold: true,
    color: C.graphite,
  }));
  leaves.slice(0, 3).forEach((leaf) => connect(slide, leaf, composites[0], { fromSide: "top", toSide: "bottom", color: C.blue2, width: 1.8 }));
  leaves.slice(3, 5).forEach((leaf) => connect(slide, leaf, composites[1], { fromSide: "top", toSide: "bottom", color: C.blue2, width: 1.8 }));
  leaves.slice(5, 7).forEach((leaf) => connect(slide, leaf, composites[2], { fromSide: "top", toSide: "bottom", color: C.blue2, width: 1.8 }));
  addText(slide, "s12-caption", "Cada nivel comprueba que sus partes funcionan juntas antes de continuar.", { left: 260, top: 592, width: 820, height: 40 }, {
    fontSize: 22,
    bold: true,
    color: C.graphite,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 12);
  return slide;
}

async function addSlide13(presentation, assets) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 13, titles[12], { fontSize: 35 });
  addMetric(slide, "s13-total", "13", "nodos en total", 82, 154, C.blue);
  addMetric(slide, "s13-composites", "3", "módulos compuestos", 82, 316, C.yellow);
  addMetric(slide, "s13-leaves", "9", "tareas concretas", 82, 478, C.green);
  addVerticalRule(slide, "s13-divider", 392, 148, 476, C.line, 1);
  const graphPath = findAsset(assets, ["runGraph", "run_graph", "experimentGraph", "graph", "grafo"])
    || path.join(PROJECT_ROOT, "docs", "tesis", "assets", "viaje-en-familia", "manyhands-execution-flow.png");
  const usedImage = await addFramedImage(slide, "s13-run-graph-image", graphPath, { left: 438, top: 144, width: 770, height: 480 }, {
    alt: "Grafo real del run Viaje en Familia",
    fit: "contain",
  });
  if (!usedImage) {
    const fallbackRoot = addShape(slide, "s13-fallback-root", "roundRect", { left: 696, top: 178, width: 250, height: 58 }, {
      fill: C.blue,
      line: noneLine(),
      borderRadius: 15,
      text: "Viaje en Familia",
      fontSize: 23,
      bold: true,
      color: C.white,
    });
    const fallbackComposites = [
      [486, "Ruta"], [696, "Organización"], [906, "Recuerdos"],
    ].map(([left, label], i) => addShape(slide, `s13-fallback-composite-${i + 1}`, "roundRect", { left, top: 340, width: 180, height: 56 }, {
      fill: i === 1 ? C.paleYellow : C.paleBlue,
      line: solidLine(i === 1 ? C.yellow : C.blue2, 2),
      borderRadius: 14,
      text: label,
      fontSize: 19,
      bold: true,
      color: C.graphite,
    }));
    fallbackComposites.forEach((node) => connect(slide, fallbackRoot, node, { fromSide: "bottom", toSide: "top", color: C.blue2, width: 2 }));
    const fallbackLeaves = [];
    [472, 536, 600, 682, 746, 810, 892, 956, 1020].forEach((left, i) => {
      fallbackLeaves.push(addShape(slide, `s13-fallback-leaf-${i + 1}`, "ellipse", { left, top: 504, width: 40, height: 40 }, {
        fill: i >= 3 && i < 6 ? C.paleYellow : C.white,
        line: solidLine(i >= 3 && i < 6 ? C.yellow : C.line, 1.5),
        text: String(i + 1),
        fontSize: 16,
        bold: true,
        color: C.graphite,
      }));
    });
    for (let group = 0; group < 3; group += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        connect(slide, fallbackComposites[group], fallbackLeaves[group * 3 + offset], { fromSide: "bottom", toSide: "top", color: C.line, width: 1.5 });
      }
    }
    addText(slide, "s13-fallback-caption", "Grafo del experimento", { left: 654, top: 574, width: 340, height: 30 }, {
      fontSize: 19,
      bold: true,
      color: C.muted,
      alignment: "center",
    });
  }
  addText(slide, "s13-run-facts", "22 olas de trabajo · hasta 3 tareas en paralelo", { left: 438, top: 634, width: 770, height: 30 }, {
    fontSize: 18,
    bold: true,
    color: C.blue,
    alignment: "center",
    verticalAlignment: "middle",
  });
  addFooter(slide, 13);
  return slide;
}

async function addSlide14(presentation, assets) {
  const slide = presentation.slides.add();
  setBase(slide);
  addHeader(slide, 14, titles[13]);
  const appPath = findAsset(assets, ["finalApp", "final_app", "dashboard", "deliveredApp", "videoPoster", "video_poster", "browser"])
    || path.join(PROJECT_ROOT, "docs", "tesis", "assets", "viaje-en-familia", "viaje-final-dashboard-viewport.png");
  const mobilePath = findAsset(assets, ["finalAppMobile", "final_app_mobile", "dashboardMobile", "dashboard_mobile", "mobile"])
    || path.join(PROJECT_ROOT, "docs", "tesis", "assets", "viaje-en-familia", "viaje-final-dashboard-mobile.png");
  const hasMobile = await exists(mobilePath);
  const usedImage = await addFramedImage(slide, "s14-result-image", appPath, { left: 72, top: 146, width: hasMobile ? 652 : 720, height: 474 }, {
    alt: "Aplicación Viaje en Familia producida por el run",
    fit: "contain",
  });
  if (usedImage && hasMobile) {
    await addFramedImage(slide, "s14-result-mobile-image", mobilePath, { left: 604, top: 266, width: 188, height: 354 }, {
      alt: "Vista móvil del dashboard Viaje en Familia",
      fit: "contain",
      inset: 8,
      lineColor: C.blue2,
      lineWidth: 2,
    });
  }
  if (!usedImage) {
    addShape(slide, "s14-browser", "roundRect", { left: 72, top: 146, width: 720, height: 474 }, {
      fill: C.white,
      line: solidLine(C.line, 1.5),
      borderRadius: 20,
      shadow: "shadow-sm",
    });
    addShape(slide, "s14-browser-top", "roundRect", { left: 72, top: 146, width: 720, height: 50 }, {
      fill: C.paleBlue,
      line: noneLine(),
      borderRadius: 20,
    });
    [100, 126, 152].forEach((left, i) => addShape(slide, `s14-browser-dot-${i + 1}`, "ellipse", { left, top: 164, width: 12, height: 12 }, { fill: i === 0 ? C.red : i === 1 ? C.yellow : C.green, line: noneLine() }));
    addText(slide, "s14-browser-title", "Viaje en Familia", { left: 124, top: 250, width: 610, height: 74 }, {
      fontSize: 44,
      bold: true,
      display: true,
      color: C.blue,
      alignment: "center",
      verticalAlignment: "middle",
    });
    addText(slide, "s14-browser-subtitle", "Una aplicación visible producida por el Run", { left: 154, top: 342, width: 550, height: 44 }, {
      fontSize: 24,
      color: C.graphite,
      alignment: "center",
    });
    addCheck(slide, "s14-browser-check", 403, 438, 64);
  }
  addText(slide, "s14-evidence-heading", "EVIDENCIA DEL RESULTADO", { left: 850, top: 150, width: 356, height: 32 }, {
    fontSize: 18,
    bold: true,
    color: C.blue2,
  });
  addText(slide, "s14-tests-value", "32/32", { left: 850, top: 210, width: 320, height: 78 }, {
    fontSize: 60,
    bold: true,
    display: true,
    color: C.green,
  });
  addText(slide, "s14-tests-label", "pruebas superadas", { left: 854, top: 290, width: 300, height: 32 }, { fontSize: 21, color: C.graphite });
  addRule(slide, "s14-evidence-rule-1", 850, 350, 320, C.line, 1);
  addText(slide, "s14-candidate-value", "62a0d357", { left: 850, top: 380, width: 320, height: 52 }, {
    fontSize: 31,
    bold: true,
    display: true,
    color: C.blue,
  });
  addText(slide, "s14-candidate-label", "candidato exacto", { left: 854, top: 435, width: 300, height: 32 }, { fontSize: 20, color: C.graphite });
  addRule(slide, "s14-evidence-rule-2", 850, 492, 320, C.line, 1);
  addCheck(slide, "s14-clone-check", 850, 522, 48);
  addText(slide, "s14-clone-copy", "reproducido en\nun clon limpio", { left: 918, top: 518, width: 252, height: 66 }, {
    fontSize: 21,
    bold: true,
    color: C.graphite,
    verticalAlignment: "middle",
  });
  addFooter(slide, 14);
  return slide;
}

function addSlide15(presentation) {
  const slide = presentation.slides.add();
  setBase(slide);
  addShape(slide, "s15-accent-block", "rect", { left: 0, top: 0, width: 20, height: H }, { fill: C.blue, line: noneLine() });
  addText(slide, "s15-line-1", "La IA aporta capacidad.", { left: 88, top: 132, width: 760, height: 78 }, {
    fontSize: 50,
    bold: true,
    display: true,
    color: C.graphite,
    verticalAlignment: "middle",
  });
  addText(slide, "s15-line-2", "La arquitectura aporta confianza.", { left: 88, top: 224, width: 860, height: 82 }, {
    fontSize: 50,
    bold: true,
    display: true,
    color: C.blue,
    verticalAlignment: "middle",
  });
  addRule(slide, "s15-rule", 88, 340, 118, C.yellow, 7);
  addText(slide, "s15-closing", "Mi proyecto no buscó enseñar a la IA a programar.\nBuscó crear las condiciones para confiar en su trabajo.", { left: 88, top: 388, width: 800, height: 108 }, {
    fontSize: 29,
    display: true,
    color: C.graphite,
    lineSpacing: 1.06,
  });
  const finalNode = addShape(slide, "s15-final-node", "ellipse", { left: 1040, top: 272, width: 120, height: 120 }, {
    fill: C.blue,
    line: noneLine(),
    text: "MH",
    fontSize: 32,
    bold: true,
    color: C.white,
  });
  const positions = [[930, 150], [1110, 122], [930, 440], [1120, 474]];
  positions.forEach(([left, top], i) => {
    const node = addAgent(slide, `s15-agent-${i + 1}`, left, top, 52, i === 2 ? C.paleYellow : C.white, "IA");
    connect(slide, node, finalNode, { color: i === 2 ? C.yellow : C.blue2, width: i === 2 ? 3 : 2 });
  });
  addCheck(slide, "s15-check", 1092, 410, 62);
  addText(slide, "s15-thanks", "Gracias", { left: 88, top: 588, width: 230, height: 48 }, {
    fontSize: 30,
    bold: true,
    display: true,
    color: C.blue,
    verticalAlignment: "middle",
  });
  addText(slide, "s15-author", "Francisco · Universidad Nacional del Sur", { left: 708, top: 608, width: 470, height: 30 }, {
    fontSize: 18,
    color: C.muted,
    alignment: "right",
  });
  return slide;
}

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

async function main() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
  const renderedDir = path.join(TMP_DIR, "rendered");
  await fs.mkdir(renderedDir, { recursive: true });

  const assets = await readJsonOptional(path.join(MODULE_DIR, "assets-manifest.json"), {});
  let notesManifest = await readJsonOptional(path.join(MODULE_DIR, "speaker-notes.json"), {});
  if (!notesManifest || (typeof notesManifest === "object" && Object.keys(notesManifest).length === 0)) {
    notesManifest = await loadMarkdownNotes(path.join(PROJECT_ROOT, "docs", "tesis", "presentacion", "guion-presentacion-oral.md"));
  }
  const emblemPath = path.join(PROJECT_ROOT, "docs", "tesis", "assets", "uns-emblema.png");

  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  const first = addSlide1(presentation, emblemPath);
  addSlide2(presentation);
  addSlide3(presentation);
  addSlide4(presentation);
  addSlide5(presentation);
  addSlide6(presentation);
  addSlide7(presentation);
  addSlide8(presentation);
  addSlide9(presentation);
  addSlide10(presentation);
  addSlide11(presentation);
  addSlide12(presentation);
  await addSlide13(presentation, assets);
  await addSlide14(presentation, assets);
  addSlide15(presentation);

  if (await exists(emblemPath)) {
    await addImage(first.slide, "s1-uns-emblem", emblemPath, { left: 76, top: 570, width: 76, height: 76 }, {
      alt: "Emblema de la Universidad Nacional del Sur",
      fit: "contain",
    });
  }

  presentation.slides.items.forEach((slide, index) => attachNotes(slide, index, notesManifest));

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    await writeBlob(path.join(renderedDir, `${stem}.png`), await presentation.export({ slide, format: "png", scale: 1 }));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(renderedDir, `${stem}.layout.json`), await layout.text(), "utf8");
  }

  await writeBlob(
    path.join(TMP_DIR, "deck-montage.webp"),
    await presentation.export({ format: "webp", montage: true, scale: 1 }),
  );

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);

  console.log(JSON.stringify({
    slides: presentation.slides.items.length,
    pptx: FINAL_PPTX,
    renderedDir,
    montage: path.join(TMP_DIR, "deck-montage.webp"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
